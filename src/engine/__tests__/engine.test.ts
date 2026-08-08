import { describe, expect, it } from 'vitest'
import { icosahedron } from '../icosahedron'
import { subdivideIcosahedron } from '../subdivide'
import { generateDome } from '../dome'
import { buildCutList, JOINT_METHODS } from '../cutlist'
import { packCuts } from '../packing'
import { optimizeDiameter } from '../optimize'
import { analyzeOpenings } from '../openings'
import { cutDoorways, emptyDoorwayCut, optimizeDoorPlacement } from '../doorway'
import { planPanels } from '../panels'
import { buildRiser, orderedBaseRing } from '../riser'
import { projectJson, parseProjectJson } from '../exports/json'
import { miterCsv } from '../exports/csv'
import { cutTemplatesSvg, boardDiagramsSvg } from '../exports/templates'
import { buildBom, estimateCost, defaultPrice } from '../bom'
import { costsCsv } from '../exports/csv'
import { assemblyGuideSvg } from '../exports/guide'
import { panelPatternsSvg } from '../exports/patterns'
import { buildAssemblyPlan } from '../assembly'
import { generateZome } from '../zome'
import { hubAxes } from '../hubs'
import { miterCuts } from '../miter'
import { formatFeetInches, formatInchesFractional, roundToIncrement } from '../units'
import { cross, dot, sub, add, length } from '../vec'

describe('icosahedron', () => {
  const ico = icosahedron()

  it('has 12 unit vertices and 20 outward faces', () => {
    expect(ico.vertices).toHaveLength(12)
    expect(ico.faces).toHaveLength(20)
    for (const v of ico.vertices) expect(length(v)).toBeCloseTo(1, 12)
    for (const [a, b, c] of ico.faces) {
      const n = cross(sub(ico.vertices[b], ico.vertices[a]), sub(ico.vertices[c], ico.vertices[a]))
      const centroid = add(add(ico.vertices[a], ico.vertices[b]), ico.vertices[c])
      expect(dot(n, centroid)).toBeGreaterThan(0)
    }
  })

  it('is vertex-up with pentagon rings at z = ±1/√5', () => {
    expect(ico.vertices[0]).toEqual([0, 0, 1])
    for (let i = 1; i <= 5; i++) expect(ico.vertices[i][2]).toBeCloseTo(1 / Math.sqrt(5), 12)
  })
})

describe('subdivision (class I, method 1)', () => {
  it.each([1, 2, 3, 4, 5, 6])('frequency %i satisfies icosphere counts', (f) => {
    const s = subdivideIcosahedron(f)
    expect(s.vertices).toHaveLength(10 * f * f + 2)
    expect(s.faces).toHaveLength(20 * f * f)
    const edges = new Set<string>()
    for (const [a, b, c] of s.faces) {
      for (const [x, y] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        edges.add(x < y ? `${x}:${y}` : `${y}:${x}`)
      }
    }
    expect(edges.size).toBe(30 * f * f) // implies Euler V - E + F = 2
    for (const v of s.vertices) expect(length(v)).toBeCloseTo(1, 9)
  })

  it('reproduces published 2V chord factors', () => {
    const dome = generateDome({ frequency: 2, fraction: 'full' })
    const cfs = dome.strutTypes.map((t) => t.chordFactor)
    expect(cfs).toHaveLength(2)
    expect(cfs[0]).toBeCloseTo(0.546533, 5)
    expect(cfs[1]).toBeCloseTo(0.618034, 5)
  })

  it('reproduces published 3V chord factors', () => {
    const dome = generateDome({ frequency: 3, fraction: 'full' })
    const cfs = dome.strutTypes.map((t) => t.chordFactor)
    expect(cfs).toHaveLength(3)
    expect(cfs[0]).toBeCloseTo(0.348615, 5)
    expect(cfs[1]).toBeCloseTo(0.403548, 5)
    expect(cfs[2]).toBeCloseTo(0.412411, 5)
  })
})

describe('dome truncation', () => {
  it('3V 5/8 (5/9 ring) matches published kits: 30A/55B/80C, 61 hubs', () => {
    const dome = generateDome({ frequency: 3, fraction: '5/8' })
    expect(dome.strutTypes.map((t) => t.count)).toEqual([30, 55, 80])
    expect(dome.edges).toHaveLength(165)
    expect(dome.vertices).toHaveLength(61)
    expect(dome.faces).toHaveLength(105)
    // Disk topology: V - E + F = 1
    expect(dome.vertices.length - dome.edges.length + dome.faces.length).toBe(1)
  })

  it('3V 3/8 (4/9 ring) matches published kits: 30A/40B/50C, 46 hubs', () => {
    const dome = generateDome({ frequency: 3, fraction: '3/8' })
    expect(dome.strutTypes.map((t) => t.count)).toEqual([30, 40, 50])
    expect(dome.edges).toHaveLength(120)
    expect(dome.vertices).toHaveLength(46)
    expect(dome.faces).toHaveLength(75)
    expect(dome.vertices.length - dome.edges.length + dome.faces.length).toBe(1)
  })

  it('leveled base pulls every boundary hub onto the cut plane, on-sphere', () => {
    const dome = generateDome({ frequency: 3, fraction: '5/8', baseMode: 'leveled' })
    const base = dome.vertices.filter((v) => v.isBase)
    expect(base.length).toBeGreaterThan(0)
    for (const v of base) {
      expect(v.position[2]).toBeCloseTo(dome.cutZ, 9)
      expect(Math.hypot(...v.position)).toBeCloseTo(1, 9)
    }
    // Leveling perturbs base strut lengths: more types than the natural cut.
    expect(dome.strutTypes.length).toBeGreaterThan(3)
    // Interior struts keep the canonical 3V chord factors.
    const cfs = dome.strutTypes.map((t) => t.chordFactor)
    expect(cfs.some((c) => Math.abs(c - 0.348615) < 1e-5)).toBe(true)
    expect(cfs.some((c) => Math.abs(c - 0.412411) < 1e-5)).toBe(true)
  })

  it('4V hemisphere cuts exactly at the equator', () => {
    const dome = generateDome({ frequency: 4, fraction: '1/2' })
    expect(dome.cutZ).toBeCloseTo(0, 9)
    expect(dome.actualFraction).toBeCloseTo(0.5, 9)
  })

  it('5V 5/8 yields 9 strut types', () => {
    const dome = generateDome({ frequency: 5, fraction: '5/8' })
    expect(dome.strutTypes).toHaveLength(9)
    expect(dome.actualFraction).toBeGreaterThan(0.55)
    expect(dome.actualFraction).toBeLessThan(0.7)
    expect(dome.vertices.filter((v) => v.isBase).length).toBeGreaterThan(0)
    expect(dome.vertices.length - dome.edges.length + dome.faces.length).toBe(1)
    // Every strut type is used and totals match the edge count.
    expect(dome.strutTypes.reduce((n, t) => n + t.count, 0)).toBe(dome.edges.length)
  })

  it('classifies hubs: 5V 5/8 apex is a 5-way hub, interior 5- or 6-way', () => {
    const dome = generateDome({ frequency: 5, fraction: '5/8' })
    const apex = dome.vertices.find(
      (v) =>
        Math.abs(v.position[0]) < 1e-9 && Math.abs(v.position[1]) < 1e-9 && v.position[2] > 0.99,
    )!
    expect(apex.edgeIds).toHaveLength(5)
    for (const v of dome.vertices) {
      expect(v.hubTypeId).toBeGreaterThanOrEqual(0)
      if (!v.isBase) expect([5, 6]).toContain(v.edgeIds.length)
    }
    // No dangling geometry: every edge belongs to at least one face.
    for (const e of dome.edges) expect(e.faceIds.length).toBeGreaterThanOrEqual(1)
  })
})

describe('cut list', () => {
  const dome = generateDome({ frequency: 5, fraction: '5/8' })

  it('bounds rounding error by half the increment', () => {
    const cl = buildCutList(dome, {
      radius: 156,
      increment: 1 / 8,
      endOffset: 2,
      units: 'imperial',
    })
    for (const row of cl.rows) {
      expect(row.roundingError).toBeLessThanOrEqual(1 / 16 + 1e-12)
      expect(row.exactCutLength).toBeCloseTo(row.chordLength - 4, 9)
    }
    expect(cl.totalStruts).toBe(dome.edges.length)
  })

  it('axial angle matches 90 - asin(cf/2)', () => {
    for (const t of dome.strutTypes) {
      expect(t.axialAngleDeg).toBeCloseTo(90 - (Math.asin(t.chordFactor / 2) * 180) / Math.PI, 9)
    }
  })
})

describe('packing', () => {
  it('packs all cuts within stock and reports non-negative waste', () => {
    const dome = generateDome({ frequency: 3, fraction: '5/8' })
    const cl = buildCutList(dome, {
      radius: 150,
      increment: 1 / 8,
      endOffset: 0,
      units: 'imperial',
    })
    const stock = [
      { length: 96, label: '8 ft' },
      { length: 120, label: '10 ft' },
      { length: 144, label: '12 ft' },
    ]
    const packing = packCuts(cl, { kerf: 1 / 8, stock })
    expect(packing.unplaceable).toHaveLength(0)
    const placed = packing.boards.reduce((n, b) => n + b.cuts.length, 0)
    expect(placed).toBe(cl.totalStruts)
    for (const b of packing.boards) {
      const used = b.cuts.reduce((n, c) => n + c.length, 0) + b.cuts.length * (1 / 8)
      expect(used).toBeLessThanOrEqual(b.stockLength + 1e-9)
      expect(b.waste).toBeGreaterThanOrEqual(0)
    }
    expect(packing.wasteFraction).toBeGreaterThanOrEqual(0)
    expect(packing.wasteFraction).toBeLessThan(1)
  })
})

