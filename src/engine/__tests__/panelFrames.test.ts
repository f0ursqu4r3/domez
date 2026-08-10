import { describe, expect, it } from 'vitest'
import { buildPanelFrames } from '../panelFrames'
import { generateDome } from '../dome'
import { generateZome } from '../zome'
import { generateGoldberg } from '../goldberg'
import { emptyDoorwayCut } from '../doorway'
import { buildCutList } from '../cutlist'
import { packCuts } from '../packing'
import { buildBom } from '../bom'
import { planPanels } from '../panels'
import { framesCsv } from '../exports/csv'
import { optimizeDiameter } from '../optimize'

// Match the exact generator/param call shapes used in engine.test.ts, and
// the actual empty-doorway helper name exported by doorway.ts (grep for the
// function returning `{ doors: [], removedEdges: new Set(), … }`). Only the
// import lines may adapt — assertions are fixed.

const NO_DOOR = emptyDoorwayCut()

describe('panel frames', () => {
  it('counts members: 2 per interior edge, 1 per boundary edge', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    const interior = m.edges.filter((e) => e.faceIds.length === 2).length
    const boundary = m.edges.length - interior
    expect(plan.totalMembers).toBe(2 * interior + boundary)
    expect(plan.totalPanels).toBe(m.faces.length)
    expect(plan.seamCount).toBe(interior)
    expect(plan.boltCount).toBeGreaterThanOrEqual(2 * interior)
    // Every panel accounted for by types.
    expect(plan.types.reduce((s, t) => s + t.panelCount, 0)).toBe(m.faces.length)
  })

  it('1V: equilateral triangles → every miter is 30°', () => {
    const m = generateDome({ frequency: 1, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    for (const t of plan.types) {
      for (const mem of t.members) {
        expect(mem.miterStartDeg).toBeCloseTo(30, 1)
        expect(mem.miterEndDeg).toBeCloseTo(30, 1)
      }
      for (const a of t.cornerAnglesDeg) expect(a).toBeCloseTo(60, 1)
    }
  })

  it('interior bevels are half the seam dihedral; sills get the floor bevel', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    // Reference: half of (180 − dihedral) for a known interior edge type.
    const interiorEdge = m.edges.find((e) => e.faceIds.length === 2)!
    const expected = (180 - interiorEdge.dihedralDeg) / 2
    const allBevels = plan.types.flatMap((t) => t.members.map((mm) => mm.bevelDeg))
    expect(allBevels.some((b) => Math.abs(b - expected) < 0.11)).toBe(true)
    // Sill members exist and carry a nonzero floor bevel on a leveled base.
    const sills = plan.types.flatMap((t) => t.members.filter((mm) => mm.boundary))
    expect(sills.length).toBeGreaterThan(0)
    for (const s of sills) {
      expect(s.bevelDeg).toBeGreaterThan(0)
      expect(s.bevelDeg).toBeLessThan(90)
    }
  })

  it('natural-base boundary members are square-cut', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    const sills = plan.types.flatMap((t) => t.members.filter((mm) => mm.boundary))
    expect(sills.length).toBeGreaterThan(0)
    for (const s of sills) expect(s.bevelDeg).toBe(0)
  })

  it('zome frames are 4-sided; goldberg frames are 5/6-sided', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
    const zp = buildPanelFrames(z, 156, 'imperial', NO_DOOR)
    expect(zp.types.length).toBeGreaterThan(0)
    for (const t of zp.types) expect(t.sides).toBe(4)
    expect(zp.totalPanels).toBe(z.rhombi!.length)

    const g = generateGoldberg({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    const gp = buildPanelFrames(g, 156, 'imperial', NO_DOOR)
    const sides = new Set(gp.types.map((t) => t.sides))
    expect(sides.has(5)).toBe(true)
    expect(sides.has(6)).toBe(true)
    expect(gp.totalPanels).toBe(g.polys!.length)
  })

  it('member long-point lengths equal panel edge lengths', () => {
    const m = generateDome({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 100, 'imperial', NO_DOOR)
    const edgeLengths = new Set(m.edges.map((e) => (e.chordFactor * 100).toFixed(1)))
    for (const t of plan.types) {
      for (const mem of t.members) {
        expect(edgeLengths.has(mem.longPointLength.toFixed(1))).toBe(true)
      }
    }
  })

  it('framed-panel cut list: strut rows replaced by frame member rows', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    const cl = buildCutList(
      m,
      { radius: 156, increment: 1 / 8, endOffset: 0, units: 'imperial', jointId: 'framed-panel' },
      NO_DOOR,
      null,
      plan,
    )
    const expectedRowCount = plan.types.reduce((n, t) => n + t.members.length, 0)
    expect(cl.rows.length).toBe(expectedRowCount)
    for (const row of cl.rows) {
      expect(Number.isNaN(row.axialAngleDeg)).toBe(true)
      expect(row.kind).toBe('strut')
    }
    for (const t of plan.types) {
      for (const mem of t.members) {
        const row = cl.rows.find((r) => r.label === mem.label)
        expect(row).toBeDefined()
        expect(row!.quantity).toBe(mem.count * t.panelCount)
      }
    }
    // Packing still packs every row.
    const packing = packCuts(cl, { kerf: 1 / 8, stock: [{ length: 144, label: '12 ft' }] })
    const placed = packing.boards.reduce((n, b) => n + b.cuts.length, 0)
    expect(placed).toBe(cl.totalStruts)
  })

  it('framed-panel BOM: bolts sized to seam intervals, no hub hardware', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    const panelPlan = planPanels(m, 156, { sheetW: 48, sheetL: 96, sheetLabel: '4×8', skinFactor: 1 })
    const bom = buildBom(m, NO_DOOR, null, 'framed-panel', panelPlan, plan)
    const boltLine = bom.find((l) => l.key === 'bolt')
    expect(boltLine).toBeDefined()
    expect(boltLine!.quantity).toBe(plan.boltCount)
    expect(bom.some((l) => l.key === 'hub-connector')).toBe(false)
    expect(bom.some((l) => l.key === 'hub-plate')).toBe(false)
    expect(bom.some((l) => l.key === 'screw-panel')).toBe(true)
  })

  it('framesCsv emits one row per member spec, plus a header', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    const csv = framesCsv(plan, 'imperial')
    const lineCount = csv.split('\n').length
    const specCount = plan.types.reduce((n, t) => n + t.members.length, 0)
    expect(lineCount).toBe(1 + specCount)
  })

  it('optimizeDiameter scores framed-panel member rows, not plain struts', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const range = {
      minDiameter: 300,
      maxDiameter: 312,
      step: 12,
      increment: 1 / 8,
      // Nonzero end offset: strut-mode cut lengths subtract it; framed-panel
      // member lengths (long-point) must not, per the joint's contract.
      endOffset: 2,
      kerf: 1 / 8,
      stock: [{ length: 144, label: '12 ft' }],
      units: 'imperial' as const,
    }
    const strutResult = optimizeDiameter(m, range)
    const framedResult = optimizeDiameter(m, { ...range, jointId: 'framed-panel' as const })
    expect(strutResult.best).not.toBeNull()
    expect(framedResult.best).not.toBeNull()
    // Interior members double vs. one strut per edge, and framed-panel
    // ignores endOffset — the two runs must diverge measurably.
    expect(framedResult.best!.boardsNeeded).not.toBe(strutResult.best!.boardsNeeded)
  })

  it('optimizeDiameter with doors + framed-panel scores per-candidate doorway topology', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const result = optimizeDiameter(m, {
      minDiameter: 300,
      maxDiameter: 312,
      step: 12,
      increment: 1 / 8,
      endOffset: 2,
      kerf: 1 / 8,
      stock: [{ length: 144, label: '12 ft' }],
      units: 'imperial',
      jointId: 'framed-panel',
      doors: [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }],
      minStubLength: 6,
    })
    expect(result.best).not.toBeNull()
    expect(Number.isFinite(result.best!.boardsNeeded)).toBe(true)
  })
})
