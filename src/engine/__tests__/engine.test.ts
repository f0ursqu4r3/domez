import { describe, expect, it } from 'vitest'
import { icosahedron } from '../icosahedron'
import { subdivideIcosahedron } from '../subdivide'
import { generateDome } from '../dome'
import { buildCutList } from '../cutlist'
import { packCuts } from '../packing'
import { optimizeDiameter } from '../optimize'
import { analyzeOpenings } from '../openings'
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