describe('diameter optimizer', () => {
  it('finds a candidate within range whose error beats the range average', () => {
    const dome = generateDome({ frequency: 5, fraction: '5/8' })
    const result = optimizeDiameter(dome, {
      minDiameter: 20 * 12,
      maxDiameter: 30 * 12,
      step: 1,
      increment: 1 / 8,
      endOffset: 2,
      kerf: 1 / 8,
      stock: [
        { length: 96, label: '8 ft' },
        { length: 120, label: '10 ft' },
        { length: 144, label: '12 ft' },
        { length: 192, label: '16 ft' },
      ],
      units: 'imperial',
    })
    expect(result.best).not.toBeNull()
    expect(result.best!.diameter).toBeGreaterThanOrEqual(240)
    expect(result.best!.diameter).toBeLessThanOrEqual(360)
    expect(result.evaluated).toBeGreaterThan(100)
    expect(result.best!.maxRoundingError).toBeLessThanOrEqual(1 / 16)
  })
})

describe('openings', () => {
  const dome = generateDome({ frequency: 3, fraction: '5/8' })

  it('merges adjacent same-type faces into one group with framed-out interior struts', () => {
    const f0 = dome.faces[0]
    const neighbor = f0.neighborIds[0]
    const groups = analyzeOpenings(dome, { [f0.id]: 'door', [neighbor]: 'door' }, 100)
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.type).toBe('door')
    expect(g.label).toBe('D1')
    expect(g.faceIds).toHaveLength(2)
    // Two triangles sharing exactly one edge: 1 interior, 4 perimeter struts.
    expect(g.interiorEdgeIds).toHaveLength(1)
    expect(g.area).toBeGreaterThan(0)
    expect(g.perimeter).toBeGreaterThan(0)
    expect(g.interiorSummary).toMatch(/1× [A-Z]/)
  })

  it('keeps disjoint same-type faces as separate numbered groups', () => {
    // Two faces that are not neighbors.
    const f0 = dome.faces[0]
    const far = dome.faces.find((f) => !f0.neighborIds.includes(f.id) && f.id !== f0.id)!
    const groups = analyzeOpenings(dome, { [f0.id]: 'window', [far.id]: 'window' }, 100)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.label).sort()).toEqual(['W1', 'W2'])
  })

  it('flags door groups that reach the base ring', () => {
    const baseFace = dome.faces.find((f) => f.vertexIds.some((vi) => dome.vertices[vi].isBase))!
    const apexFace = dome.faces.find((f) => !f.vertexIds.some((vi) => dome.vertices[vi].isBase))!
    const groups = analyzeOpenings(dome, { [baseFace.id]: 'door', [apexFace.id]: 'window' }, 100)
    expect(groups.find((g) => g.type === 'door')!.reachesBase).toBe(true)
    expect(groups.find((g) => g.type === 'window')!.reachesBase).toBe(false)
  })

  it('scales area with radius squared', () => {
    const one = analyzeOpenings(dome, { 0: 'window' }, 1)[0]
    const hundred = analyzeOpenings(dome, { 0: 'window' }, 10)[0]
    expect(hundred.area / one.area).toBeCloseTo(100, 9)
  })
})

