import { describe, expect, it } from 'vitest'
import { sectionArea, sectionImin, solveTruss } from '../loads'

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
  it('matches the textbook two-bar symmetric truss', () => {
    const nodes: [number, number, number][] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ]
    const members = [
      { i: 0, j: 2, ea: 1e6 },
      { i: 1, j: 2, ea: 1e6 },
    ]
    const load = new Float64Array(9)
    load[2 * 3 + 2] = -1000 // apex, -z
    const res = solveTruss(nodes, members, [true, true, false], [load])
    expect(res).not.toBeNull()
    // Vertical equilibrium: 2 N sin45° = −1000 → N = −707.1 (compression)
    expect(res!.forces[0][0]).toBeCloseTo(-1000 / (2 * Math.sin(Math.PI / 4)), 3)
    expect(res!.forces[0][1]).toBeCloseTo(res!.forces[0][0], 6)
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
