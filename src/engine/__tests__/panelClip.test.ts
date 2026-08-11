import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { generateZome } from '../zome'
import { cutDoorways, openingPrisms } from '../doorway'
import { clipPanels, panelUnits } from '../panelClip'
import type { DomeModel } from '../types'
import type { OpeningPrism } from '../doorway'

const R = 156
const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
const door = { id: 'D1', azimuthDeg: 20, width: 36, height: 80, margin: 1.5 }

const insidePrism = (p: ReturnType<typeof openingPrisms>[number], x: number, y: number, z: number) => {
  const t = -p.uy * x + p.ux * y
  const u = p.ux * x + p.uy * y
  return u >= p.cutPlaneDist && p.planes.every((pl) => pl.nt * t + pl.nz * (z - p.z0) <= pl.c + 1e-9)
}

describe('openingPrisms', () => {
  it('matches cutDoorways vertex removal exactly', () => {
    const prisms = openingPrisms(dome, [door], R, { minStubLength: 6 })
    expect(prisms).toHaveLength(1)
    const cut = cutDoorways(dome, [door], R, { minStubLength: 6 })
    for (const v of dome.vertices) {
      const [x, y, z] = v.position.map((c) => c * R)
      expect(insidePrism(prisms[0], x, y, z)).toBe(cut.removedVertices.has(v.id))
    }
  })
  it('riser-conflicted doors contribute no prism', () => {
    const short = { id: 'D1', azimuthDeg: 0, width: 36, height: 20 }
    expect(openingPrisms(dome, [short], R, { minStubLength: 6, riserHeight: 24 })).toHaveLength(0)
  })
})

// The frozen-behavior `dome` above (3V) is coarse enough that a 10" porthole's
// auto-fit plane sits outside the actual chorded facet everywhere on it — a
// finer dome gives facets the porthole can actually sit inside (same
// rationale as doorwayShapes.test.ts's fineDome).
const fineDome = generateDome({ frequency: 5, fraction: '1/2', baseMode: 'leveled' })

/** Face-centroid azimuth/height probe: pick the first face whose centroid
 * sits mid-height on the +x side, then report the bearing/sill that aims a
 * small opening at it. Copied verbatim from doorwayShapes.test.ts. */
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

/** Polygon area from the Newell cross-sum (planar polygon, any orientation). */
const polyArea3 = (pts: [number, number, number][]) => {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  return Math.hypot(nx, ny, nz) / 2
}
const unitArea = (ring: number[]) =>
  polyArea3(ring.map((vi) => dome.vertices[vi].position.map((c) => c * R) as [number, number, number]))

/** Signed sum of a panel's loop areas — outer loops (not every edge cut)
 * contribute positively, hole loops (every edge cut) negatively. This is
 * the quantity that must equal `c.area` regardless of how many opening
 * prisms overlap: double-recording an overlap as two separate hole loops,
 * or leaving a hole loop floating inside a notch that already swallowed
 * it, both throw this sum off while `c.area` (derived from `fragments`,
 * not `loops`) stays correct — see the "overlapping openings" tests. */
const signedLoopAreaSum = (loops: { pts: readonly (readonly number[])[]; cut: readonly boolean[] }[]) =>
  loops.reduce((s, l) => {
    const mag = polyArea3(l.pts as [number, number, number][])
    const isHole = l.cut.every(Boolean)
    return s + (isHole ? -mag : mag)
  }, 0)