describe('parametric doorways', () => {
  const dome = generateDome({ frequency: 5, fraction: '5/8' })
  const R = 156 // 26 ft dome, inches
  const door = { id: 'D1', azimuthDeg: 0, width: 36, height: 80 }
  const cut = cutDoorways(dome, [door], R, { minStubLength: 6 })

  it('carves a localized opening: some struts removed, some trimmed', () => {
    expect(cut.removedEdges.size + cut.trimmedEdges.size).toBeGreaterThan(0)
    expect(cut.trimmed.length).toBeGreaterThan(0)
    // Localized: a 36x80 door touches a small part of a 425-strut dome.
    expect(cut.removedEdges.size + cut.trimmedEdges.size).toBeLessThan(40)
    expect(cut.removedFaces.size).toBeGreaterThan(0)
    expect(cut.removedFaces.size).toBeLessThan(40)
  })

  it('trimmed pieces are shorter than their parent strut and above the scrap floor', () => {
    for (const piece of cut.trimmed) {
      const full = dome.edges[piece.edgeId].chordFactor * R
      expect(piece.length).toBeLessThan(full)
      expect(piece.length).toBeGreaterThanOrEqual(6)
    }
  })

  it('reports a buildable frame for a normal door and rejects an oversized one', () => {
    const info = cut.doors[0]
    expect(info.fits).toBe(true)
    expect(info.jambLength).toBe(80)
    expect(info.headerLength).toBe(36)
    expect(info.framePlaneDist).toBeGreaterThan(0)
    expect(info.framePlaneDist).toBeLessThan(R)
    // Extruded-entry closure: positive, bounded by simple rectangles.
    const rBase = Math.sqrt(R * R - (dome.cutZ * R) ** 2)
    const maxDepth = rBase - info.framePlaneDist + 1
    expect(info.closureSideArea).toBeGreaterThan(0)
    expect(info.closureSideArea).toBeLessThan(2 * 80 * maxDepth)
    expect(info.closureTopArea).toBeGreaterThan(0)
    expect(info.closureTopArea).toBeLessThan(36 * maxDepth)
    const tooTall = cutDoorways(dome, [{ id: 'D1', azimuthDeg: 0, width: 36, height: 200 }], R, {
      minStubLength: 6,
    })
    expect(tooTall.doors[0].fits).toBe(false)
  })

  it('does not touch the far side of the dome', () => {
    for (const eid of [...cut.removedEdges, ...cut.trimmedEdges]) {
      const e = dome.edges[eid]
      // Both endpoints have x > 0 (door is at azimuth 0 = +x).
      expect(
        dome.vertices[e.v0].position[0] > 0 || dome.vertices[e.v1].position[0] > 0,
      ).toBe(true)
    }
  })

  it('generates closure framing per side, fitted to the faceted shell', () => {
    const framed = cutDoorways(dome, [door], R, { minStubLength: 6, studSpacing: 16 })
    const framing = framed.doors[0].closureFraming
    const plates = framing.filter((m) => m.part === 'wall plate')
    // One plate per side wall (lengths may differ — the shell is faceted and
    // not symmetric about an arbitrary door plane).
    expect(plates).toHaveLength(2)
    expect(plates.map((p) => p.side).sort()).toEqual([-1, 1])
    // Faceted shell lies inside the sphere: plates can't exceed the
    // sphere-based wall depth at the wall plane.
    const z0 = dome.cutZ * R
    const wallPlaneDepth = Math.sqrt(R * R - 18 * 18 - z0 * z0) - framed.doors[0].framePlaneDist
    for (const p of plates) {
      expect(p.quantity).toBe(1)
      expect(p.length).toBeGreaterThan(0)
      expect(p.length).toBeLessThanOrEqual(wallPlaneDepth + 1e-6)
    }

    // A wider, taller door has deeper closure walls that take studs.
    const big = cutDoorways(dome, [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }], R, {
      minStubLength: 6,
      studSpacing: 16,
    })
    const studs = big.doors[0].closureFraming.filter((m) => m.part === 'wall stud' && m.side === 1)
    expect(studs.length).toBeGreaterThan(0)
    // Studs shorten (never grow) marching out along the faceted shell edge.
    for (let i = 1; i < studs.length; i++) {
      expect(studs[i].length).toBeLessThanOrEqual(studs[i - 1].length + 1e-6)
      expect(studs[i].a[0] - studs[i - 1].a[0]).toBeCloseTo(16, 9)
    }
    for (const m of big.doors[0].closureFraming) expect(m.length).toBeGreaterThanOrEqual(6)

    // Stud tops land on the faceted profile, which lies within the sphere.
    const prof = big.doors[0].closureProfile!
    for (const [uPos, h] of [...prof.wallPos, ...prof.wallNeg]) {
      const dist = Math.hypot(uPos, prof.halfWidth, z0 + h)
      expect(dist).toBeLessThanOrEqual(R + 1e-6)
    }

    // Framing lands in the cut list as frame rows; spacing 0 removes it.
    const cl = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' },
      big,
    )
    expect(cl.rows.some((r) => r.label === 'D1 wall plate')).toBe(true)
    expect(cl.rows.some((r) => r.label === 'D1 wall stud')).toBe(true)
    const bare = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' },
      cut,
    )
    expect(bare.rows.some((r) => r.label.includes('wall'))).toBe(false)
  })

  it('cut ends land on the closure envelope — no floating stubs', () => {
    const framed = cutDoorways(dome, [door], R, { minStubLength: 6 })
    const info = framed.doors[0]
    const halfEnv = info.width / 2
    const z0 = dome.cutZ * R
    const az = (info.azimuthDeg * Math.PI) / 180
    const [ux, uy] = [Math.cos(az), Math.sin(az)]
    for (const piece of framed.trimmed) {
      const e = dome.edges[piece.edgeId]
      for (const [pt, origUnit] of [
        [piece.aUnit, dome.vertices[e.v0].position],
        [piece.bUnit, dome.vertices[e.v1].position],
      ] as const) {
        const isOriginalEnd =
          Math.hypot(pt[0] - origUnit[0], pt[1] - origUnit[1], pt[2] - origUnit[2]) < 1e-9
        if (isOriginalEnd) continue
        // A cut end must lie on one of the envelope boundary planes.
        const x = pt[0] * R
        const y = pt[1] * R
        const z = pt[2] * R
        const u = ux * x + uy * y
        const t = -uy * x + ux * y
        const onBoundary = Math.min(
          Math.abs(Math.abs(t) - halfEnv),
          Math.abs(z - (z0 + info.height)),
          Math.abs(u - info.framePlaneDist),
        )
        expect(onBoundary).toBeLessThan(1e-6)
      }
    }
  })

  it('negative depth can project the entry past the base ring', () => {
    const rBase = Math.sqrt(R * R - (dome.cutZ * R) ** 2)
    const out = cutDoorways(dome, [{ ...door, extraDepth: -40 }], R, {
      minStubLength: 6,
      studSpacing: 16,
    }).doors[0]
    expect(out.framePlaneDist).toBeGreaterThan(rBase)
    expect(out.tunnelDepth).toBeLessThan(0)
    // The projecting vestibule still gets sealed: walls + roof + framing.
    expect(out.closureSideArea).toBeGreaterThan(0)
    expect(out.closureFraming.length).toBeGreaterThan(0)
    // Projecting-side studs run from the shell up to the roof.
    const protruding = out.closureFraming.filter(
      (m) => m.part === 'wall stud' && m.a[0] < out.framePlaneDist,
    )
    expect(protruding.length).toBeGreaterThan(0)
    for (const s of protruding) expect(s.b[1]).toBeCloseTo(80, 6)
  })

  it('emits connected shell-edge members along the faceted closure boundary', () => {
    const framed = cutDoorways(dome, [{ ...door, extraDepth: 12 }], R, {
      minStubLength: 6,
      studSpacing: 16,
    }).doors[0]
    const edges = framed.closureFraming.filter((m) => m.part === 'shell edge')
    expect(edges.length).toBeGreaterThan(0)
    // Edge members chain: within a run, consecutive members share endpoints
    // exactly (separate runs sit farther apart than the scrap floor).
    for (const side of [1, -1] as const) {
      const chain = edges.filter((m) => m.side === side)
      for (let i = 1; i < chain.length; i++) {
        const gap = Math.hypot(
          chain[i].a[0] - chain[i - 1].b[0],
          chain[i].a[1] - chain[i - 1].b[1],
        )
        expect(gap < 1e-6 || gap >= 6).toBe(true)
      }
    }
    expect(framed.closureJointCount).toBeGreaterThan(4)
    // Edge members reach the cut list.
    const cl = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' },
      cutDoorways(dome, [{ ...door, extraDepth: 12 }], R, { minStubLength: 6, studSpacing: 16 }),
    )
    expect(cl.rows.some((r) => r.label === 'D1 shell edge')).toBe(true)
  })

  it('placement optimizer biases toward centering on a hub or strut midline', () => {
    const spec = { id: 'D1', azimuthDeg: 10, width: 36, height: 80 }
    const result = optimizeDoorPlacement(dome, spec, R, { minStubLength: 6, increment: 1 / 8 })
    // The chosen bearing is visually centered: the center plane passes
    // within a couple of inches of a hub or strut midline.
    expect(result.after.centerOffset).toBeLessThanOrEqual(result.before.centerOffset + 1e-9)
    expect(result.after.centerOffset).toBeLessThan(4)
  })

  it('depth recesses the buck (and negative depth pushes it outward)', () => {
    const auto = cutDoorways(dome, [door], R, { minStubLength: 6 }).doors[0]
    const deep = cutDoorways(dome, [{ ...door, extraDepth: 12 }], R, { minStubLength: 6 }).doors[0]
    const proud = cutDoorways(dome, [{ ...door, extraDepth: -6 }], R, { minStubLength: 6 }).doors[0]
    expect(deep.framePlaneDist).toBeCloseTo(auto.framePlaneDist - 12, 9)
    expect(deep.tunnelDepth).toBeCloseTo(auto.tunnelDepth + 12, 9)
    expect(proud.framePlaneDist).toBeCloseTo(auto.framePlaneDist + 6, 9)
    // Deeper entry cuts at least as much structure.
    const autoCut = cutDoorways(dome, [door], R, { minStubLength: 6 })
    const deepCut = cutDoorways(dome, [{ ...door, extraDepth: 12 }], R, { minStubLength: 6 })
    expect(
      deepCut.removedEdges.size + deepCut.trimmedEdges.size,
    ).toBeGreaterThanOrEqual(autoCut.removedEdges.size + autoCut.trimmedEdges.size)
  })

  it('margin widens the cut envelope beyond the buck', () => {
    const base = cutDoorways(dome, [door], R, { minStubLength: 6 })
    const wide = cutDoorways(dome, [{ ...door, margin: 6 }], R, { minStubLength: 6 })
    expect(
      wide.removedEdges.size + wide.trimmedEdges.size + wide.removedFaces.size,
    ).toBeGreaterThanOrEqual(
      base.removedEdges.size + base.trimmedEdges.size + base.removedFaces.size,
    )
    expect(wide.doors[0].closureProfile!.halfWidth).toBeCloseTo(24, 9)
    expect(wide.doors[0].closureProfile!.topHeight).toBeCloseTo(86, 9)
    // Face band = envelope rectangle minus the rough opening.
    expect(wide.doors[0].closureFaceArea).toBeCloseTo(48 * 86 - 36 * 80, 6)
    expect(base.doors[0].closureFaceArea).toBe(0)
  })

  it('adjusts the cut list: reduced type counts, trimmed rows, buck members', () => {
    const base = buildCutList(dome, { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' })
    const cutList = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' },
      cut,
    )
    // Type rows stay first and aligned with strutTypes for row indexing.
    for (let i = 0; i < dome.strutTypes.length; i++) {
      expect(cutList.rows[i].typeId).toBe(i)
      expect(cutList.rows[i].kind).toBe('strut')
    }
    // Per type: base count = kept + removed + trimmed parents.
    const goneByType = new Map<number, number>()
    for (const eid of [...cut.removedEdges, ...cut.trimmedEdges]) {
      const t = dome.edges[eid].typeId
      goneByType.set(t, (goneByType.get(t) ?? 0) + 1)
    }
    for (let i = 0; i < dome.strutTypes.length; i++) {
      expect(cutList.rows[i].quantity).toBe(base.rows[i].quantity - (goneByType.get(i) ?? 0))
    }
    const trimmedRows = cutList.rows.filter((r) => r.kind === 'trimmed')
    expect(trimmedRows.reduce((n, r) => n + r.quantity, 0)).toBe(cut.trimmed.length)
    const frameRows = cutList.rows.filter((r) => r.kind === 'frame')
    expect(frameRows).toHaveLength(2)
    expect(frameRows.find((r) => r.label === 'D1 jamb')!.quantity).toBe(2)
    expect(frameRows.find((r) => r.label === 'D1 header')!.roundedCutLength).toBe(36)
  })

  it('optimizes placement: never worse, deterministic, and hub-avoiding', () => {
    // Park the door dead on a base hub azimuth — a deliberately bad spot.
    const baseHub = dome.vertices.find((v) => v.isBase)!
    const badAz =
      ((Math.atan2(baseHub.position[1], baseHub.position[0]) * 180) / Math.PI + 360) % 360
    const spec = { id: 'D1', azimuthDeg: badAz, width: 36, height: 80 }
    const opts = { minStubLength: 6, increment: 1 / 8 }

    const result = optimizeDoorPlacement(dome, spec, R, opts)
    expect(result.after.score).toBeLessThanOrEqual(result.before.score)
    expect(result.evaluated).toBeGreaterThan(100)
    // The bad spot removes hubs; the optimizer should not do worse.
    expect(result.after.hubsRemoved).toBeLessThanOrEqual(result.before.hubsRemoved)

    // Deterministic: same input, same answer.
    const again = optimizeDoorPlacement(dome, spec, R, opts)
    expect(again.azimuthDeg).toBe(result.azimuthDeg)

    // Applying the result reproduces the reported stats.
    const applied = cutDoorways(
      dome,
      [{ ...spec, azimuthDeg: result.azimuthDeg }],
      R,
      { minStubLength: 6 },
    )
    expect(applied.doors[0].trimmedStrutCount).toBe(result.after.trimmed)
    expect(applied.doors[0].removedHubCount).toBe(result.after.hubsRemoved)
  })

  it('placement optimizer keeps clear of other doors', () => {
    const spec = { id: 'D1', azimuthDeg: 20, width: 36, height: 80 }
    const other = { id: 'D2', azimuthDeg: 30, width: 36, height: 80 }
    const result = optimizeDoorPlacement(dome, spec, R, {
      minStubLength: 6,
      increment: 1 / 8,
      otherDoors: [other],
    })
    let delta = Math.abs(result.azimuthDeg - other.azimuthDeg) % 360
    if (delta > 180) delta = 360 - delta
    // Clearance: half-widths (~13.5° combined for 36" doors on r=155") + 5° margin.
    expect(delta).toBeGreaterThan(13)
  })

  it('framed windows: sill-height opening with sill buck, bottom apron, and localized cut', () => {
    const win = { id: 'W1', azimuthDeg: 0, width: 36, height: 36, sillHeight: 40 }
    const cut = cutDoorways(dome, [win], R, { minStubLength: 6, studSpacing: 16 })
    const info = cut.doors[0]
    expect(info.fits).toBe(true)
    // The cut stays in the window band: nothing removed at the base ring.
    const z0 = dome.cutZ * R
    for (const eid of [...cut.removedEdges, ...cut.trimmedEdges]) {
      const e = dome.edges[eid]
      const zMax = Math.max(dome.vertices[e.v0].position[2], dome.vertices[e.v1].position[2]) * R
      // At least part of the strut reaches the window band.
      expect(zMax - z0).toBeGreaterThan(40 - 12)
    }
    // Bottom apron exists and the profile carries a bottom polyline.
    expect(info.closureBottomArea).toBeGreaterThan(0)
    expect(info.closureProfile!.bottom.length).toBeGreaterThan(0)
    expect(info.closureProfile!.lowHeight).toBeCloseTo(40, 9)
    // Cut list gains a sill member alongside jambs and header.
    const cl = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' },
      cut,
    )
    expect(cl.rows.some((r) => r.label === 'W1 sill' && r.roundedCutLength === 36)).toBe(true)
    expect(cl.rows.some((r) => r.label === 'W1 jamb')).toBe(true)
    expect(cl.rows.some((r) => r.label === 'W1 header')).toBe(true)
  })

  it('rejects a window pushed above the shell', () => {
    const tooHigh = cutDoorways(
      dome,
      [{ id: 'W1', azimuthDeg: 0, width: 36, height: 36, sillHeight: 160 }],
      R,
      { minStubLength: 6 },
    )
    expect(tooHigh.doors[0].fits).toBe(false)
  })

  it('doors and windows cut together without interfering', () => {
    const both = cutDoorways(
      dome,
      [
        { id: 'D1', azimuthDeg: 0, width: 36, height: 80 },
        { id: 'W1', azimuthDeg: 90, width: 36, height: 36, sillHeight: 40 },
      ],
      R,
      { minStubLength: 6, studSpacing: 16 },
    )
    expect(both.doors).toHaveLength(2)
    expect(both.doors[0].id).toBe('D1')
    expect(both.doors[1].id).toBe('W1')
    expect(both.doors[1].trimmedStrutCount + both.doors[1].removedStrutCount).toBeGreaterThan(0)
  })

  it('no doors → cut list is unchanged', () => {
    const base = buildCutList(dome, { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' })
    const withEmpty = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 1.5, units: 'imperial' },
      cutDoorways(dome, [], R, { minStubLength: 6 }),
    )
    expect(withEmpty.rows).toEqual(base.rows)
    expect(withEmpty.totalStruts).toBe(base.totalStruts)
  })
})

