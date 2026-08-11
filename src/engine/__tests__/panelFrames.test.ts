import { describe, expect, it } from 'vitest'
import { buildPanelFrames } from '../panelFrames'
import { generateDome } from '../dome'
import { generateZome } from '../zome'
import { generateGoldberg } from '../goldberg'
import { cutDoorways, emptyDoorwayCut, openingPrisms } from '../doorway'
import { clipPanels } from '../panelClip'
import { buildCutList } from '../cutlist'
import { packCuts } from '../packing'
import { buildBom } from '../bom'
import { planPanels } from '../panels'
import { cutListCsv, framesCsv } from '../exports/csv'
import { frameJigsSvg } from '../exports/frames'
import { optimizeDiameter } from '../optimize'
import type { DomeModel } from '../types'

// Match the exact generator/param call shapes used in engine.test.ts, and
// the actual empty-doorway helper name exported by doorway.ts (grep for the
// function returning `{ doors: [], removedEdges: new Set(), … }`). Only the
// import lines may adapt — assertions are fixed.

const NO_DOOR = emptyDoorwayCut()

describe('panel frames', () => {
  it('counts members: 2 per interior edge, 1 per boundary edge', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
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
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
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
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
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
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
    const sills = plan.types.flatMap((t) => t.members.filter((mm) => mm.boundary))
    expect(sills.length).toBeGreaterThan(0)
    for (const s of sills) expect(s.bevelDeg).toBe(0)
  })

  it('zome frames are 4-sided; goldberg frames are 5/6-sided', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
    const zp = buildPanelFrames(z, 156, 'imperial', NO_DOOR, clipPanels(z, 156, []))
    expect(zp.types.length).toBeGreaterThan(0)
    for (const t of zp.types) expect(t.sides).toBe(4)
    expect(zp.totalPanels).toBe(z.rhombi!.length)

    const g = generateGoldberg({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    const gp = buildPanelFrames(g, 156, 'imperial', NO_DOOR, clipPanels(g, 156, []))
    const sides = new Set(gp.types.map((t) => t.sides))
    expect(sides.has(5)).toBe(true)
    expect(sides.has(6)).toBe(true)
    expect(gp.totalPanels).toBe(g.polys!.length)
  })

  it('member long-point lengths equal panel edge lengths', () => {
    const m = generateDome({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 100, 'imperial', NO_DOOR, clipPanels(m, 100, []))
    const edgeLengths = new Set(m.edges.map((e) => (e.chordFactor * 100).toFixed(1)))
    for (const t of plan.types) {
      for (const mem of t.members) {
        expect(edgeLengths.has(mem.longPointLength.toFixed(1))).toBe(true)
      }
    }
  })

  it('framed-panel cut list: strut rows replaced by frame member rows', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
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
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
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
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
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

  it('frameJigsSvg draws one page per frame type, each with bevel annotations and sill notes', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
    const svg = frameJigsSvg(plan, 'imperial', 'DOMEZ test')
    const pageMatches = svg.match(/data-frame-page="/g) ?? []
    expect(pageMatches.length).toBe(plan.types.length)
    const bevelMatches = svg.match(/data-bevel="/g) ?? []
    expect(bevelMatches.length).toBeGreaterThanOrEqual(plan.types.length)
    expect(svg).toContain('sill')
  })

  it('frameJigsSvg: sill lands on the true boundary edge, not a geometric guess (2V leveled)', () => {
    // 2V leveled produces a base triangle type with 1 boundary member
    // (bevel 10.8°) and 2 identical interior members (bevel 9.0°) — all
    // three edges share the same long-point length and corner angles, so
    // geometry alone cannot tell which one is the true boundary/sill edge.
    // `edgeMemberIdx` (built directly from the per-edge dedupe loop in
    // panelFrames.ts, never reconstructed by guessing in the renderer) is
    // the only thing that can place it correctly.
    const m = generateDome({ frequency: 2, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
    const type = plan.types.find((t) => {
      const boundaryMembers = t.members.filter((mm) => mm.boundary)
      return boundaryMembers.length === 1 && boundaryMembers[0].count === 1 && t.members.length >= 2
    })
    expect(type).toBeDefined()
    const boundaryMemberIdx = type!.members.findIndex((mm) => mm.boundary)
    const boundaryMember = type!.members[boundaryMemberIdx]
    const bi = type!.edgeMemberIdx.findIndex((idx) => idx === boundaryMemberIdx)
    expect(bi).toBeGreaterThanOrEqual(0)

    const svg = frameJigsSvg(plan, 'imperial', 'DOMEZ test')
    const pageIdx = plan.types.indexOf(type!) + 1
    const pageStart = svg.indexOf(`data-frame-page="${pageIdx}"`)
    const nextStart = svg.indexOf(`data-frame-page="${pageIdx + 1}"`)
    const page = svg.slice(pageStart, nextStart === -1 ? svg.length : nextStart)

    const edgeGroups = [...page.matchAll(/<g data-edge="(\d+)" data-bevel="([\d.]+)">([\s\S]*?)<\/g>/g)]
    const target = edgeGroups.find((mtc) => Number(mtc[1]) === bi)
    expect(target).toBeDefined()
    expect(target![2]).toBe(boundaryMember.bevelDeg.toFixed(1))
    expect(target![3]).toContain('(sill)')

    // No other edge on this page claims the sill — the boundary member's
    // count (1, for this type) is the only allowance.
    const sillGroups = edgeGroups.filter((mtc) => mtc[3].includes('(sill)'))
    expect(sillGroups.length).toBe(boundaryMember.count)
    expect(sillGroups.every((mtc) => Number(mtc[1]) === bi)).toBe(true)
  })

  it('frameJigsSvg: per-edge data-bevel follows edgeMemberIdx exactly, in outline order (1V leveled)', () => {
    const m = generateDome({ frequency: 1, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
    const type = plan.types.find((t) => t.members.some((mm) => mm.boundary))
    expect(type).toBeDefined()

    const svg = frameJigsSvg(plan, 'imperial', 'DOMEZ test')
    const pageIdx = plan.types.indexOf(type!) + 1
    const pageStart = svg.indexOf(`data-frame-page="${pageIdx}"`)
    const nextStart = svg.indexOf(`data-frame-page="${pageIdx + 1}"`)
    const page = svg.slice(pageStart, nextStart === -1 ? svg.length : nextStart)

    const bevelByEdge = new Map(
      [...page.matchAll(/<g data-edge="(\d+)" data-bevel="([\d.]+)">/g)].map((mtc) => [
        Number(mtc[1]),
        mtc[2],
      ]),
    )
    for (let i = 0; i < type!.sides; i++) {
      const expected = type!.members[type!.edgeMemberIdx[i]].bevelDeg.toFixed(1)
      expect(bevelByEdge.get(i)).toBe(expected)
    }
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

  it('frameJigsSvg: natural-base 3V plan carries the square-sill scribe caveat', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
    const svg = frameJigsSvg(plan, 'imperial', 'DOMEZ test')
    expect(svg).toContain('scribe to grade')
  })

  it('framed cut-list CSV (3V leveled) never leaks NaN onto the page', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR, clipPanels(m, 156, []))
    const cl = buildCutList(
      m,
      { radius: 156, increment: 1 / 8, endOffset: 0, units: 'imperial', jointId: 'framed-panel' },
      NO_DOOR,
      null,
      plan,
    )
    const csv = cutListCsv(cl, 'imperial')
    expect(csv.includes('NaN')).toBe(false)
  })
})

describe('panel frames: clip-driven X-types + overlap seams', () => {
  const R = 156
  const zome = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
  // A door big enough to fully consume at least one panel of the golden 3V
  // dome and clip several of its neighbors, so both new code paths
  // (site-fit X-types, surviving-overlap seams) actually exercise.
  const archDoor = { id: 'D1', azimuthDeg: 0, width: 60, height: 90, shape: 'arch' as const, margin: 1.5 }

  it('clipped panels become one-off site-fit X types with closed frames', () => {
    const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cut = cutDoorways(dome, [archDoor], R, { minStubLength: 6 })
    const prisms = openingPrisms(dome, [archDoor], R, { minStubLength: 6 })
    const clips = clipPanels(dome, R, prisms)
    const plan = buildPanelFrames(dome, R, 'imperial', cut, clips)
    const xTypes = plan.types.filter((t) => t.siteFit)
    expect(xTypes.length).toBeGreaterThan(0)
    for (const t of xTypes) {
      expect(t.panelCount).toBe(1)
      expect(t.label).toMatch(/^X\d+$/)
      // Members cover every loop edge: total member count (Σ count) equals
      // outline edges + hole edges.
      const edgeCount = t.outline.length + (t.holes ?? []).reduce((s, h) => s + h.length, 0)
      expect(t.members.reduce((s, m) => s + m.count, 0)).toBe(edgeCount)
    }
  })

  it('no clipped panels → output identical to the pre-change plan', () => {
    // Pinned from the pre-refactor implementation (buildPanelFrames without
    // a `clips` argument) on the exact same golden zome, before this task's
    // change — captured once, hard-coded here as the frozen baseline.
    const plan = buildPanelFrames(zome, R, 'imperial', emptyDoorwayCut(), clipPanels(zome, R, []))
    expect(plan.types.length).toBe(4)
    expect(plan.totalPanels).toBe(32)
    expect(plan.seamCount).toBe(56)
    expect(plan.boltCount).toBe(336)
  })

  it('seam overlap: an edge fully consumed by the opening is no seam', () => {
    const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const noDoorPlan = buildPanelFrames(
      dome,
      R,
      'imperial',
      emptyDoorwayCut(),
      clipPanels(dome, R, []),
    )
    const cut = cutDoorways(dome, [archDoor], R, { minStubLength: 6 })
    const prisms = openingPrisms(dome, [archDoor], R, { minStubLength: 6 })
    const clips = clipPanels(dome, R, prisms)
    const plan = buildPanelFrames(dome, R, 'imperial', cut, clips)
    // At least one panel was fully removed by the door — every seam along
    // its edges (shared with a still-present neighbor) must disappear.
    expect(plan.omittedPanels).toBeGreaterThan(0)
    expect(plan.seamCount).toBeLessThan(noDoorPlan.seamCount)
    // `boltCount` sums max(2, ceil(len/spacing)) per seam — this is exactly
    // "every seam gets at least 2 bolts" expressed through the plan totals.
    expect(plan.boltCount).toBeGreaterThanOrEqual(2 * plan.seamCount)
  })

  it('a panel split into two disjoint islands by a narrow door produces two X-types, not one', () => {
    // Task 2's own "two-piece split" repro (panelClip.test.ts): a narrow,
    // full-height, zero-margin door cuts a Z10 rhombus edge-to-edge,
    // leaving two separate triangular slivers — neither is a hole (both
    // keep original outline edges), so this is exactly the "multiple
    // non-hole islands in one clipped panel" case a single-outline X-type
    // would otherwise drop one of.
    const z10 = generateZome({ sides: 10, pitchDeg: 45, rows: 5, baseMode: 'leveled' })
    const narrowDoor = { id: 'D1', azimuthDeg: 20, width: 12, height: 100, margin: 0 }
    const prisms = openingPrisms(z10, [narrowDoor], R, { minStubLength: 6 })
    const clips = clipPanels(z10, R, prisms)
    const splitUnitIndex = clips.findIndex(
      (c) => c.status === 'clipped' && c.fragments.length === 2 && c.loops.length === 2,
    )
    expect(splitUnitIndex).toBeGreaterThanOrEqual(0)
    const splitClip = clips[splitUnitIndex]
    expect(splitClip.loops.every((l) => l.pts.length === 3)).toBe(true) // two triangles

    const cut = cutDoorways(z10, [narrowDoor], R, { minStubLength: 6 })
    const plan = buildPanelFrames(z10, R, 'imperial', cut, clips)
    const xTypes = plan.types.filter((t) => t.siteFit)

    // The split unit must surface as exactly two triangular (3-sided)
    // X-types — one per surviving island — not one (with the other
    // island's edges silently dropped) and not merged into a single type
    // (panelCount must stay 1; these are two distinct site-fit pieces).
    const triangleXTypes = xTypes.filter((t) => t.sides === 3)
    expect(triangleXTypes.length).toBe(2)
    for (const t of triangleXTypes) {
      expect(t.panelCount).toBe(1)
      expect(t.siteFit).toBe(true)
      expect(t.outline.length).toBe(3)
    }
    // Both islands' loop edges (3 + 3 = 6) are fully accounted for in
    // members — none dropped, none double-counted.
    const triangleMemberSum = triangleXTypes.reduce(
      (s, t) => s + t.members.reduce((ss, m) => ss + m.count, 0),
      0,
    )
    expect(triangleMemberSum).toBe(6)

    // Model-wide: every X-type's own edge total (outline + holes) sums to
    // exactly the total loop-edge count across every clipped panel — no
    // island of any clipped panel anywhere loses edges to this bug class.
    const xTypeEdgeTotal = xTypes.reduce(
      (s, t) => s + t.sides + (t.holes ?? []).reduce((hs, h) => hs + h.length, 0),
      0,
    )
    const clippedLoopEdgeTotal = clips
      .filter((c) => c.status === 'clipped')
      .reduce((s, c) => s + c.loops.reduce((ss, l) => ss + l.pts.length, 0), 0)
    expect(xTypeEdgeTotal).toBe(clippedLoopEdgeTotal)

    // plan.totalMembers folds every type's full edge count (F- and
    // X-types alike) — re-derive it independently and confirm it matches.
    const expectedTotalMembers = plan.types.reduce(
      (s, t) => s + t.panelCount * (t.sides + (t.holes ?? []).reduce((hs, h) => hs + h.length, 0)),
      0,
    )
    expect(plan.totalMembers).toBe(expectedTotalMembers)
  })

  it('framed cut list drops trimmed rows even with a doorway; carries X-member rows', () => {
    const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cut = cutDoorways(dome, [archDoor], R, { minStubLength: 6 })
    const prisms = openingPrisms(dome, [archDoor], R, { minStubLength: 6 })
    const clips = clipPanels(dome, R, prisms)
    const plan = buildPanelFrames(dome, R, 'imperial', cut, clips)
    expect(plan.types.some((t) => t.siteFit)).toBe(true)

    const list = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 0, units: 'imperial', jointId: 'framed-panel' },
      cut,
      null,
      plan,
    )
    expect(list.rows.some((r) => r.kind === 'trimmed')).toBe(false)
    expect(list.rows.some((r) => r.label.startsWith('X1'))).toBe(true)
  })

  it('hub-mode cut list still carries trimmed rows with the same doorway', () => {
    const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cut = cutDoorways(dome, [archDoor], R, { minStubLength: 6 })
    const list = buildCutList(
      dome,
      { radius: R, increment: 1 / 8, endOffset: 2, units: 'imperial', jointId: 'hub' },
      cut,
    )
    expect(list.rows.some((r) => r.kind === 'trimmed')).toBe(true)
  })

  it('jig svg draws X-types with data-cut-edge marking their opening-interface members', () => {
    const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cut = cutDoorways(dome, [archDoor], R, { minStubLength: 6 })
    const prisms = openingPrisms(dome, [archDoor], R, { minStubLength: 6 })
    const clips = clipPanels(dome, R, prisms)
    const plan = buildPanelFrames(dome, R, 'imperial', cut, clips)

    const svg = frameJigsSvg(plan, 'imperial', 'DOMEZ test')
    expect(svg).toContain('X1')
    expect(svg).toContain('data-cut-edge')
    expect(svg).toContain('site-fit — cut edges marked')

    // Every member flagged cutEdge in the plan must produce a marked edge
    // somewhere on its type's page, and vice versa.
    const cutEdgeMembers = plan.types.some((t) => t.members.some((mm) => mm.cutEdge))
    expect(cutEdgeMembers).toBe(true)
  })

  it('jig svg draws opening-carved holes as dashed inner polygons, all edges cut', () => {
    // A porthole fully inside one panel (not touching its outline) produces
    // an outer loop + a genuine hole loop — see panelClip.test.ts's own
    // "porthole fully inside one panel" repro for the identical fixture
    // shape (fine dome so the shaped opening actually fits inside a facet).
    const fineDome = generateDome({ frequency: 5, fraction: '1/2', baseMode: 'leveled' })
    const { az, sill } = panelCentroidSpot(fineDome, R)
    const win = { id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' as const }
    const cut = cutDoorways(fineDome, [win], R, { minStubLength: 6 })
    const prisms = openingPrisms(fineDome, [win], R, { minStubLength: 6 })
    const clips = clipPanels(fineDome, R, prisms)
    const plan = buildPanelFrames(fineDome, R, 'imperial', cut, clips)

    const holeType = plan.types.find((t) => (t.holes?.length ?? 0) > 0)
    expect(holeType).toBeDefined()
    // Every hole edge is cut against the opening by construction — no
    // member bounding a hole is ever a plain shell-boundary/sill edge.
    const holeEdgeCount = holeType!.holes!.reduce((s, h) => s + h.length, 0)
    const cutBoundaryMemberCount = holeType!.members
      .filter((mm) => mm.boundary && mm.cutEdge)
      .reduce((s, mm) => s + mm.count, 0)
    expect(cutBoundaryMemberCount).toBe(holeEdgeCount)

    const svg = frameJigsSvg(plan, 'imperial', 'DOMEZ test')
    const pageIdx = plan.types.indexOf(holeType!) + 1
    const pageStart = svg.indexOf(`data-frame-page="${pageIdx}"`)
    const nextStart = svg.indexOf(`data-frame-page="${pageIdx + 1}"`)
    const page = svg.slice(pageStart, nextStart === -1 ? svg.length : nextStart)
    expect(page).toContain('data-hole="0"')
    expect(page).toContain('data-cut-edge')
    expect(page).toContain('class="outline cut hole"')
  })
})

/** Face-centroid azimuth/height probe: pick the first face whose centroid
 * sits mid-height on the +x side, then report the bearing/sill that aims a
 * small opening at it. Copied from panelClip.test.ts (not exported there). */
function panelCentroidSpot(model: DomeModel, radius: number): { az: number; sill: number } {
  const f = model.faces
    .map((face) => {
      const c = face.vertexIds.reduce(
        (s, vi) => {
          const p = model.vertices[vi].position
          return [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3]
        },
        [0, 0, 0],
      )
      return { face, c }
    })
    .find(
      ({ c }) =>
        c[2] * radius > model.cutZ * radius + 40 &&
        c[2] * radius < model.cutZ * radius + 80 &&
        c[0] > 0.5,
    )!
  const az = (Math.atan2(f.c[1], f.c[0]) * 180) / Math.PI
  const sill = f.c[2] * radius - model.cutZ * radius - 5
  return { az, sill }
}