describe('clipPanels', () => {
  const prisms = openingPrisms(dome, [door], R, { minStubLength: 6 })
  const clips = clipPanels(dome, R, prisms)
  const units = panelUnits(dome)

  it('classifies every unit and conserves area', () => {
    expect(clips).toHaveLength(units.length)
    for (const c of clips) {
      const orig = unitArea(units[c.unitIndex].ring)
      const fragArea = c.fragments.reduce((s, f) => s + polyArea3(f as [number, number, number][]), 0)
      if (c.status === 'whole') {
        expect(fragArea).toBeCloseTo(orig, 3)
        // Contract: 'whole' always reports exactly the original ring as its
        // one fragment, never a leftover multi-piece wedge partition that
        // happens to sum back to the full area.
        expect(c.fragments).toHaveLength(1)
        expect(c.loops).toHaveLength(1)
      }
      if (c.status === 'removed') expect(fragArea).toBe(0)
      if (c.status === 'clipped') {
        expect(fragArea).toBeGreaterThan(0)
        expect(fragArea).toBeLessThan(orig - 1e-6)
        expect(c.area).toBeCloseTo(fragArea, 6)
      }
    }
  })

  it('at least one unit is clipped (the door crosses panels) and loops close', () => {
    const clipped = clips.filter((c) => c.status === 'clipped')
    expect(clipped.length).toBeGreaterThan(0)
    for (const c of clipped) {
      let loopAreaSum = 0
      for (const loop of c.loops) {
        expect(loop.pts.length).toBeGreaterThanOrEqual(3)
        expect(loop.cut).toHaveLength(loop.pts.length)
        expect(loop.cut.some(Boolean)).toBe(true) // a clipped panel borders the opening
        loopAreaSum += polyArea3(loop.pts as [number, number, number][])
      }
      // Loop area sum (outer loops CCW, hole loops CW — but polyArea3 takes
      // the unsigned magnitude of each) equals the fragment area sum exactly
      // when there are no holes, which is the case for every panel here
      // (the door crosses panel edges, so any cut region touches the
      // boundary — see the porthole test below for the hole case).
      expect(loopAreaSum).toBeCloseTo(c.area, 6)
    }
  })

  it('porthole fully inside one panel produces an outer loop + hole loop', () => {
    const { az, sill } = panelCentroidSpot(fineDome, R)
    const win = { id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' as const }
    const finePrisms = openingPrisms(fineDome, [win], R, { minStubLength: 6 })
    expect(finePrisms).toHaveLength(1)
    const fineClips = clipPanels(fineDome, R, finePrisms)
    const cut = cutDoorways(fineDome, [win], R, { minStubLength: 6 })
    expect(cut.removedFaces.size).toBe(1)

    const clipped = fineClips.filter((c) => c.status === 'clipped')
    expect(clipped).toHaveLength(1)
    const c = clipped[0]
    expect(c.loops).toHaveLength(2)
    const outer = c.loops.find((l) => l.cut.every((b) => !b))
    const hole = c.loops.find((l) => l.cut.every(Boolean))
    expect(outer).toBeDefined()
    expect(hole).toBeDefined()
    expect(outer!.pts.length).toBe(3) // untouched triangle
    expect(hole!.pts.length).toBeGreaterThan(3) // the shaped opening's polygon
    // Holes are real material removed from the interior: outer loop area
    // minus hole loop area nets to the surviving fragment area.
    const outerArea = polyArea3(outer!.pts as [number, number, number][])
    const holeArea = polyArea3(hole!.pts as [number, number, number][])
    expect(outerArea - holeArea).toBeCloseTo(c.area, 3)
  })

  it('no prisms → every unit whole', () => {
    for (const c of clipPanels(dome, R, [])) {
      expect(c.status).toBe('whole')
      expect(c.fragments).toHaveLength(1)
    }
  })
})

// Regression coverage for the overlapping-prisms bug: a hole recorded
// against one prism used to be exempt from every later prism's clip, so a
// second prism overlapping it either double-recorded the overlap as two
// separate (overlapping) hole loops, or left a hole loop floating inside a
// notch that already swallowed it whole — in both cases `fragments`/`area`
// stayed correct (they never went through the hole-tracking path) while
// `loops` silently lied. `signedLoopAreaSum` must equal `c.area` regardless.
describe('overlapping openings', () => {
  const { az, sill } = panelCentroidSpot(fineDome, R)

  it('two overlapping interior circle windows on one facet merge into non-overlapping holes', () => {
    const win1 = { id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' as const }
    const win2 = { id: 'W2', azimuthDeg: az + 2, width: 10, height: 10, sillHeight: sill, shape: 'circle' as const }
    const finePrisms = openingPrisms(fineDome, [win1, win2], R, { minStubLength: 6 })
    expect(finePrisms).toHaveLength(2)
    const fineClips = clipPanels(fineDome, R, finePrisms)
    const c = fineClips.find((cc) => cc.unitIndex === 20)!
    expect(c.status).toBe('clipped')
    expect(c.loops.length).toBeGreaterThan(1) // an outer loop plus at least one hole

    const holeLoops = c.loops.filter((l) => l.cut.every(Boolean))
    expect(holeLoops.length).toBeGreaterThanOrEqual(1)
    // No two hole loops may overlap — each is convex (a clean prism bite or
    // a piece already notched against every other tracked piece), so a
    // cheap pairwise Sutherland–Hodgman clip in the panel's own 2D basis
    // catches any residual double-subtraction directly, independent of the
    // area check below.
    for (let i = 0; i < holeLoops.length; i++) {
      for (let j = i + 1; j < holeLoops.length; j++) {
        expect(convexOverlapArea(holeLoops[i].pts as [number, number, number][], holeLoops[j].pts as [number, number, number][])).toBeLessThan(1e-6)
      }
    }
    for (const loop of c.loops) assertLoopIntegrity(fineDome, R, panelUnits(fineDome)[c.unitIndex].ring, finePrisms, loop)
    expect(signedLoopAreaSum(c.loops)).toBeCloseTo(c.area, 3)
  })

  it('a window listed before the door that swallows it leaves no floating hole (order-independent)', () => {
    const win = { id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' as const }
    const door = { id: 'D1', azimuthDeg: az, width: 30, height: 80, margin: 2 }

    const beforeResult = (() => {
      const finePrisms = openingPrisms(fineDome, [win, door], R, { minStubLength: 6 })
      const c = clipPanels(fineDome, R, finePrisms).find((cc) => cc.unitIndex === 20)!
      return { c, finePrisms }
    })()
    const afterResult = (() => {
      const finePrisms = openingPrisms(fineDome, [door, win], R, { minStubLength: 6 })
      const c = clipPanels(fineDome, R, finePrisms).find((cc) => cc.unitIndex === 20)!
      return { c, finePrisms }
    })()

    for (const { c, finePrisms } of [beforeResult, afterResult]) {
      expect(c.status).toBe('clipped')
      // No hole loop should survive floating inside the swallowed notch.
      expect(c.loops.some((l) => l.cut.every(Boolean))).toBe(false)
      for (const loop of c.loops) assertLoopIntegrity(fineDome, R, panelUnits(fineDome)[c.unitIndex].ring, finePrisms, loop)
      expect(signedLoopAreaSum(c.loops)).toBeCloseTo(c.area, 3)
    }
    // The window's prior order shouldn't change the outcome at all.
    expect(beforeResult.c.area).toBeCloseTo(afterResult.c.area, 6)
    expect(beforeResult.c.loops.length).toBe(afterResult.c.loops.length)
  })

  // Concentric windows (same azimuth, centers aligned so the smaller circle
  // sits entirely inside the larger one — "same spot", not merely
  // overlapping): a residual sub-case of the overlap bug survived the first
  // round of fixes here specifically. Interior holes never notched the
  // OUTER piece, so when the smaller window's bite landed entirely inside
  // the bigger window's already-recorded hole, the hole-side check
  // correctly discarded it as redundant, but the outer-side check
  // re-recorded the exact same area as a brand-new hole. Confirmed via a
  // pre-fix run: this exact geometry gave loops=3 (two nested/overlapping
  // holes) and signedLoopAreaSum ≈ 362.1653 against c.area ≈ 407.2177 —
  // matching the reviewer's numbers precisely.
  const bigWindow = { id: 'W1', azimuthDeg: az, width: 16, height: 16, sillHeight: sill, shape: 'circle' as const }
  // Centered on the same point as bigWindow: sillHeight + height/2 must
  // match (sill + 8 for the big window), so the small one's sill is offset
  // by half the height difference rather than reusing `sill` directly.
  const smallWindow = { id: 'W2', azimuthDeg: az, width: 8, height: 8, sillHeight: sill + 4, shape: 'circle' as const }

  it('a small window strictly inside a bigger window\'s hole does not double-subtract (bigger first)', () => {
    const finePrisms = openingPrisms(fineDome, [bigWindow, smallWindow], R, { minStubLength: 6 })
    expect(finePrisms).toHaveLength(2)
    const c = clipPanels(fineDome, R, finePrisms).find((cc) => cc.unitIndex === 20)!
    expect(c.status).toBe('clipped')

    const holeLoops = c.loops.filter((l) => l.cut.every(Boolean))
    for (let i = 0; i < holeLoops.length; i++) {
      for (let j = i + 1; j < holeLoops.length; j++) {
        expect(convexOverlapArea(holeLoops[i].pts as [number, number, number][], holeLoops[j].pts as [number, number, number][])).toBeLessThan(1e-6)
      }
    }
    for (const loop of c.loops) assertLoopIntegrity(fineDome, R, panelUnits(fineDome)[c.unitIndex].ring, finePrisms, loop)
    expect(signedLoopAreaSum(c.loops)).toBeCloseTo(c.area, 3)
  })

  it('the same concentric pair in reverse order gives an equivalent result', () => {
    const biggerFirst = clipPanels(fineDome, R, openingPrisms(fineDome, [bigWindow, smallWindow], R, { minStubLength: 6 })).find(
      (cc) => cc.unitIndex === 20,
    )!
    const smallerFirst = clipPanels(fineDome, R, openingPrisms(fineDome, [smallWindow, bigWindow], R, { minStubLength: 6 })).find(
      (cc) => cc.unitIndex === 20,
    )!
    for (const c of [biggerFirst, smallerFirst]) {
      expect(c.status).toBe('clipped')
      expect(signedLoopAreaSum(c.loops)).toBeCloseTo(c.area, 3)
    }
    expect(biggerFirst.area).toBeCloseTo(smallerFirst.area, 6)
    expect(biggerFirst.loops.length).toBe(smallerFirst.loops.length)
    // Order shouldn't change which loops are holes vs. outer, or their areas.
    const holeAreas = (c: (typeof biggerFirst)) =>
      c.loops
        .filter((l) => l.cut.every(Boolean))
        .map((l) => polyArea3(l.pts as [number, number, number][]))
        .sort((a, b) => a - b)
    const a = holeAreas(biggerFirst)
    const b = holeAreas(smallerFirst)
    expect(a).toHaveLength(b.length)
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 3)
  })
})

/** Diameter of a panel unit's ring (max pairwise vertex distance, world
 * scale) — matches the relative tolerance panelClip.ts uses internally. */
function ringDiameter(model: DomeModel, ring: number[], radius: number): number {
  const pts = ring.map((vi) => model.vertices[vi].position.map((c) => c * radius) as [number, number, number])
  let d = 0
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      d = Math.max(d, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]))
    }
  }
  return d || 1e-6
}

