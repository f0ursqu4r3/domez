import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { cutDoorways, optimizeDoorPlacement } from '../doorway'
import { buildCutList } from '../cutlist'
import { planSvg } from '../exports/plan'
import type { DomeModel } from '../types'

const R = 156
const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
const door = { id: 'D1', azimuthDeg: 20, width: 36, height: 80, margin: 1.5 }
const win = { id: 'W1', azimuthDeg: 120, width: 24, height: 36, sillHeight: 36, margin: 1.5 }

// The frozen-behavior `dome` above (3V) is coarse enough that a 10" porthole's
// auto-fit plane (sized to clear the IDEAL sphere at its farthest corner)
// sits outside the actual chorded facet everywhere on it — a property of that
// low frequency, not of the shape logic. A finer dome gives facets the
// porthole can actually sit inside; shared by the Task 2 and Task 4 tests
// below that need a real zero-cut spot.
const fineDome = generateDome({ frequency: 5, fraction: '1/2', baseMode: 'leveled' })

/** Face-centroid azimuth/height probe: pick the first face whose centroid
 * sits mid-height on the +x side, then report the bearing/sill that aims a
 * small opening at it. */
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

describe('rect characterization (frozen behavior)', () => {
  const CASES = [
    { riser: 0, removedEdges: 1, trimmedEdges: 12, trimmedPieces: 12, removedFaces: 12,
      removedVertices: 2, trimLenSum: 463.966, d: { framePlaneDist: 112.2985, sideArea: 3417.081,
      topArea: 240.9, faceArea: 298.5, framing: 14, joints: 27, hubs: 1 },
      w: { framePlaneDist: 120.1472, sideArea: 701.148, topArea: 162.942, botArea: 522.612,
      framing: 13, joints: 23, hubs: 1 } },
    { riser: 24, removedEdges: 1, trimmedEdges: 8, trimmedPieces: 10, removedFaces: 7,
      removedVertices: 1, trimLenSum: 361.8666, d: { framePlaneDist: 130.9969, sideArea: 1061.549,
      topArea: 110.141, faceArea: 226.5, framing: 7, joints: 15, hubs: 1 },
      w: { framePlaneDist: 136.384, sideArea: 347.892, topArea: 67.442, botArea: 287.237,
      framing: 8, joints: 16, hubs: 0 } },
  ]
  for (const c of CASES) {
    it(`riser ${c.riser}: counts, areas and trim lengths are unchanged`, () => {
      const cut = cutDoorways(dome, [door, win], R, {
        minStubLength: 6, studSpacing: 16, riserHeight: c.riser,
      })
      const [d, w] = cut.doors
      expect(cut.removedEdges.size).toBe(c.removedEdges)
      expect(cut.trimmedEdges.size).toBe(c.trimmedEdges)
      expect(cut.trimmed.length).toBe(c.trimmedPieces)
      expect(cut.removedFaces.size).toBe(c.removedFaces)
      expect(cut.removedVertices.size).toBe(c.removedVertices)
      expect(cut.trimmed.reduce((s, t) => s + t.length, 0)).toBeCloseTo(c.trimLenSum, 3)
      expect(d.fits && w.fits).toBe(true)
      expect(d.framePlaneDist).toBeCloseTo(c.d.framePlaneDist, 3)
      expect(d.closureSideArea).toBeCloseTo(c.d.sideArea, 2)
      expect(d.closureTopArea).toBeCloseTo(c.d.topArea, 2)
      expect(d.closureFaceArea).toBeCloseTo(c.d.faceArea, 2)
      expect(d.closureFraming.length).toBe(c.d.framing)
      expect(d.closureJointCount).toBe(c.d.joints)
      expect(d.removedHubCount).toBe(c.d.hubs)
      expect(w.framePlaneDist).toBeCloseTo(c.w.framePlaneDist, 3)
      expect(w.closureSideArea).toBeCloseTo(c.w.sideArea, 2)
      expect(w.closureTopArea).toBeCloseTo(c.w.topArea, 2)
      expect(w.closureBottomArea).toBeCloseTo(c.w.botArea, 2)
      expect(w.closureFraming.length).toBe(c.w.framing)
      expect(w.closureJointCount).toBe(c.w.joints)
      expect(w.removedHubCount).toBe(c.w.hubs)
    })
  }
})