describe('panel sheet planning', () => {
  const dome = generateDome({ frequency: 5, fraction: '5/8' })

  it('groups faces into panel types matching the strut-type structure', () => {
    const plan = planPanels(dome, 156, { sheetW: 48, sheetL: 96, sheetLabel: '4×8', skinFactor: 1 })
    expect(plan.totalPanels).toBe(dome.faces.length)
    expect(plan.types.reduce((n, t) => n + t.count, 0)).toBe(dome.faces.length)
    expect(plan.types.length).toBeGreaterThan(2)
    expect(plan.totalSheets).toBeGreaterThan(0)
    for (const t of plan.types) {
      expect(t.area).toBeGreaterThan(0)
      expect(t.seamed ? t.sheets > 0 : t.perSheet > 0).toBe(true)
    }
    expect(plan.wasteFraction).toBeGreaterThanOrEqual(0)
    expect(plan.wasteFraction).toBeLessThan(1)
  })

  it('both skins double the panel count; exclusions reduce it', () => {
    const single = planPanels(dome, 156, { sheetW: 48, sheetL: 96, sheetLabel: '4×8', skinFactor: 1 })
    const both = planPanels(dome, 156, { sheetW: 48, sheetL: 96, sheetLabel: '4×8', skinFactor: 2 })
    expect(both.totalPanels).toBe(single.totalPanels * 2)
    expect(both.totalSheets).toBeGreaterThanOrEqual(single.totalSheets)
    const excluded = planPanels(dome, 156, {
      sheetW: 48, sheetL: 96, sheetLabel: '4×8', skinFactor: 1,
      excludeFaceIds: new Set([0, 1, 2]),
    })
    expect(excluded.totalPanels).toBe(single.totalPanels - 3)
  })

  it('flags 3V-size panels as seamed when they exceed one sheet', () => {
    const big = generateDome({ frequency: 3, fraction: '5/8' })
    const plan = planPanels(big, 156, { sheetW: 48, sheetL: 96, sheetLabel: '4×8', skinFactor: 1 })
    // 26 ft 3V panels have ~61" edges — none fit a 4×8 sheet whole.
    expect(plan.types.some((t) => t.seamed)).toBe(true)
  })
})

describe('units', () => {
  it('formats fractional inches', () => {
    expect(formatInchesFractional(37.375)).toBe('37 3/8″')
    expect(formatInchesFractional(0.5)).toBe('1/2″')
    expect(formatInchesFractional(36)).toBe('36″')
    expect(formatInchesFractional(35.999999)).toBe('36″')
    expect(formatFeetInches(316.5)).toBe('26′ 4 1/2″')
  })

  it('rounds to increments', () => {
    expect(roundToIncrement(37.34, 1 / 8)).toBeCloseTo(37.375, 12)
    expect(roundToIncrement(37.31, 1 / 8)).toBeCloseTo(37.25, 12)
  })
})

describe('riser wall', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150 // inches
  const opts = { height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6 }
  const boundaryEdgeCount = model.edges.filter((e) => e.faceIds.length === 1).length

  it('walks the base ring in order', () => {
    const ring = orderedBaseRing(model)
    expect(ring.length).toBe(boundaryEdgeCount)
    // Every consecutive pair is a boundary edge.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      expect(
        model.edges.some(
          (e) =>
            e.faceIds.length === 1 &&
            Math.min(e.v0, e.v1) === Math.min(a, b) &&
            Math.max(e.v0, e.v1) === Math.max(a, b),
        ),
      ).toBe(true)
    }
    // CCW from +z: positive signed area.
    let area2 = 0
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = model.vertices[ring[i]].position
      const [x1, y1] = model.vertices[ring[(i + 1) % ring.length]].position
      area2 += x0 * y1 - x1 * y0
    }
    expect(area2).toBeGreaterThan(0)
  })

  it('builds one segment per base-ring edge with plates top and bottom', () => {
    const riser = buildRiser(model, radius, opts)!
    expect(riser).not.toBeNull()
    expect(riser.segments.length).toBe(boundaryEdgeCount)
    const tops = riser.members.filter((m) => m.part === 'riser top plate')
    const bottoms = riser.members.filter((m) => m.part === 'riser bottom plate')
    expect(tops.length).toBe(boundaryEdgeCount)
    expect(bottoms.length).toBe(boundaryEdgeCount)
    const plateTotal = [...tops, ...bottoms].reduce((s, m) => s + m.length, 0)
    expect(plateTotal).toBeCloseTo(2 * riser.perimeter, 6)
    // Plates live on their planes.
    const zTop = model.cutZ * radius
    for (const m of tops) expect(m.a[2]).toBeCloseTo(zTop, 6)
    for (const m of bottoms) expect(m.a[2]).toBeCloseTo(zTop - opts.height, 6)
  })

  it('spaces studs on centers and posts every corner once', () => {
    const riser = buildRiser(model, radius, opts)!
    const studs = riser.members.filter((m) => m.part === 'riser stud')
    // One corner stud per ring vertex...
    const ring = orderedBaseRing(model)
    const cornerStuds = studs.filter((m) =>
      ring.some((vi) => {
        const p = model.vertices[vi].position
        return Math.hypot(m.a[0] - p[0] * radius, m.a[1] - p[1] * radius) < 1e-6
      }),
    )
    expect(cornerStuds.length).toBe(ring.length)
    // ...plus field studs at spacing, all full height.
    for (const m of studs) {
      expect(m.length).toBeCloseTo(opts.height, 6)
      expect(m.b[2] - m.a[2]).toBeCloseTo(opts.height, 6)
    }
    const fieldStuds = studs.length - cornerStuds.length
    const expected = riser.segments.reduce(
      (n, s) => n + Math.max(0, Math.floor((s.length - opts.minStubLength) / opts.studSpacing)),
      0,
    )
    expect(fieldStuds).toBe(expected)
  })

  it('reports sheathing area and joints', () => {
    const riser = buildRiser(model, radius, opts)!
    expect(riser.grossSheathingArea).toBeCloseTo(riser.perimeter * opts.height, 4)
    expect(riser.netSheathingArea).toBeCloseTo(riser.grossSheathingArea, 4) // no doors yet
    expect(riser.sheathingRects.length).toBe(riser.segments.length)
    expect(riser.jointCount).toBeGreaterThan(0)
    expect(riser.jointNodes.length).toBe(riser.jointCount)
  })

  it('returns null when disabled or inapplicable', () => {
    expect(buildRiser(model, radius, { ...opts, height: 0 })).toBeNull()
    const natural = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    expect(buildRiser(natural, radius, opts)).toBeNull()
    const full = generateDome({ frequency: 3, fraction: 'full' })
    expect(buildRiser(full, radius, opts)).toBeNull()
  })
})