/** Perpendicular distance (3D) from `p` to the segment `a-b`. */
function distToSegment3(p: [number, number, number], a: [number, number, number], b: [number, number, number]): number {
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
  if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2])
  let t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2
  t = Math.max(0, Math.min(1, t))
  const c: [number, number, number] = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]
  return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])
}

/** Area of the overlap between two convex, coplanar 3D polygons (both loops
 * of the same panel share the panel's plane), independent of orientation.
 * Projects both onto a 2D basis derived from `a`, normalizes each to CCW,
 * then clips `a` against every edge of `b` as a half-plane (Sutherland–
 * Hodgman; valid since `b` is convex) and returns the surviving area. */
function convexOverlapArea(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number {
  const p0 = a[0], p1 = a[1], p2 = a[a.length - 1]
  const e1raw = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
  const e2raw = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
  const nrm = [
    e1raw[1] * e2raw[2] - e1raw[2] * e2raw[1],
    e1raw[2] * e2raw[0] - e1raw[0] * e2raw[2],
    e1raw[0] * e2raw[1] - e1raw[1] * e2raw[0],
  ]
  const nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1
  const n = nrm.map((c) => c / nl)
  const e1l = Math.hypot(e1raw[0], e1raw[1], e1raw[2]) || 1
  const e1 = e1raw.map((c) => c / e1l)
  const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]]
  const to2D = (p: readonly number[]): [number, number] => [
    (p[0] - p0[0]) * e1[0] + (p[1] - p0[1]) * e1[1] + (p[2] - p0[2]) * e1[2],
    (p[0] - p0[0]) * e2[0] + (p[1] - p0[1]) * e2[1] + (p[2] - p0[2]) * e2[2],
  ]
  const shoelace = (poly: [number, number][]) => {
    let s = 0
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]
      s += x0 * y1 - x1 * y0
    }
    return s / 2
  }
  const ccw = (poly: [number, number][]) => (shoelace(poly) < 0 ? poly.slice().reverse() : poly)
  const clipHalf = (poly: [number, number][], A: number, B: number, C: number): [number, number][] => {
    const out: [number, number][] = []
    for (let i = 0; i < poly.length; i++) {
      const pa = poly[i], pb = poly[(i + 1) % poly.length]
      const da = A * pa[0] + B * pa[1] - C
      const db = A * pb[0] + B * pb[1] - C
      const aIn = da <= 1e-9
      const bIn = db <= 1e-9
      if (aIn) out.push(pa)
      if (aIn !== bIn) {
        const t = da / (da - db)
        out.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t])
      }
    }
    return out
  }
  let poly = ccw(a.map(to2D))
  const bCcw = ccw(b.map(to2D))
  for (let i = 0; i < bCcw.length && poly.length >= 3; i++) {
    const pa = bCcw[i], pb = bCcw[(i + 1) % bCcw.length]
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1]
    const len = Math.hypot(dx, dy) || 1
    const A = dy / len, B = -dx / len
    poly = clipHalf(poly, A, B, A * pa[0] + B * pa[1])
  }
  return poly.length >= 3 ? Math.abs(shoelace(poly)) : 0
}

