import { describe, expect, it } from 'vitest'
import { analyzeLoads, compressionCapacityN, sectionArea, sectionImin, solveTruss } from '../loads'
import { generateDome } from '../dome'
import { generateZome } from '../zome'
import { generateGoldberg } from '../goldberg'

describe('section properties', () => {
  it('computes rect and tube properties in SI', () => {
    // 2×4: 38 × 89 mm
    expect(sectionArea({ kind: 'rect', widthMm: 38, depthMm: 89 })).toBeCloseTo(0.038 * 0.089, 9)
    expect(sectionImin({ kind: 'rect', widthMm: 38, depthMm: 89 })).toBeCloseTo(
      (0.089 * 0.038 ** 3) / 12,
      12,
    )
    // EMT ¾″: OD 23.4, wall 1.07 → ID 21.26 mm
    const od = 0.0234
    const id = 0.02126
    expect(sectionArea({ kind: 'round', odMm: 23.4 }, 1.07)).toBeCloseTo(
      (Math.PI / 4) * (od * od - id * id),
      10,
    )
    expect(sectionImin({ kind: 'round', odMm: 23.4 }, 1.07)).toBeCloseTo(
      (Math.PI / 64) * (od ** 4 - id ** 4),
      14,
    )
    expect(() => sectionArea({ kind: 'round', odMm: 23.4 })).toThrow()
  })
})