describe('riser wall — door openings', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150
  const base = { height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6 }
  const door = { id: 'D1', azimuthDeg: 0, width: 48, height: 90 }

  it('cuts the door span out of both plates and adds king/trimmer studs', () => {
    const riser = buildRiser(model, radius, { ...base, doors: [door] })!
    const withOpenings = riser.segments.filter((s) => s.openings.length > 0)
    expect(withOpenings.length).toBeGreaterThan(0)
    const totalOpening = riser.segments
      .flatMap((s) => s.openings)
      .reduce((n, [d0, d1]) => n + (d1 - d0), 0)
    // The ring is polygonal, so the opening chord ≈ door width (within tolerance).
    expect(totalOpening).toBeGreaterThan(door.width * 0.95)
    expect(totalOpening).toBeLessThan(door.width * 1.3)
    expect(riser.members.some((m) => m.part === 'riser trimmer')).toBe(true)
    expect(riser.members.some((m) => m.part === 'riser king stud')).toBe(true)
    // No plate piece crosses an opening.
    for (const seg of riser.segments) {
      for (const [d0, d1] of seg.openings) {
        const dx = (seg.b[0] - seg.a[0]) / seg.length
        const dy = (seg.b[1] - seg.a[1]) / seg.length
        for (const m of riser.members) {
          if (m.part !== 'riser top plate' && m.part !== 'riser bottom plate') continue
          const pa = (m.a[0] - seg.a[0]) * dx + (m.a[1] - seg.a[1]) * dy
          const pb = (m.b[0] - seg.a[0]) * dx + (m.b[1] - seg.a[1]) * dy
          const onSeg =
            Math.min(pa, pb) > -1e-6 &&
            Math.max(pa, pb) < seg.length + 1e-6 &&
            Math.abs((m.a[0] - seg.a[0]) * dy - (m.a[1] - seg.a[1]) * dx) < 1e-6
          if (!onSeg) continue
          const overlap = Math.min(Math.max(pa, pb), d1) - Math.max(Math.min(pa, pb), d0)
          expect(overlap).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('drops field studs inside the opening and subtracts opening sheathing', () => {
    const cut = buildRiser(model, radius, { ...base, doors: [door] })!
    const plain = buildRiser(model, radius, base)!
    expect(cut.openingArea).toBeGreaterThan(0)
    expect(cut.netSheathingArea).toBeCloseTo(cut.grossSheathingArea - cut.openingArea, 4)
    const fieldStuds = (r: NonNullable<ReturnType<typeof buildRiser>>) =>
      r.members.filter((m) => m.part === 'riser stud').length
    expect(fieldStuds(cut)).toBeLessThanOrEqual(fieldStuds(plain))
  })

  it('ignores windows and handles doors on the far side', () => {
    const win = { id: 'W1', azimuthDeg: 0, width: 36, height: 36, sillHeight: 60 }
    const far = { id: 'D9', azimuthDeg: 180, width: 48, height: 90 }
    const riser = buildRiser(model, radius, { ...base, doors: [win] })!
    expect(riser.openingArea).toBe(0)
    const riserFar = buildRiser(model, radius, { ...base, doors: [far, door] })!
    expect(riserFar.segments.filter((s) => s.openings.length > 0).length).toBeGreaterThanOrEqual(2)
  })
})

describe('portals over a riser wall', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150
  const opts = { minStubLength: 6, riserHeight: 24 }
  const door = { id: 'D1', azimuthDeg: 0, width: 48, height: 90 }

  it('shrinks the shell cut to the part above the base plane', () => {
    const withRiser = cutDoorways(model, [door], radius, opts)
    const without = cutDoorways(model, [{ ...door, height: door.height - 24 }], radius, {
      minStubLength: 6,
    })
    // A 90″ door over a 24″ riser cuts the shell exactly like a 66″ door on the ground.
    expect(withRiser.removedEdges.size).toBe(without.removedEdges.size)
    expect(withRiser.trimmed.length).toBe(without.trimmed.length)
    const info = withRiser.doors[0]
    expect(info.buckBottomRel).toBeCloseTo(-24, 9)
    expect(info.buckTopRel).toBeCloseTo(66, 9)
    expect(info.jambLength).toBeCloseTo(90, 9) // full height through the riser
    expect(info.riserConflict).toBe(false)
  })

  it('flags a door not taller than the riser', () => {
    const stub = cutDoorways(model, [{ ...door, height: 20 }], radius, opts)
    expect(stub.doors[0].riserConflict).toBe(true)
    expect(stub.doors[0].fits).toBe(false)
    expect(stub.removedEdges.size).toBe(0)
    expect(stub.trimmed.length).toBe(0)
  })

  it('windows: sill measured from the floor, conflict when it dips into the riser', () => {
    const win = { id: 'W1', azimuthDeg: 0, width: 36, height: 36, sillHeight: 60, margin: 2 }
    const cut = cutDoorways(model, [win], radius, opts)
    const info = cut.doors[0]
    expect(info.buckBottomRel).toBeCloseTo(36, 9) // 60 − 24 above the base plane
    expect(info.riserConflict).toBe(false)
    // Same shell cut as a no-riser window with sill 36.
    const equiv = cutDoorways(model, [{ ...win, sillHeight: 36 }], radius, { minStubLength: 6 })
    expect(cut.removedEdges.size).toBe(equiv.removedEdges.size)
    expect(cut.trimmed.length).toBe(equiv.trimmed.length)
    // Sill inside the riser band (incl. margin) conflicts.
    const low = cutDoorways(model, [{ ...win, sillHeight: 25 }], radius, opts)
    expect(low.doors[0].riserConflict).toBe(true)
    expect(low.doors[0].fits).toBe(false)
  })

  it('riserHeight 0 or omitted is identical to today', () => {
    const a = cutDoorways(model, [door], radius, { minStubLength: 6 })
    const b = cutDoorways(model, [door], radius, { minStubLength: 6, riserHeight: 0 })
    expect(b.doors[0].buckBottomRel).toBe(0)
    expect(b.doors[0].buckTopRel).toBeCloseTo(door.height, 12)
    expect(a.removedEdges.size).toBe(b.removedEdges.size)
    expect(a.trimmed.length).toBe(b.trimmed.length)
    expect(a.doors[0].closureSideArea).toBeCloseTo(b.doors[0].closureSideArea, 9)
  })
})

describe('riser wall in the cut list', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150
  const riser = buildRiser(model, radius, {
    height: 24,
    studSpacing: 16,
    memberWidth: 1.5,
    minStubLength: 6,
    doors: [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }],
  })!
  const cutOpts = { radius, increment: 1 / 8, endOffset: 0, units: 'imperial' as const }

  it('adds grouped frame rows for every riser part', () => {
    const list = buildCutList(model, cutOpts, undefined, riser)
    const riserRows = list.rows.filter((r) => r.kind === 'frame' && r.label.startsWith('riser'))
    expect(riserRows.length).toBeGreaterThan(0)
    const qty = riserRows.reduce((n, r) => n + r.quantity, 0)
    expect(qty).toBe(riser.members.reduce((n, m) => n + m.quantity, 0))
    for (const part of [
      'riser top plate',
      'riser bottom plate',
      'riser stud',
      'riser king stud',
      'riser trimmer',
    ]) {
      expect(riserRows.some((r) => r.label === part)).toBe(true)
    }
    // Frame rows never count as struts; type rows stay index-stable.
    expect(list.rows[0].typeId).toBe(0)
    expect(list.totalStruts).toBe(buildCutList(model, cutOpts).totalStruts)
  })

  it('flows into packing and the optimizer', () => {
    const list = buildCutList(model, cutOpts, undefined, riser)
    const packed = packCuts(list, {
      kerf: 0.125,
      stock: [
        { length: 96, label: '8 ft' },
        { length: 144, label: '12 ft' },
      ],
    })
    const placed = packed.boards.flatMap((b) => b.cuts).length + packed.unplaceable.length
    expect(placed).toBe(list.rows.reduce((n, r) => n + r.quantity, 0))
    const result = optimizeDiameter(model, {
      minDiameter: 280,
      maxDiameter: 320,
      step: 8,
      increment: 1 / 8,
      endOffset: 0,
      kerf: 0.125,
      stock: [{ length: 144, label: '12 ft' }],
      units: 'imperial',
      doors: [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }],
      minStubLength: 6,
      riserHeight: 24,
      riserMemberWidth: 1.5,
    })
    expect(result.best).not.toBeNull()
  })
})

describe('riser sheathing rectangles in the panel plan', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const sheet = { sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet' }

  it('groups equal rects, nests them, and counts sheets', () => {
    const rects = [
      { w: 60, h: 24 },
      { w: 60, h: 24 },
      { w: 60, h: 24 },
      { w: 45.5, h: 24 },
    ]
    const plan = planPanels(model, 150, { ...sheet, skinFactor: 1, rects })
    expect(plan.rects.length).toBe(2)
    const r60 = plan.rects.find((r) => Math.abs(r.w - 60) < 1e-6)!
    expect(r60.count).toBe(3)
    // 60 along the 96 side, 24 along 48: floor(96/60)=1 × floor(48/24)=2 → 2/sheet.
    expect(r60.perSheet).toBe(2)
    expect(r60.seamed).toBe(false)
    expect(r60.sheets).toBe(Math.ceil(3 / r60.perSheet))
    // Totals include the rects.
    const solo = planPanels(model, 150, { ...sheet, skinFactor: 1 })
    expect(plan.totalSheets).toBe(solo.totalSheets + plan.rects.reduce((n, r) => n + r.sheets, 0))
  })

  it('doubles rect counts with two skins and flags oversize as seamed', () => {
    const plan = planPanels(model, 150, { ...sheet, skinFactor: 2, rects: [{ w: 60, h: 24 }] })
    expect(plan.rects[0].count).toBe(2)
    const big = planPanels(model, 150, { ...sheet, skinFactor: 1, rects: [{ w: 120, h: 60 }] })
    expect(big.rects[0].seamed).toBe(true)
    expect(big.rects[0].sheets).toBeGreaterThanOrEqual(2)
  })

  it('is absent-safe: no rects option → empty array', () => {
    const a = planPanels(model, 150, { ...sheet, skinFactor: 1 })
    expect(a.rects).toEqual([])
  })
})