/** True when `p` sits (within `eps`) on one of `prism`'s bounding planes:
 * an envelope half-plane's boundary, or the radial cutPlaneDist plane. */
function onPrismBoundary(p: [number, number, number], prism: ReturnType<typeof openingPrisms>[number], eps: number): boolean {
  const t = -prism.uy * p[0] + prism.ux * p[1]
  const u = prism.ux * p[0] + prism.uy * p[1]
  if (Math.abs(u - prism.cutPlaneDist) < eps) return true
  return prism.planes.some((pl) => Math.abs(pl.nt * t + pl.nz * (p[2] - prism.z0) - pl.c) < eps)
}

/** Independent, black-box verification (doesn't touch panelClip's internal
 * tags) that every loop closed out of a clip is a *simple* polygon whose
 * every edge genuinely borders either the original panel or an opening:
 * no repeated vertex (the C1 regression this guards is a wedge-reconstruction
 * bug that wove degenerate "antenna" edges through a panel's interior while
 * still conserving area, so a naive area check couldn't catch it), and every
 * edge midpoint lies on the original outline or on some prism's boundary
 * plane. Swept across door bearings on the 3V dome, and separately reused
 * by the shaped-opening and split tests below. */
function assertLoopIntegrity(
  model: DomeModel,
  radius: number,
  ring: number[],
  prisms: ReturnType<typeof openingPrisms>,
  loop: { pts: readonly (readonly number[])[]; cut: readonly boolean[] },
) {
  const diameter = ringDiameter(model, ring, radius)
  const simpleEps = diameter * 1e-4
  const boundaryEps = diameter * 1e-6
  const ringPts = ring.map((vi) => model.vertices[vi].position.map((c) => c * radius) as [number, number, number])

  const seen = new Set<string>()
  for (const raw of loop.pts) {
    const p = raw as [number, number, number]
    const key = `${Math.round(p[0] / simpleEps)}:${Math.round(p[1] / simpleEps)}:${Math.round(p[2] / simpleEps)}`
    expect(seen.has(key)).toBe(false) // no repeated vertex — a self-touching loop is not simple
    seen.add(key)
  }

  for (let i = 0; i < loop.pts.length; i++) {
    const a = loop.pts[i] as [number, number, number]
    const b = loop.pts[(i + 1) % loop.pts.length] as [number, number, number]
    const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    const onOutline = ringPts.some((rp, ri) => distToSegment3(mid, rp, ringPts[(ri + 1) % ringPts.length]) < boundaryEps)
    const onPrism = prisms.some((pr) => onPrismBoundary(mid, pr, boundaryEps))
    expect(onOutline || onPrism).toBe(true)
  }
}

