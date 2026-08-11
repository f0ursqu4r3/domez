import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { generateZome } from '../zome'
import { cutDoorways, openingPrisms } from '../doorway'
import { clipPanels, panelUnits } from '../panelClip'
import type { DomeModel } from '../types'

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