describe('riser project settings', () => {
  it('round-trips riserHeightMm through the project file', () => {
    const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cutList = buildCutList(model, {
      radius: 150,
      increment: 1 / 8,
      endOffset: 0,
      units: 'imperial',
    })
    const packing = packCuts(cutList, { kerf: 0, stock: [{ length: 144, label: '12 ft' }] })
    const settings = {
      frequency: 3,
      fraction: '1/2',
      baseMode: 'leveled',
      diameter: 25,
      units: 'imperial',
      material: 'lumber-2x4',
      jointMethod: 'timber-plate',
      endOffset: 0,
      increment: 1 / 8,
      kerf: 0,
      stock: [],
      riserHeightMm: 610,
    }
    const text = projectJson(settings, model, cutList, packing)
    const parsed = parseProjectJson(text)!
    expect(parsed.riserHeightMm).toBe(610)
  })
})

describe('1V and 2V kits', () => {
  it('1V is the icosahedron cap: one strut type at both cuts', () => {
    const cap = generateDome({ frequency: 1, fraction: '3/8' })
    expect(cap.faces.length).toBe(5)
    expect(cap.strutTypes.length).toBe(1)
    const bowl = generateDome({ frequency: 1, fraction: '5/8' })
    expect(bowl.faces.length).toBe(15)
    expect(bowl.strutTypes.length).toBe(1)
    expect(bowl.strutTypes[0].chordFactor).toBeCloseTo(1.0514622, 5)
  })

  it('2V 1/2 is the classic hemisphere with two strut types', () => {
    const m = generateDome({ frequency: 2, fraction: '1/2' })
    expect(m.strutTypes.length).toBe(2)
    const cfs = m.strutTypes.map((t) => t.chordFactor).sort((a, b) => a - b)
    expect(cfs[0]).toBeCloseTo(0.546533, 5)
    expect(cfs[1]).toBeCloseTo(0.618034, 5)
    expect(m.cutZ).toBeCloseTo(0, 9)
  })
})

describe('zome generator — natural base', () => {
  const m = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })

  it('satisfies polar-zonohedron counts', () => {
    expect(m.vertices.length).toBe(1 + 8 * 5) // 1 + n(R+1)
    expect(m.edges.length).toBe(8 * 9) // n(2R+1)
    expect(m.faces.length).toBe(2 * 8 * 4) // 2nR
    expect(m.rhombi!.length).toBe(8 * 4) // nR
  })

  it('every strut identical at any pitch', () => {
    for (const pitch of [25, 45, 65]) {
      const z = generateZome({ sides: 8, pitchDeg: pitch, rows: 4, baseMode: 'natural' })
      expect(z.strutTypes.length).toBe(1)
      const cf = z.strutTypes[0].chordFactor
      for (const e of z.edges) expect(e.chordFactor).toBeCloseTo(cf, 9)
    }
  })

  it('rows are planar and the rim zigzags between two planes', () => {
    const zs = new Set(m.vertices.map((v) => Math.round(v.position[2] * 1e6)))
    expect(zs.size).toBe(6) // rows 0..5
    const baseVerts = m.vertices.filter((v) => v.isBase)
    const baseZs = new Set(baseVerts.map((v) => Math.round(v.position[2] * 1e6)))
    expect(baseZs.size).toBe(2) // zigzag: sides row + tips row
    expect(baseVerts.length).toBe(16)
  })

  it('faces wind outward and pitch trades height for width', () => {
    const centerZ = m.cutZ + m.unitHeight / 2
    for (const f of m.faces) {
      const [a, b, c] = f.vertexIds.map((vi) => m.vertices[vi].position)
      const n = cross(sub(b, a), sub(c, a))
      const cen = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3 - centerZ,
      ] as const
      expect(dot(n, cen)).toBeGreaterThan(0)
    }
    const tall = generateZome({ sides: 8, pitchDeg: 25, rows: 4, baseMode: 'natural' })
    const squat = generateZome({ sides: 8, pitchDeg: 65, rows: 4, baseMode: 'natural' })
    expect(tall.unitHeight).toBeGreaterThan(squat.unitHeight)
  })

  it('normalizes the widest kept row to unit radius', () => {
    const maxR = Math.max(...m.vertices.map((v) => Math.hypot(v.position[0], v.position[1])))
    expect(maxR).toBeCloseTo(1, 9)
  })
})

describe('zome generator — leveled base', () => {
  const m = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'leveled' })

  it('fills the zigzag: +n triangles, +n base chords, two strut types', () => {
    expect(m.vertices.length).toBe(1 + 8 * 5)
    expect(m.edges.length).toBe(2 * 8 * 5) // 2n(R+1)
    expect(m.faces.length).toBe(2 * 8 * 4 + 8) // 2nR + n
    expect(m.strutTypes.length).toBe(2)
    const chordType = m.strutTypes.find((t) => t.count === 8)!
    for (const eid of chordType.edgeIds) {
      const e = m.edges[eid]
      // Base chords are horizontal, at the lowest row.
      expect(m.vertices[e.v0].position[2]).toBeCloseTo(m.cutZ, 9)
      expect(m.vertices[e.v1].position[2]).toBeCloseTo(m.cutZ, 9)
    }
  })

  it('has a planar 8-hub base ring the riser can walk', () => {
    const baseVerts = m.vertices.filter((v) => v.isBase)
    expect(baseVerts.length).toBe(8)
    expect(orderedBaseRing(m).length).toBe(8)
    const riser = buildRiser(m, 150, {
      height: 24,
      studSpacing: 16,
      memberWidth: 1.5,
      minStubLength: 6,
    })!
    expect(riser).not.toBeNull()
    expect(riser.segments.length).toBe(8)
  })

  it('natural zome cannot take a riser (zigzag)', () => {
    const nat = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
    expect(
      buildRiser(nat, 150, { height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6 }),
    ).toBeNull()
  })

  it('half-rhombus triangles carry three real edges', () => {
    const halfTris = m.faces.slice(2 * 8 * 4)
    expect(halfTris.length).toBe(8)
    for (const f of halfTris) expect(f.edgeIds.length).toBe(3)
  })
})

describe('rhombus panels in the sheet plan', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const sheet = { sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet' }

  it('nests two rhombi per bounding rect and groups by diagonals', () => {
    const plan = planPanels(model, 150, {
      ...sheet,
      skinFactor: 1,
      rhombs: [
        { d1: 60, d2: 40 },
        { d1: 60, d2: 40 },
        { d1: 90, d2: 30 },
      ],
    })
    expect(plan.rhombs.length).toBe(2)
    const z = plan.rhombs.find((r) => Math.abs(r.d1 - 60) < 1e-6)!
    expect(z.count).toBe(2)
    expect(z.area).toBeCloseTo(1200, 9)
    // 60×40 bounding rect: floor(96/60)=1 × floor(48/40)=1 × 2 = 2 per sheet.
    expect(z.perSheet).toBe(2)
    expect(z.sheets).toBe(1)
  })

  it('doubles with two skins, seams oversize, defaults empty', () => {
    const dbl = planPanels(model, 150, { ...sheet, skinFactor: 2, rhombs: [{ d1: 60, d2: 40 }] })
    expect(dbl.rhombs[0].count).toBe(2)
    const big = planPanels(model, 150, { ...sheet, skinFactor: 1, rhombs: [{ d1: 120, d2: 60 }] })
    expect(big.rhombs[0].seamed).toBe(true)
    expect(planPanels(model, 150, { ...sheet, skinFactor: 1 }).rhombs).toEqual([])
  })
})

describe('portals on a zome', () => {
  const m = generateZome({ sides: 10, pitchDeg: 45, rows: 5, baseMode: 'leveled' })
  const radius = 150

  it('cuts a doorway: trims land on envelope planes, closure builds', () => {
    const cut = cutDoorways(m, [{ id: 'D1', azimuthDeg: 18, width: 40, height: 80 }], radius, {
      minStubLength: 6,
      studSpacing: 16,
    })
    const d = cut.doors[0]
    expect(d.fits).toBe(true)
    expect(cut.removedEdges.size + cut.trimmedEdges.size).toBeGreaterThan(0)
    expect(d.closureProfile).not.toBeNull()
    expect(d.closureFraming.length).toBeGreaterThan(0)
    // Every trimmed cut end sits on an envelope boundary plane or a hub.
    const az = (18 * Math.PI) / 180
    const ux = Math.cos(az)
    const uy = Math.sin(az)
    const hw = 20
    const z0 = m.cutZ * radius
    for (const t of cut.trimmed) {
      for (const p of [t.aUnit, t.bUnit]) {
        const x = p[0] * radius
        const y = p[1] * radius
        const z = p[2] * radius
        const tt = -uy * x + ux * y
        const u = ux * x + uy * y
        const onPlane =
          Math.abs(Math.abs(tt) - hw) < 1e-6 ||
          Math.abs(z - z0 - 80) < 1e-6 ||
          Math.abs(u - d.framePlaneDist) < 1e-6 ||
          m.vertices.some(
            (v) =>
              Math.hypot(
                v.position[0] * radius - x,
                v.position[1] * radius - y,
                v.position[2] * radius - z,
              ) < 1e-6,
          )
        expect(onPlane).toBe(true)
      }
    }
  })

  it('windows and the placement optimizer work', () => {
    const win = { id: 'W1', azimuthDeg: 90, width: 30, height: 30, sillHeight: 40 }
    const cut = cutDoorways(m, [win], radius, { minStubLength: 6 })
    expect(cut.doors[0].fits).toBe(true)
    const placed = optimizeDoorPlacement(m, win, radius, { minStubLength: 6, increment: 1 / 8 })
    expect(placed.evaluated).toBeGreaterThan(100)
    expect(placed.after.score).toBeLessThanOrEqual(placed.before.score + 1e-9)
  })
})