describe('loop integrity across a door-azimuth sweep (3V)', () => {
  const sweepUnits = panelUnits(dome)
  for (let az = 0; az < 360; az += 15) {
    it(`az=${az}: every clipped panel's loops are simple and boundary-only`, () => {
      const d = { id: 'D1', azimuthDeg: az, width: 36, height: 80, margin: 1.5 }
      const sweepPrisms = openingPrisms(dome, [d], R, { minStubLength: 6 })
      const sweepClips = clipPanels(dome, R, sweepPrisms)
      let sawClipped = false
      for (const c of sweepClips) {
        if (c.status !== 'clipped') continue
        sawClipped = true
        for (const loop of c.loops) {
          assertLoopIntegrity(dome, R, sweepUnits[c.unitIndex].ring, sweepPrisms, loop)
        }
      }
      // Not every bearing necessarily clips a panel (a door could land
      // entirely within one panel's removal without crossing an edge), but
      // most of this sweep should — assert loudly if the fixture stops
      // exercising the fallback path at all.
      if (az % 45 !== 0) expect(sawClipped).toBe(true)
    })
  }
})

describe('two-piece split', () => {
  it('a narrow tall door crossing a Z10 rhombus splits it into exactly two simple loops', () => {
    const zome = generateZome({ sides: 10, pitchDeg: 45, rows: 5, baseMode: 'leveled' })
    const d = { id: 'D1', azimuthDeg: 20, width: 12, height: 100, margin: 0 }
    const zomePrisms = openingPrisms(zome, [d], R, { minStubLength: 6 })
    expect(zomePrisms).toHaveLength(1)
    const zomeClips = clipPanels(zome, R, zomePrisms)
    const zomeUnits = panelUnits(zome)

    const split = zomeClips.find((c) => c.status === 'clipped' && c.fragments.length === 2 && c.loops.length === 2)
    expect(split).toBeDefined()
    const c = split!
    expect(c.loops).toHaveLength(2)
    for (const loop of c.loops) {
      expect(loop.pts.length).toBeGreaterThanOrEqual(3)
      expect(loop.cut.some(Boolean)).toBe(true)
      assertLoopIntegrity(zome, R, zomeUnits[c.unitIndex].ring, zomePrisms, loop)
    }
    const loopAreaSum = c.loops.reduce((s, l) => s + polyArea3(l.pts as [number, number, number][]), 0)
    expect(loopAreaSum).toBeCloseTo(c.area, 6)
  })
})