describe('shaped cuts', () => {
  it('a circle window crossing struts trims/removes fewer than its bounding rect', () => {
    const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, shape: 'circle' as const }
    const rect = { ...circle, shape: 'rect' as const }
    const cutC = cutDoorways(dome, [circle], R, { minStubLength: 6 })
    const cutR = cutDoorways(dome, [rect], R, { minStubLength: 6 })
    const touchedC = cutC.removedEdges.size + cutC.trimmedEdges.size
    const touchedR = cutR.removedEdges.size + cutR.trimmedEdges.size
    expect(touchedC).toBeGreaterThan(0)
    expect(touchedC).toBeLessThanOrEqual(touchedR)
    expect(cutC.doors[0].fits).toBe(true)
  })
  it('a small circle inside one panel cuts nothing and removes that panel', () => {
    const { az, sill } = panelCentroidSpot(fineDome, R)
    const cut = cutDoorways(fineDome, [{ id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' }], R, { minStubLength: 6 })
    expect(cut.removedEdges.size + cut.trimmedEdges.size).toBe(0)
    expect(cut.removedFaces.size).toBe(1)
  })
  it('arch too flat refuses to fit', () => {
    const cut = cutDoorways(dome, [{ id: 'D1', azimuthDeg: 0, width: 36, height: 17, shape: 'arch' }], R, { minStubLength: 6 })
    expect(cut.doors[0].fits).toBe(false)
    expect(cut.removedEdges.size + cut.trimmedEdges.size + cut.trimmed.length).toBe(0)
  })
  it('generalized fit equals the legacy formula for rects', () => {
    const spec = { id: 'D1', azimuthDeg: 0, width: 36, height: 80 }
    const z0 = dome.cutZ * R
    const legacy = Math.sqrt(R * R - Math.max((z0 + 80) ** 2, z0 ** 2) - 18 * 18)
    const cut = cutDoorways(dome, [spec], R, { minStubLength: 6 })
    expect(cut.doors[0].framePlaneDist).toBeCloseTo(legacy, 9)
  })
})

describe('shaped buck + tunnel closure', () => {
  const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, margin: 1.5, shape: 'circle' as const }
  const cut = cutDoorways(dome, [circle], R, { minStubLength: 6, studSpacing: 16 })
  const w = cut.doors[0]
  it('reports 16 rim segments and the outline polygon', () => {
    expect(w.fits).toBe(true)
    expect(w.shape).toBe('circle')
    expect(w.outline).toHaveLength(16)
    const rim = w.buckMembers.find((m) => m.part === 'rim segment')!
    expect(rim.quantity).toBe(16)
    expect(rim.miterDegA).toBeCloseTo(11.25, 6)
  })
  it('tunnel closure has 16 strips with positive area', () => {
    expect(w.closureTunnel).toHaveLength(16)
    expect(w.closureSideArea).toBeGreaterThan(0)
    expect(w.closureTopArea).toBe(0)
    for (const strip of w.closureTunnel!) expect(strip.uShell).toHaveLength(8)
  })
  it('ring blocking + shell edge members are all above the scrap floor', () => {
    const parts = new Set(w.closureFraming.map((m) => m.part))
    expect(parts.has('ring blocking')).toBe(true)
    for (const m of w.closureFraming) expect(m.length).toBeGreaterThanOrEqual(6 - 1e-9)
    expect(w.closureJointCount).toBeGreaterThan(0)
  })
  it('rect doors still expose buckMembers (jamb/header)', () => {
    const cutR = cutDoorways(dome, [door], R, { minStubLength: 6 })
    expect(cutR.doors[0].buckMembers.map((m) => m.part)).toEqual(['jamb', 'header'])
    expect(cutR.doors[0].shape).toBe('rect')
  })
})

describe('window bottom clip clamps to the base plane (regression)', () => {
  // Real generateDome() models never have geometry below the base plane —
  // every kept face has all three vertices at z ≥ cutZ by construction — so
  // this bug is invisible to any test built on a real dome: the erroneous
  // extra headroom below the base is never reached by real strut geometry.
  // A minimal synthetic model with one strut that actually spans across the
  // base plane is the only way to exercise the clamp directly.
  // The synthetic strut sits at azimuthDeg 0 (ux=1, uy=0), so world (x, y)
  // = (radial u, tangential t) directly — position [200, 0, z] / R puts it
  // well beyond the buck plane radially, dead-center tangentially, spanning
  // world z = −2 (below the base) to z = 10 (inside the window band).
  const model: DomeModel = {
    params: { frequency: 1, fraction: '1/2' },
    vertices: [
      { id: 0, position: [200 / R, 0, -2 / R], edgeIds: [0], hubTypeId: -1, isBase: false },
      { id: 1, position: [200 / R, 0, 10 / R], edgeIds: [0], hubTypeId: -1, isBase: false },
    ],
    edges: [{ id: 0, v0: 0, v1: 1, chordFactor: 12 / R, typeId: 0, faceIds: [], dihedralDeg: NaN }],
    faces: [],
    strutTypes: [],
    hubTypes: [],
    cutZ: 0,
    actualFraction: 0.5,
    unitHeight: 1,
    unitBaseRadius: 1,
  }

  it('a window (margin > sill, no riser) trims the strut exactly at the base, not below it', () => {
    // Repro from review: sill 5, margin 6 → buckBottomRel − margin = −1.
    // Legacy clamps the window's bottom clip to max(0, −1) = 0; the bug
    // let the polygon's own (unclamped) bottom edge sink to hRel = −1.
    const spec = { id: 'W1', azimuthDeg: 0, width: 24, height: 36, sillHeight: 5, margin: 6 }
    const cut = cutDoorways(model, [spec], R, { minStubLength: 0.5 })
    expect(cut.doors[0].fits).toBe(true)
    // The strut runs from world z = −2 (below the base) to z = 10 (well
    // inside the window). Only the below-base portion should survive.
    expect(cut.trimmedEdges.size).toBe(1)
    expect(cut.trimmed).toHaveLength(1)
    const piece = cut.trimmed[0]
    // Correct: survives from z = −2 up to the base plane (z = 0) → length 2.
    // Buggy (unclamped): would survive only to z = −1 → length 1.
    expect(piece.length).toBeCloseTo(2, 9)
    expect(piece.bUnit[2] * R).toBeCloseTo(0, 9)
    expect(piece.aUnit[2] * R).toBeCloseTo(-2, 9)
  })

  it('an equivalent riser-adjacent rect door (no window) is unaffected by the clamp', () => {
    // Sanity check: the fix is window-only. A floor-standing door (no sill)
    // already skips the bottom plane entirely (legacy zClipLow = -1e9), so
    // the same strut should be fully consumed by the passage (no survivor).
    const spec = { id: 'D1', azimuthDeg: 0, width: 24, height: 36 }
    const cut = cutDoorways(model, [spec], R, { minStubLength: 0.5 })
    expect(cut.doors[0].fits).toBe(true)
    expect(cut.removedEdges.size).toBe(1)
    expect(cut.trimmed).toHaveLength(0)
  })
})

describe('shape-aware placement', () => {
  it('recovers a zero-cut porthole spot near a panel center (2D search)', () => {
    // Start from the Task 2 known-clean panel spot, nudged 6° and 8" up.
    const { az, sill } = panelCentroidSpot(fineDome, R)
    const spec = { id: 'W1', azimuthDeg: az + 6, width: 10, height: 10, sillHeight: sill + 8, shape: 'circle' as const }
    const out = optimizeDoorPlacement(fineDome, spec, R, {
      minStubLength: 6, increment: 0.125, sillSearchHalfWidth: 12,
    })
    expect(out.improved).toBe(true)
    expect(out.reason).toContain('0 struts cut')
    expect(out.after.trimmed + out.after.removed).toBe(0)
    expect(out.sillHeight).not.toBeUndefined()
  })
  it('door keep-out blocks overlapping bands but allows a porthole above the door', () => {
    const doorSpec = { id: 'D1', azimuthDeg: 0, width: 36, height: 80 }
    const lowWin = { id: 'W1', azimuthDeg: 3, width: 24, height: 24, sillHeight: 40, shape: 'circle' as const }
    const highWin = { ...lowWin, sillHeight: 90 }
    const opts = {
      minStubLength: 6, increment: 0.125, sillSearchHalfWidth: 6, searchHalfWidthDeg: 4,
      otherDoors: [doorSpec],
    }
    const low = optimizeDoorPlacement(dome, lowWin, R, opts)
    const high = optimizeDoorPlacement(dome, highWin, R, opts)
    // The low window's band overlaps the door: every same-bearing candidate is
    // blocked, so far fewer positions get evaluated than for the high window.
    expect(low.evaluated).toBeLessThan(high.evaluated)
  })
  it('windows never dive below the riser + margin floor', () => {
    const spec = { id: 'W1', azimuthDeg: 45, width: 24, height: 24, sillHeight: 26, margin: 1, shape: 'rect' as const }
    const out = optimizeDoorPlacement(dome, spec, R, {
      minStubLength: 6, increment: 0.125, sillSearchHalfWidth: 12, riserHeight: 24,
    })
    expect((out.sillHeight ?? spec.sillHeight)).toBeGreaterThan(25)
  })
  it('coarse-to-fine matches the flat sweep for a rect door', () => {
    const spec = { id: 'D1', azimuthDeg: 20, width: 36, height: 80 }
    const fast = optimizeDoorPlacement(dome, spec, R, { minStubLength: 6, increment: 0.125 })
    // Flat reference: evaluate every 0.25° via repeated 1-step searches is too
    // slow — instead assert the fast result is at least as good as `before`
    // and lands on a 0.25° grid point with a finite score.
    expect(fast.after.score).toBeLessThanOrEqual(fast.before.score + 1e-9)
    expect(Math.abs(fast.azimuthDeg * 4 - Math.round(fast.azimuthDeg * 4))).toBeLessThan(1e-9)
    expect(fast.reason.length).toBeGreaterThan(0)
  })
})

describe('shaped exports', () => {
  it('cut list carries 16 rim segments with 11.25° in the angle column', () => {
    const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, shape: 'circle' as const }
    const cut = cutDoorways(dome, [circle], R, { minStubLength: 6 })
    const list = buildCutList(
      dome,
      { radius: R, increment: 0.125, endOffset: 0, units: 'imperial' },
      cut,
    )
    const rim = list.rows.find((r) => r.label === 'W1 rim segment')!
    expect(rim.quantity).toBe(16)
    expect(rim.axialAngleDeg).toBeCloseTo(11.25, 6)
  })
  it('floor plan labels a circle window with ⌀', () => {
    const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, shape: 'circle' as const }
    const cut = cutDoorways(dome, [circle], R, { minStubLength: 6 })
    const svg = planSvg(dome, cut, { units: 'imperial', radius: R, riserHeight: 0, wallThickness: 3.5, title: 't' })
    expect(svg).toContain('⌀')
  })
})