describe('zome project settings', () => {
  it('round-trips mode and zome params through the project file', () => {
    const m = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'leveled' })
    const cl = buildCutList(m, { radius: 150, increment: 1 / 8, endOffset: 0, units: 'imperial' })
    const pk = packCuts(cl, { kerf: 0, stock: [{ length: 144, label: '12 ft' }] })
    const text = projectJson(
      {
        frequency: 5,
        fraction: '5/8',
        baseMode: 'leveled',
        diameter: 26,
        units: 'imperial',
        material: 'lumber-2x4',
        jointMethod: 'timber-plate',
        endOffset: 0,
        increment: 1 / 8,
        kerf: 0,
        stock: [],
        mode: 'zome',
        zomeSides: 8,
        zomePitchDeg: 52,
        zomeRows: 4,
      },
      m,
      cl,
      pk,
    )
    const parsed = parseProjectJson(text)!
    expect(parsed.mode).toBe('zome')
    expect(parsed.zomeSides).toBe(8)
    expect(parsed.zomePitchDeg).toBe(52)
    expect(parsed.zomeRows).toBe(4)
  })
})

describe('hub axes', () => {
  it('geodesic axes point along the vertex radial', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const axes = hubAxes(m)
    expect(axes.length).toBe(m.vertices.length)
    for (const v of m.vertices) {
      const a = axes[v.id]
      expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 9)
      const p = v.position
      const pl = Math.hypot(p[0], p[1], p[2])
      expect((a[0] * p[0] + a[1] * p[1] + a[2] * p[2]) / pl).toBeGreaterThan(0.9)
    }
  })

  it('zome apex axis is +z', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'leveled' })
    const axes = hubAxes(z)
    const apex = z.vertices.reduce((a, b) => (a.position[2] > b.position[2] ? a : b))
    expect(axes[apex.id][2]).toBeCloseTo(1, 6)
  })
})

describe('miter cuts', () => {
  it('computes symmetric seams at the 1V apex', () => {
    const m = generateDome({ frequency: 1, fraction: '5/8' })
    const cuts = miterCuts(m)
    expect(cuts.length).toBe(m.edges.length)
    const apex = m.vertices.reduce((a, b) => (a.position[2] > b.position[2] ? a : b))
    const apexEnds = m.edges
      .filter((e) => e.v0 === apex.id || e.v1 === apex.id)
      .map((e) => cuts[e.id][e.v0 === apex.id ? 0 : 1])
    expect(apexEnds.length).toBe(5)
    for (const end of apexEnds) {
      expect(end.vertexId).toBe(apex.id)
      expect(end.leftSeamDeg).toBeCloseTo(apexEnds[0].leftSeamDeg, 6)
      expect(end.rightSeamDeg).toBeCloseTo(end.leftSeamDeg, 6)
      expect(end.leftSeamDeg).toBeGreaterThan(10)
      expect(end.leftSeamDeg).toBeLessThan(45)
    }
    // Verify against a direct nearest-neighbor angle computation.
    const dirs = m.edges
      .filter((e) => e.v0 === apex.id || e.v1 === apex.id)
      .map((e) => {
        const other = e.v0 === apex.id ? e.v1 : e.v0
        const p = m.vertices[other].position
        const a = apex.position
        const d = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
        const l = Math.hypot(d[0], d[1], d[2])
        return [d[0] / l, d[1] / l, d[2] / l]
      })
    let minAngle = Infinity
    for (let i = 1; i < dirs.length; i++) {
      const c = dirs[0][0] * dirs[i][0] + dirs[0][1] * dirs[i][1] + dirs[0][2] * dirs[i][2]
      minAngle = Math.min(minAngle, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI)
    }
    expect(apexEnds[0].leftSeamDeg).toBeCloseTo(minAngle / 2, 6)
  })

  it('tilt tracks the axial angle and the zome apex is symmetric', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cuts = miterCuts(m)
    // Tight correlation at interior hubs only — base hubs have one-sided
    // face fans that legitimately lean the axis outward.
    let checked = 0
    for (const e of m.edges) {
      const t = m.strutTypes[e.typeId]
      for (const end of cuts[e.id]) {
        if (m.vertices[end.vertexId].isBase) continue
        expect(Math.abs(end.tiltDeg - (90 - t.axialAngleDeg))).toBeLessThan(2)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 3, baseMode: 'natural' })
    const zc = miterCuts(z)
    const apex = z.vertices.reduce((a, b) => (a.position[2] > b.position[2] ? a : b))
    const apexEnds = z.edges
      .filter((e) => e.v0 === apex.id || e.v1 === apex.id)
      .map((e) => zc[e.id][e.v0 === apex.id ? 0 : 1])
    expect(apexEnds.length).toBe(8)
    for (const end of apexEnds) expect(end.leftSeamDeg).toBeCloseTo(apexEnds[0].leftSeamDeg, 6)
  })
})

describe('mitered joint method', () => {
  it('is a registered joint method with zero end offset', () => {
    const m = JOINT_METHODS.find((j) => j.id === 'mitered')!
    expect(m).toBeDefined()
    expect(m.defaultEndOffset).toBe(0)
  })

  it('miterCsv emits one row per strut end with sane angles', () => {
    const model = generateDome({ frequency: 2, fraction: '1/2' })
    const csv = miterCsv(model, 'imperial', 150)
    const lines = csv.trim().split('\n')
    expect(lines.length).toBe(1 + model.edges.length * 2)
    for (const line of lines.slice(1)) {
      const cols = line.split(',')
      for (const deg of [cols[5], cols[6], cols[7]].map(Number)) {
        expect(deg).toBeGreaterThanOrEqual(0)
        expect(deg).toBeLessThanOrEqual(90)
      }
    }
  })
})

describe('fabrication drawings', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const cl = buildCutList(model, {
    radius: 150,
    increment: 1 / 8,
    endOffset: 1.5,
    units: 'imperial',
  })
  const rectSection = { kind: 'rect' as const, width: 1.5, depth: 3.5 }

  it('templates print at true scale with a calibration ruler', () => {
    const svg = cutTemplatesSvg(model, cl, {
      units: 'imperial',
      jointId: 'timber-plate',
      endOffset: 1.5,
      radius: 150,
      section: rectSection,
      title: 'test',
    })
    expect(svg).toContain('width="8.5in"')
    expect(svg).toContain('data-cal-length="3"')
    // One page per strut type for timber-plate (constant axial bevel per type).
    const pages = svg.match(/data-template-page/g) ?? []
    expect(pages.length).toBe(model.strutTypes.length)
    const metric = cutTemplatesSvg(model, cl, {
      units: 'metric',
      jointId: 'timber-plate',
      endOffset: 38,
      radius: 3810,
      section: { kind: 'rect', width: 38, depth: 89 },
      title: 'test',
    })
    expect(metric).toContain('width="210mm"')
    expect(metric).toContain('data-cal-length="75"')
  })

  it('mitered templates group end signatures; pipe pages mark hole centers', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'leveled' })
    const zcl = buildCutList(z, { radius: 130, increment: 1 / 8, endOffset: 0, units: 'imperial' })
    const svg = cutTemplatesSvg(z, zcl, {
      units: 'imperial',
      jointId: 'mitered',
      endOffset: 0,
      radius: 130,
      section: rectSection,
      title: 'test',
    })
    const pages = svg.match(/data-template-page/g) ?? []
    expect(pages.length).toBeGreaterThan(z.strutTypes.length)
    expect(svg).toContain('blade tilt')
    const pipe = cutTemplatesSvg(model, cl, {
      units: 'imperial',
      jointId: 'flattened-pipe',
      endOffset: 0,
      radius: 150,
      section: { kind: 'round', diameter: 0.92 },
      title: 'test',
    })
    expect(pipe).toContain('data-hole-center')
  })

  it('board diagrams draw every board with kerf ticks and waste', () => {
    const packing = packCuts(cl, {
      kerf: 0.125,
      stock: [
        { length: 96, label: '8 ft' },
        { length: 144, label: '12 ft' },
      ],
    })
    const svg = boardDiagramsSvg(packing, { units: 'imperial', title: 'test', kerf: 0.125 })
    const bars = svg.match(/data-board=/g) ?? []
    expect(bars.length).toBe(packing.boards.length)
    const ticks = svg.match(/data-kerf-tick/g) ?? []
    expect(ticks.length).toBe(
      packing.boards.reduce((n, b) => n + Math.max(0, b.cuts.length - 1), 0),
    )
    expect(svg).toContain('waste')
    for (const g of packing.boardCounts) expect(svg).toContain(g.stockLabel)
    const empty = boardDiagramsSvg(packCuts(cl, { kerf: 0, stock: [] }), {
      units: 'imperial',
      title: 'empty',
      kerf: 0,
    })
    expect(empty).toContain('<svg')
  })
})