/** True when the planar 3D loop is convex (cross products of consecutive
 * edges all point the same way along the loop's Newell normal, within a
 * relative tolerance for collinear vertices). */
function isConvexLoop(pts: readonly (readonly number[])[]): boolean {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  const nl = Math.hypot(nx, ny, nz) || 1
  let scale = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    scale = Math.max(scale, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
  }
  const tol = scale * scale * 1e-9
  let sign = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], r = pts[(i + 2) % pts.length]
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
    const e2 = [r[0] - q[0], r[1] - q[1], r[2] - q[2]]
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const d = (cr[0] * nx + cr[1] * ny + cr[2] * nz) / nl
    if (Math.abs(d) < tol) continue
    if (sign === 0) sign = Math.sign(d)
    else if (Math.sign(d) !== sign) return false
  }
  return true
}

/** Overlap area between two coplanar hole loops, at least one of which is
 * convex (Sutherland–Hodgman needs a convex clipper; the subject may be
 * non-convex — e.g. an L-shaped hole remnant — and the clipped area stays
 * exact). */
function holeOverlapArea(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number {
  if (isConvexLoop(b)) return convexOverlapArea(a, b)
  if (isConvexLoop(a)) return convexOverlapArea(b, a)
  throw new Error('holeOverlapArea: neither loop is convex')
}

// Regression coverage for the two round-3 residuals, both rooted in deciding
// hole-suppression with a *different* oracle (a geometric convex-containment
// test, 1e-6·diameter epsilon) than the one deciding hole-notching (bite tags
// after the sequential clip, 1e-9·diameter epsilon):
//   A. FLUSH/hair-crossing: a contained opening whose boundary is collinear
//      with (or crosses by < 1e-6·d) its containing hole's boundary resolved
//      as "contained" (suppress) on the outer side while the tags said
//      "touching" (notch) on the hole side — the opening's whole area
//      silently vanished from the void (signedLoopAreaSum ran +33.6 in² hot
//      on this exact fixture).
//   B. NON-CONVEX containers: a hole notched into an L by a partner prism
//      failed the convex-only containment test, so a third prism strictly
//      inside the L remnant was re-recorded as a redundant hole
//      (double-subtraction, signedLoopAreaSum −50.4 in² on this fixture).
// Both are now decided by ONE oracle: each existing hole's bite by the new
// prism (the same sequential clip), suppressing the outer record iff some
// hole's bite is non-touching AND area-equal to the outer bite.
describe('flush and contained openings (synthetic rect prisms, 3V)', () => {
  // First mid-height +x facet of the frozen 3V dome (same probe idea as
  // panelCentroidSpot, in panel-unit space): big enough that a 16"-wide rect
  // prism lands strictly inside it.
  const rectUnits = panelUnits(dome)
  const centroidOf = (ring: number[]) =>
    ring.reduce(
      (s, vi) => {
        const p = dome.vertices[vi].position
        return [s[0] + (p[0] * R) / ring.length, s[1] + (p[1] * R) / ring.length, s[2] + (p[2] * R) / ring.length]
      },
      [0, 0, 0],
    )
  const targetUnit = rectUnits.findIndex((u) => {
    const c = centroidOf(u.ring)
    const zRel = c[2] - dome.cutZ * R
    return zRel > 40 && zRel < 90 && c[0] > 60
  })
  const cen = centroidOf(rectUnits[targetUnit].ring)
  const az = Math.atan2(cen[1], cen[0])
  const zc = cen[2]

  /** Axis-aligned rect prism in the (t, z) frame at the facet's azimuth —
   * OpeningPrism is plain data, so the literal needs no door machinery. */
  const rectPrism = (id: string, tMin: number, tMax: number, zMin: number, zMax: number): OpeningPrism => ({
    doorId: id,
    ux: Math.cos(az),
    uy: Math.sin(az),
    z0: 0,
    planes: [
      { nt: 1, nz: 0, c: tMax },
      { nt: -1, nz: 0, c: -tMin },
      { nt: 0, nz: 1, c: zMax },
      { nt: 0, nz: -1, c: -zMin },
    ],
    cutPlaneDist: 6,
  })

  const big = rectPrism('B', -8, 8, zc - 6, zc + 6)

  const checkInvariants = (c: ReturnType<typeof clipPanels>[number], prisms: OpeningPrism[], digits: number) => {
    expect(c.status).toBe('clipped')
    const holes = c.loops.filter((l) => l.cut.every(Boolean))
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        expect(holeOverlapArea(holes[i].pts, holes[j].pts)).toBeLessThan(1e-6)
      }
    }
    for (const loop of c.loops) assertLoopIntegrity(dome, R, rectUnits[c.unitIndex].ring, prisms, loop)
    expect(signedLoopAreaSum(c.loops)).toBeCloseTo(c.area, digits)
  }

  it('found an interior-hole facet and the big rect is a clean hole in it', () => {
    expect(targetUnit).toBeGreaterThanOrEqual(0)
    const c = clipPanels(dome, R, [big])[targetUnit]
    expect(c.status).toBe('clipped')
    expect(c.loops).toHaveLength(2)
    expect(c.loops.some((l) => l.cut.every(Boolean))).toBe(true)
  })

  it('a small rect exactly flush with its containing hole\'s edge keeps the full void (δ=0, both orders)', () => {
    const small = rectPrism('S', 2, 8, zc - 3, zc + 3) // tMax flush with big's tMax
    const results = [
      clipPanels(dome, R, [big, small])[targetUnit],
      clipPanels(dome, R, [small, big])[targetUnit],
    ]
    for (const c of results) checkInvariants(c, [big, small], 3)
    expect(results[0].area).toBeCloseTo(results[1].area, 6)
  })

  it('hair-crossing sweep: the small rect poking out of the hole edge by δ ∈ [0, 3e-5] stays consistent (both orders)', () => {
    for (const d of [0, 1e-9, 1e-7, 1e-6, 1e-5, 3e-5]) {
      const small = rectPrism('S', 2, 8 + d, zc - 3, zc + 3)
      for (const prisms of [[big, small], [small, big]]) {
        const c = clipPanels(dome, R, prisms)[targetUnit]
        // Slivers thinner than the loop grid (diameter·1e-4) quantize away —
        // the residual is bounded by that grid, not by the opening's area
        // (the round-3 bug lost the ENTIRE small opening, +33.6 in² here).
        checkInvariants(c, prisms, 2)
      }
    }
  })

  it('sub-grid sliver offsets (loop-grid zone) degrade per unit instead of throwing', () => {
    // δ between the clip epsilon (1e-9·d) and the loop grid (1e-4·d) leaves
    // remnant slivers thinner than the grid — unrepresentable by loop
    // reconstruction. Before the containment guard, the z-edge small-first
    // case at δ=3e-3 escaped clipOneUnit as 'panelClip: loop failed to
    // close', crashing clipPanels for the whole model, and other grid-zone
    // configs emitted quantization-mangled sliver loops (edges off every
    // boundary plane). The guard degrades the affected unit instead: the
    // sliver is dropped, costing at most its own (grid-bounded) area.
    for (const d of [3e-4, 1e-3, 3e-3]) {
      const sT = rectPrism('S', 2, 8 + d, zc - 3, zc + 3)
      const sZ = rectPrism('S', -4, 4, zc, zc + 6 + d)
      const sC = rectPrism('S', 2, 8 + d, zc, zc + 6 + d)
      for (const small of [sT, sZ, sC]) {
        for (const prisms of [[big, small], [small, big]]) {
          const clips = clipPanels(dome, R, prisms) // must not throw
          const c = clips[targetUnit]
          expect(c.status).toBe('clipped')
          // fragments/area never pass through loop reconstruction — exact.
          const fragArea = c.fragments.reduce((s, f) => s + polyArea3(f as [number, number, number][]), 0)
          expect(c.area).toBeCloseTo(fragArea, 6)
          // The unit still returns a closed, simple, boundary-only loop set.
          expect(c.loops.length).toBeGreaterThanOrEqual(2)
          for (const loop of c.loops) {
            expect(loop.pts.length).toBeGreaterThanOrEqual(3)
            assertLoopIntegrity(dome, R, rectUnits[targetUnit].ring, prisms, loop)
          }
          // Degradation cost stays in the quantization class (≈ grid ×
          // sliver perimeter, ~1e-1 here at worst), far below the opening
          // areas themselves (~34–67 in² on this fixture).
          expect(Math.abs(signedLoopAreaSum(c.loops) - c.area)).toBeLessThan(0.1)
        }
      }
    }
  })

  it('a third window strictly inside an L-shaped hole remnant is not double-subtracted (all orders)', () => {
    const partner = rectPrism('P', 2, 14, zc, zc + 10) // notches big's corner → L remnant
    const third = rectPrism('T', -6, -1, zc - 4, zc + 1) // strictly inside the L, outside partner
    const orders = [
      [big, partner, third],
      [big, third, partner],
      [third, big, partner],
      [partner, big, third],
    ]
    const areas: number[] = []
    for (const prisms of orders) {
      const c = clipPanels(dome, R, prisms)[targetUnit]
      checkInvariants(c, prisms, 3)
      // One outer loop, the L remnant, and the partner's own hole — the
      // third window must NOT appear as an extra (redundant) hole loop.
      expect(c.loops).toHaveLength(3)
      expect(c.loops.filter((l) => l.cut.every(Boolean))).toHaveLength(2)
      areas.push(c.area)
    }
    for (const a of areas) expect(a).toBeCloseTo(areas[0], 6)
  })
})

describe('clipPanels (Z10 rect doors)', () => {
  it('rect doors across a bearing sweep never produce non-simple loops', () => {
    const zome = generateZome({ sides: 10, pitchDeg: 45, rows: 5, baseMode: 'leveled' })
    const zomeUnits = panelUnits(zome)
    for (let az = 0; az < 360; az += 15) {
      const d = { id: 'D1', azimuthDeg: az, width: 36, height: 80, margin: 1.5 }
      const zomePrisms = openingPrisms(zome, [d], R, { minStubLength: 6 })
      const zomeClips = clipPanels(zome, R, zomePrisms)
      for (const c of zomeClips) {
        if (c.status !== 'clipped') continue
        for (const loop of c.loops) {
          assertLoopIntegrity(zome, R, zomeUnits[c.unitIndex].ring, zomePrisms, loop)
        }
      }
    }
  })
})
