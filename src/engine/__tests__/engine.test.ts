import { describe, expect, it } from 'vitest'
import { icosahedron } from '../icosahedron'
import { subdivideIcosahedron } from '../subdivide'
import { generateDome } from '../dome'
import { buildCutList } from '../cutlist'
import { packCuts } from '../packing'
import { optimizeDiameter } from '../optimize'
import { analyzeOpenings } from '../openings'
import { cutDoorways, optimizeDoorPlacement } from '../doorway'
import { planPanels } from '../panels'
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