describe('hardware BOM', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const noDoors = emptyDoorwayCut()
  const plan = planPanels(model, 150, {
    sheetW: 48,
    sheetL: 96,
    sheetLabel: '4×8 ft sheet',
    skinFactor: 1,
  })
  const V = model.vertices.length
  const E = model.edges.length
  const baseHubs = model.vertices.filter((v) => v.isBase).length

  it('hub method: connectors by valence, bolt per strut end', () => {
    const bom = buildBom(model, noDoors, null, 'hub', plan)
    const connectors = bom.filter((l) => l.key === 'hub-connector')
    expect(connectors.reduce((n, l) => n + l.quantity, 0)).toBe(V)
    expect(bom.find((l) => l.key === 'bolt')!.quantity).toBe(2 * E)
    expect(bom.find((l) => l.key === 'washer')!.quantity).toBe(4 * E)
    expect(bom.find((l) => l.key === 'anchor')!.quantity).toBe(baseHubs)
    expect(bom.find((l) => l.key === 'screw-panel')!.quantity).toBeGreaterThan(0)
  })

  it('pipe: one stack bolt per vertex; plate/mitered: 2 screws per end', () => {
    const pipe = buildBom(model, noDoors, null, 'flattened-pipe', plan)
    expect(pipe.find((l) => l.key === 'bolt')!.quantity).toBe(V)
    const plate = buildBom(model, noDoors, null, 'timber-plate', plan)
    expect(plate.filter((l) => l.key === 'hub-plate').reduce((n, l) => n + l.quantity, 0)).toBe(V)
    expect(plate.find((l) => l.key === 'screw-structural')!.quantity).toBe(2 * 2 * E)
    const mitered = buildBom(model, noDoors, null, 'mitered', plan)
    expect(mitered.find((l) => l.key === 'screw-structural')!.quantity).toBe(2 * 2 * E)
    expect(mitered.find((l) => l.key === 'glue-seam')!.quantity).toBe(
      model.vertices.reduce((n, v) => n + v.edgeIds.length, 0),
    )
  })

  it('doorway and riser adjust counts', () => {
    const doors = cutDoorways(model, [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }], 150, {
      minStubLength: 6,
      studSpacing: 16,
    })
    const riser = buildRiser(model, 150, {
      height: 24,
      studSpacing: 16,
      memberWidth: 1.5,
      minStubLength: 6,
      doors: [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }],
    })!
    const bom = buildBom(model, doors, riser, 'hub', plan)
    const connectors = bom.filter((l) => l.key === 'hub-connector')
    expect(connectors.reduce((n, l) => n + l.quantity, 0)).toBe(V - doors.removedVertices.size)
    const framingJoints =
      doors.doors.reduce((n, d) => n + d.closureJointCount, 0) + riser.jointCount
    expect(bom.find((l) => l.key === 'screw-framing')!.quantity).toBe(3 * framingJoints)
    expect(bom.find((l) => l.key === 'anchor')!.quantity).toBe(riser.segments.length)
  })
})

describe('cost estimate', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const plan = planPanels(model, 150, {
    sheetW: 48,
    sheetL: 96,
    sheetLabel: '4×8 ft sheet',
    skinFactor: 1,
  })
  const bom = buildBom(model, emptyDoorwayCut(), null, 'timber-plate', plan)
  const base = {
    boardCounts: [{ stockLabel: '12 ft', count: 30 }],
    totalSheets: plan.totalSheets,
    sheetLabel: plan.sheetLabel,
    bom,
    floorArea: Math.PI * (model.unitBaseRadius * 150) ** 2,
    units: 'imperial' as const,
  }

  it('prices with defaults, overrides win, unknown labels go unpriced', () => {
    const est = estimateCost({ ...base, prices: {} })
    const boards = est.lines.find((l) => l.key === 'stock:12 ft')!
    expect(boards.priceEach).toBe(defaultPrice('stock:12 ft', '12 ft', 'imperial'))
    expect(boards.total).toBeCloseTo(boards.priceEach * 30, 9)
    expect(est.total).toBeGreaterThan(0)
    expect(est.perArea).toBeCloseTo(est.total / (base.floorArea / 144), 9)

    const withOverride = estimateCost({ ...base, prices: { 'stock:12 ft': 9.99 } })
    expect(withOverride.lines.find((l) => l.key === 'stock:12 ft')!.priceEach).toBe(9.99)

    const weird = estimateCost({
      ...base,
      prices: {},
      boardCounts: [{ stockLabel: '3.14 m', count: 5 }],
    })
    const line = weird.lines.find((l) => l.key === 'stock:3.14 m')!
    expect(line.unpriced).toBe(true)
    expect(weird.unpricedCount).toBeGreaterThan(0)
    expect(weird.total).toBe(
      weird.lines.filter((l) => !l.unpriced).reduce((n, l) => n + l.total, 0),
    )
  })

  it('glue seams are informational, not unpriced', () => {
    const mBom = buildBom(model, emptyDoorwayCut(), null, 'mitered', plan)
    const est = estimateCost({ ...base, bom: mBom, prices: {} })
    const glue = est.lines.find((l) => l.key === 'glue-seam')!
    expect(glue.total).toBe(0)
    expect(glue.unpriced).toBe(false)
  })
})

describe('costs csv', () => {
  it('emits lines and totals with the currency symbol', () => {
    const model = generateDome({ frequency: 2, fraction: '1/2' })
    const plan = planPanels(model, 150, {
      sheetW: 48,
      sheetL: 96,
      sheetLabel: '4×8 ft sheet',
      skinFactor: 1,
    })
    const bom = buildBom(model, emptyDoorwayCut(), null, 'hub', plan)
    const est = estimateCost({
      boardCounts: [{ stockLabel: '8 ft', count: 10 }],
      totalSheets: plan.totalSheets,
      sheetLabel: plan.sheetLabel,
      bom,
      prices: {},
      floorArea: 1e5,
      units: 'imperial',
    })
    const csv = costsCsv(est, '$')
    expect(csv).toContain('Unit price ($)')
    expect(csv).toContain('Total ($)')
    expect(csv.split('\n').length).toBeGreaterThan(est.lines.length)
  })
})

describe('assembly guide', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const plan = buildAssemblyPlan(model)
  const cl = buildCutList(model, {
    radius: 150,
    increment: 1 / 8,
    endOffset: 1.5,
    units: 'imperial',
  })

  it('renders a cover plus one page per course', () => {
    const svg = assemblyGuideSvg(model, plan, cl, { units: 'imperial', radius: 150, title: 'test' })
    const pages = svg.match(/data-course-page/g) ?? []
    expect(pages.length).toBe(plan.courses.length)
    expect(svg).toContain('width="8.5in"')
    expect(svg).toContain(String(cl.totalStruts))
    expect(svg).toContain(formatInchesFractional(cl.rows[0].roundedCutLength))
    const marks = svg.match(/data-new-strut/g) ?? []
    expect(marks.length).toBe(
      plan.courses.reduce((n, c) => n + c.ringStrutIds.length + c.riserStrutIds.length, 0),
    )
  })

  it('a doored dome renders with excluded struts absent', () => {
    const doors = cutDoorways(model, [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }], 150, {
      minStubLength: 6,
    })
    const dPlan = buildAssemblyPlan(model, new Set([...doors.removedEdges, ...doors.trimmedEdges]))
    const svg = assemblyGuideSvg(model, dPlan, cl, {
      units: 'imperial',
      radius: 150,
      title: 'test',
    })
    const marks = svg.match(/data-new-strut/g) ?? []
    expect(marks.length).toBe(
      dPlan.courses.reduce((n, c) => n + c.ringStrutIds.length + c.riserStrutIds.length, 0),
    )
  })
})

describe('panel flat patterns', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })

  it('one dimensioned page per panel family member', () => {
    const plan = planPanels(model, 150, {
      sheetW: 48,
      sheetL: 96,
      sheetLabel: '4×8 ft sheet',
      skinFactor: 1,
      rects: [{ w: 40, h: 24 }],
      rhombs: [{ d1: 60, d2: 40 }],
    })
    const svg = panelPatternsSvg(plan, { units: 'imperial', title: 'test' })
    const pages = svg.match(/data-pattern-page/g) ?? []
    expect(pages.length).toBe(plan.types.length + plan.rects.length + plan.rhombs.length)
    const first = svg.indexOf('data-pattern-page')
    const second = svg.indexOf('data-pattern-page', first + 1)
    const firstPage = svg.slice(first, second)
    const angles = [...firstPage.matchAll(/data-angle="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(angles.length).toBe(3)
    expect(angles[0] + angles[1] + angles[2]).toBeCloseTo(180, 1)
    expect(svg).toContain(formatInchesFractional(plan.types[0].edges[0]))
    expect(svg).toContain('drawn to fit')
  })

  it('empty plan renders a placeholder', () => {
    const empty = panelPatternsSvg(
      planPanels(model, 150, {
        sheetW: 48,
        sheetL: 96,
        sheetLabel: '4×8 ft sheet',
        skinFactor: 1,
        excludeFaceIds: new Set(model.faces.map((f) => f.id)),
      }),
      { units: 'imperial', title: 'empty' },
    )
    expect(empty).toContain('no panels')
  })
})