describe('truss solver', () => {
  it('matches the textbook square-pyramid truss', () => {
    // NOTE: a 3D two-bar "textbook" truss is ill-posed here — the apex has
    // zero stiffness out of plane, so K is legitimately singular. The
    // pyramid constrains all three apex DOF.
    const nodes: [number, number, number][] = [
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
      [0, 0, 1],
    ]
    const members = [0, 1, 2, 3].map((i) => ({ i, j: 4, ea: 1e6 }))
    const load = new Float64Array(15)
    load[4 * 3 + 2] = -1000 // apex, -z
    const res = solveTruss(nodes, members, [true, true, true, true, false], [load])
    expect(res).not.toBeNull()
    // Leg length √3, vertical component 1/√3: 4N/√3 = −1000 → N = −433.0
    for (let m = 0; m < 4; m++) {
      expect(res!.forces[0][m]).toBeCloseTo((-1000 * Math.sqrt(3)) / 4, 2)
    }
    // An unconstrained direction anywhere means mechanism — a two-bar
    // planar truss in 3D must be REJECTED, not silently solved.
    expect(
      solveTruss(
        [
          [-1, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
        [
          { i: 0, j: 2, ea: 1e6 },
          { i: 1, j: 2, ea: 1e6 },
        ],
        [true, true, false],
        [new Float64Array(9)],
      ),
    ).toBeNull()
  })

  it('matches the tripod and reports mechanisms', () => {
    const nodes: [number, number, number][] = [0, 1, 2]
      .map((k) => (2 * Math.PI * k) / 3)
      .map((a) => [Math.cos(a), Math.sin(a), 0] as [number, number, number])
    nodes.push([0, 0, 1])
    const members = [0, 1, 2].map((i) => ({ i, j: 3, ea: 1e6 }))
    const load = new Float64Array(12)
    load[3 * 3 + 2] = -1000
    const res = solveTruss(nodes, members, [true, true, true, false], [load])
    expect(res).not.toBeNull()
    // Each leg: 3 N (1/√2) = −1000 → N = −471.40
    for (let m = 0; m < 3; m++) {
      expect(res!.forces[0][m]).toBeCloseTo(-1000 * (Math.sqrt(2) / 3), 2)
    }
    // No supports at all → singular → mechanism.
    expect(solveTruss(nodes, members, [false, false, false, false], [load])).toBeNull()
  })
})

const FIR = { eMPa: 11000, densityKgM3: 500, sigmaTMPa: 5, sigmaCMPa: 7 }
const SECT = { kind: 'rect', widthMm: 38, depthMm: 89 } as const
const INPUTS = { snowKPa: 0.96, windKPa: 0.96, skinKgM2: 8.5, skinFactor: 1 as const }

describe('analyzeLoads on a geodesic dome', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })

  it('satisfies vertical equilibrium under dead load alone', () => {
    const res = analyzeLoads(model, 156, 'imperial', SECT, FIR, {
      snowKPa: 0,
      windKPa: 0,
      skinKgM2: 8.5,
      skinFactor: 1,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const sumRz = res.reactions.reduce((s, r) => s + r.fN[2], 0)
    expect(Math.abs(sumRz - res.totalWeightN) / res.totalWeightN).toBeLessThan(1e-6)
    expect(res.reactions.every((r) => !r.uplift)).toBe(true)
  })

  it('puts crown struts in compression and reports sane utilizations', () => {
    const res = analyzeLoads(model, 156, 'imperial', SECT, FIR, INPUTS)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const zTop = Math.max(...model.vertices.map((v) => v.position[2]))
    const crown = model.edges.filter(
      (e) =>
        (model.vertices[e.v0].position[2] + model.vertices[e.v1].position[2]) / 2 > 0.9 * zTop,
    )
    expect(crown.length).toBeGreaterThan(0)
    for (const e of crown) expect(res.members[e.id].forceN).toBeLessThan(0)
    expect(res.maxUtilization).toBeGreaterThan(0)
    expect(Number.isFinite(res.maxUtilization)).toBe(true)
  })

  it('snow governs when snow dwarfs wind; wind breaks symmetry', () => {
    const snowy = analyzeLoads(model, 156, 'imperial', SECT, FIR, {
      snowKPa: 5,
      windKPa: 0.05,
      skinKgM2: 8.5,
      skinFactor: 1,
    })
    expect(snowy.ok).toBe(true)
    if (!snowy.ok) return
    const worst = [...snowy.members].sort((a, b) => b.utilization - a.utilization)[0]
    expect(worst.caseLabel).toBe('D+S')
    for (const m of snowy.members) expect(['D', 'D+S', 'D+W']).toContain(m.caseLabel)

    const windy = analyzeLoads(model, 156, 'imperial', SECT, FIR, {
      snowKPa: 0,
      windKPa: 2,
      skinKgM2: 8.5,
      skinFactor: 1,
    })
    expect(windy.ok).toBe(true)
    if (!windy.ok) return
    // Wind along +x: forces across one strut type must spread (windward ≠ leeward).
    const byType = new Map<number, number[]>()
    for (const e of model.edges) {
      if (!byType.has(e.typeId)) byType.set(e.typeId, [])
      byType.get(e.typeId)!.push(windy.members[e.id].forceN)
    }
    const spreads = [...byType.values()].map((f) => Math.max(...f) - Math.min(...f))
    expect(Math.max(...spreads)).toBeGreaterThan(1)
  })

  it('Euler capacity falls with the square of length', () => {
    const c1 = compressionCapacityN(FIR, SECT, 1)
    const c2 = compressionCapacityN(FIR, SECT, 2)
    // Both Euler-governed for a 2×4 at these lengths.
    expect(c2).toBeCloseTo(c1 / 4, 1)
    // Short column caps at crushing σc·A.
    const short = compressionCapacityN(FIR, SECT, 0.2)
    expect(short).toBeCloseTo(7e6 * 0.038 * 0.089, 3)
  })

  it('reports a mechanism when nothing is anchored', () => {
    const floating = {
      ...model,
      vertices: model.vertices.map((v) => ({ ...v, isBase: false })),
    }
    const res = analyzeLoads(floating, 156, 'imperial', SECT, FIR, INPUTS)
    expect(res).toEqual({ ok: false, reason: 'mechanism' })
  })

  it('declines zome and goldberg families honestly', () => {
    const zome = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
    const gold = generateGoldberg({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    expect(analyzeLoads(zome, 156, 'imperial', SECT, FIR, INPUTS)).toEqual({
      ok: false,
      reason: 'unsupported-family',
    })
    expect(analyzeLoads(gold, 156, 'imperial', SECT, FIR, INPUTS)).toEqual({
      ok: false,
      reason: 'unsupported-family',
    })
  })
})
