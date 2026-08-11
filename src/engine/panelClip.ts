import type { DomeModel, Vec3 } from './types'
import type { OpeningPrism } from './doorway'

/** Panel unit: polys → rhombi + uncovered faces → faces. All convex. Same
 * construction as `buildPanelFrames`' internal unit list, without the
 * doorway-removal filter (clipping needs every unit, including the ones a
 * whole-panel-inside-the-opening test would drop entirely). */
export interface PanelUnit {
  ring: number[]
  faceIds: number[]
}

export function panelUnits(model: DomeModel): PanelUnit[] {
  if (model.polys) {
    return model.polys.map((p) => ({ ring: [...p.vertexIds], faceIds: [...p.faceIds] }))
  }
  if (model.rhombi) {
    const units: PanelUnit[] = model.rhombi.map((r) => ({ ring: [...r.vertexIds], faceIds: [...r.faceIds] }))
    const covered = new Set(model.rhombi.flatMap((r) => r.faceIds))
    for (const f of model.faces) {
      if (!covered.has(f.id)) units.push({ ring: [...f.vertexIds], faceIds: [f.id] })
    }
    return units
  }
  return model.faces.map((f) => ({ ring: [...f.vertexIds], faceIds: [f.id] }))
}

export interface ClippedLoop {
  /** Closed loop, world scale (working units); pts[i]→pts[i+1 mod n]. */
  pts: Vec3[]
  /** cut[i] true = edge i lies on a prism boundary (opening interface). */
  cut: boolean[]
}

export interface ClippedPanel {
  unitIndex: number
  ring: number[]
  faceIds: number[]
  status: 'whole' | 'clipped' | 'removed'
  /** Disjoint convex fragments, CCW viewed from outside the dome.
   * 'whole': one fragment = the original ring. 'removed': empty. */
  fragments: Vec3[][]
  /** Outer loops CCW, hole loops CW (signed area against the panel
   * normal). 'whole': one loop, all cut flags false. */
  loops: ClippedLoop[]
  /** Surviving area, working units². */
  area: number
}

type Pt2 = [number, number]

/** Identifies the single fixed 2D line an edge lies on: either the original
 * panel outline's edge `i`, or candidate prism `c`'s half-plane `j`. Edges
 * sharing a tag are, by construction, exactly collinear (they're sub-pieces
 * of the same clip line reused across several fragments) — this lets loop
 * reconstruction resolve T-junctions exactly instead of guessing from
 * coordinates, and lets the cut flag be read off the tag directly instead
 * of a distance test. */
type LineTag = string
const outlineTag = (i: number): LineTag => `o:${i}`
const prismTag = (c: number, j: number): LineTag => `p:${c}:${j}`
const isPrismTag = (t: LineTag): boolean => t.charCodeAt(0) === 112 // 'p'

/** Signed area of a planar polygon in local (s1, s2) coordinates (Shoelace). */
function area2(poly: Pt2[]): number {
  let a = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % n]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

/** Sutherland–Hodgman clip of a convex polygon against the half-plane
 * `A·x + B·y ≤ C + eps`, carrying a parallel tag array (`tags[i]` = the tag
 * of the edge `poly[i] → poly[i+1]`). A surviving vertex keeps its
 * incoming edge's tag; the one new bridging edge introduced by this clip
 * (from the exit intersection to the entry intersection) is tagged
 * `newTag`. */
function clipHalfPlaneTagged(
  poly: Pt2[],
  tags: LineTag[],
  A: number,
  B: number,
  C: number,
  eps: number,
  newTag: LineTag,
): { pts: Pt2[]; tags: LineTag[] } {
  const n = poly.length
  if (n === 0) return { pts: [], tags: [] }
  const pts: Pt2[] = []
  const outTags: LineTag[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const da = A * a[0] + B * a[1] - C
    const db = A * b[0] + B * b[1] - C
    const aIn = da <= eps
    const bIn = db <= eps
    if (aIn) {
      pts.push(a)
      outTags.push(tags[i])
    }
    if (aIn !== bIn) {
      const t = da / (da - db)
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      outTags.push(aIn ? newTag : tags[i])
    }
  }
  return { pts, tags: outTags }
}

/** A prism's cut region as 2D half-planes on one panel's plane (`A·s1 +
 * B·s2 ≤ C`), derived by substituting the plane parameterization
 * P(s1,s2) = cen + s1·e1 + s2·e2 into the prism's linear world-space
 * constraints. `norm` is precomputed (‖A,B‖) for perpendicular-distance
 * tests. */
interface Plane2 {
  A: number
  B: number
  C: number
  norm: number
}

interface TaggedFrag {
  pts: Pt2[]
  tags: LineTag[]
}

type LoopWithArea = { pts2D: Pt2[]; tags: LineTag[]; signedArea: number }

/** True when every point of `pts` lies inside (or within `eps` of the
 * boundary of) the convex CCW polygon `container` — a cheap convex
 * containment test (container's own edges give its inward half-planes
 * directly; no need for a generic clip). Used to catch a later prism
 * landing strictly inside an already-recorded hole, so its bite isn't
 * double-recorded as a second, redundant hole over already-void area. */
function polygonContainsConvex(container: Pt2[], pts: Pt2[], eps: number): boolean {
  const n = container.length
  for (let i = 0; i < n; i++) {
    const p = container[i]
    const q = container[(i + 1) % n]
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const len = Math.hypot(dx, dy) || 1
    const A = dy / len
    const B = -dx / len
    const C = A * p[0] + B * p[1]
    for (const pt of pts) {
      if (A * pt[0] + B * pt[1] > C + eps) return false
    }
  }
  return true
}

/** `f` with its point order (and per-edge tags) reversed — used to flip a
 * CCW piece to CW (a hole loop) or to flip a prism's "inside" bite before
 * splicing it into an outer loop as a bridge (see the "Loops" section of
 * `clipOneUnit`: a bite computed by the normal "inside" convention shares
 * its overlapping tags with `region` in the SAME direction, which cancels
 * correctly, but its own brand-new bridge edges then point the wrong way
 * to close the spliced loop — reversing the whole bite first fixes both at
 * once). */
function reverseTaggedFrag(f: TaggedFrag): TaggedFrag {
  const n = f.pts.length
  const pts = f.pts.slice().reverse()
  const tags: LineTag[] = new Array(n)
  for (let i = 0; i < n; i++) tags[i] = f.tags[(n - 2 - i + n) % n]
  return { pts, tags }
}

/** Rebuild simple boundary loops from the tagged fragment set produced by
 * the convex-difference decomposition. Adjacent fragments can share only a
 * *partial* stretch of a common clip line (a T-junction: one fragment's
 * edge is the full clip-line segment, a neighbor's is a sub-range of it),
 * so naive "cancel exact-duplicate edges" leaves an unpaired remainder that
 * naive angle-disambiguated chaining weaves into a self-touching loop.
 * Fixed by first splitting every group of same-tag edges (which are, by
 * construction, exactly collinear — the tag names the one fixed line) at
 * the union of their endpoints, so any overlap becomes a run of exactly
 * matching sub-edges that cancel cleanly. What's left has degree ≤ 2 at
 * every vertex in the overwhelming common case; angular disambiguation
 * (tightest right turn) is kept only as a tie-breaker for the rare exact
 * coincidence of an outline vertex landing on a prism boundary, and a
 * repeated-vertex guard turns any remaining ambiguity into a loud failure
 * instead of a silently self-intersecting loop. */
function buildLoopsFromFragments(fragments: TaggedFrag[], diameter: number, areaFloor: number): LoopWithArea[] {
  interface TagEdge {
    a: Pt2
    b: Pt2
    tag: LineTag
  }
  const rawEdges: TagEdge[] = []
  for (const frag of fragments) {
    const n2 = frag.pts.length
    for (let i = 0; i < n2; i++) {
      rawEdges.push({ a: frag.pts[i], b: frag.pts[(i + 1) % n2], tag: frag.tags[i] })
    }
  }

  const grid = diameter * 1e-4

  // ---- Resolve T-junctions per shared tag ----
  const byTag = new Map<LineTag, TagEdge[]>()
  for (const e of rawEdges) {
    const list = byTag.get(e.tag)
    if (list) list.push(e)
    else byTag.set(e.tag, [e])
  }
  const splitEdges: TagEdge[] = []
  for (const edges of byTag.values()) {
    if (edges.length === 1) {
      const [a, b] = [edges[0].a, edges[0].b]
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= grid * 0.5) splitEdges.push(edges[0])
      continue
    }
    const ref = edges[0]
    const dx = ref.b[0] - ref.a[0]
    const dy = ref.b[1] - ref.a[1]
    const dl = Math.hypot(dx, dy) || 1
    const dirX = dx / dl
    const dirY = dy / dl
    const origin = ref.a
    const paramOf = (p: Pt2) => (p[0] - origin[0]) * dirX + (p[1] - origin[1]) * dirY
    const roundParam = (t: number) => Math.round(t / grid) * grid
    const pointAtParam = (t: number): Pt2 => [origin[0] + t * dirX, origin[1] + t * dirY]
    // Every breakpoint is, by construction, some edge's own actual endpoint
    // (we only ever add e.a/e.b below) — map each rounded param to that
    // ORIGINAL point object (first one seen) so a breakpoint contributed by
    // edge Y's endpoint is reused bit-exact when it falls in the *interior*
    // of edge X's span too, instead of being re-synthesized from X's own
    // parametrization and drifting a rounding bucket away from Y's copy.
    const paramToPoint = new Map<number, Pt2>()
    for (const e of edges) {
      const ta = roundParam(paramOf(e.a))
      const tb = roundParam(paramOf(e.b))
      if (!paramToPoint.has(ta)) paramToPoint.set(ta, e.a)
      if (!paramToPoint.has(tb)) paramToPoint.set(tb, e.b)
    }
    const sortedParams = [...paramToPoint.keys()].sort((x, y) => x - y)
    for (const e of edges) {
      const ta = roundParam(paramOf(e.a))
      const tb = roundParam(paramOf(e.b))
      const lo = Math.min(ta, tb)
      const hi = Math.max(ta, tb)
      const within = sortedParams.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9)
      const ordered = ta <= tb ? within : within.slice().reverse()
      for (let k = 0; k < ordered.length - 1; k++) {
        const pA = paramToPoint.get(ordered[k]) ?? pointAtParam(ordered[k])
        const pB = paramToPoint.get(ordered[k + 1]) ?? pointAtParam(ordered[k + 1])
        if (Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) < grid * 0.5) continue
        splitEdges.push({ a: pA, b: pB, tag: e.tag })
      }
    }
  }

  // ---- Cancel exact-duplicate edges (both endpoint keys equal, either
  // order) — genuine internal decomposition seams, now that T-junctions
  // are resolved into matching sub-edges. ----
  interface KeyedEdge extends TagEdge {
    aKey: string
    bKey: string
  }
  const keyOf = (p: Pt2) => `${Math.round(p[0] / grid)}:${Math.round(p[1] / grid)}`
  const edgeGroups = new Map<string, KeyedEdge[]>()
  for (const e of splitEdges) {
    const aKey = keyOf(e.a)
    const bKey = keyOf(e.b)
    if (aKey === bKey) continue
    const undirected = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
    const keyed: KeyedEdge = { ...e, aKey, bKey }
    const list = edgeGroups.get(undirected)
    if (list) list.push(keyed)
    else edgeGroups.set(undirected, [keyed])
  }
  const survivingEdges: KeyedEdge[] = []
  for (const [key, list] of edgeGroups) {
    if (list.length === 1) survivingEdges.push(list[0])
    else if (list.length === 2) continue
    else throw new Error(`panelClip: boundary edge ${key} appears ${list.length} times (expected 1 or 2)`)
  }

  const outMap = new Map<string, KeyedEdge[]>()
  for (const e of survivingEdges) {
    const list = outMap.get(e.aKey)
    if (list) list.push(e)
    else outMap.set(e.aKey, [e])
  }

  const pickNext = (incoming: KeyedEdge, cands: KeyedEdge[]): KeyedEdge => {
    if (cands.length === 1) return cands[0]
    const inAngle = Math.atan2(incoming.b[1] - incoming.a[1], incoming.b[0] - incoming.a[0])
    const refAngle = inAngle + Math.PI
    let best = cands[0]
    let bestDelta = Infinity
    for (const c of cands) {
      const outAngle = Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0])
      let delta = outAngle - refAngle
      delta = ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      if (delta < bestDelta) {
        bestDelta = delta
        best = c
      }
    }
    return best
  }

  const usedEdges = new Set<KeyedEdge>()
  const rawLoops: KeyedEdge[][] = []
  for (const startEdge of survivingEdges) {
    if (usedEdges.has(startEdge)) continue
    const loopEdges: KeyedEdge[] = [startEdge]
    usedEdges.add(startEdge)
    const visited = new Set<string>([startEdge.aKey])
    let current = startEdge
    let guard = 0
    while (true) {
      const pool = outMap.get(current.bKey) ?? []
      const cands = pool.filter((e) => e === startEdge || !usedEdges.has(e))
      if (cands.length === 0) throw new Error('panelClip: loop failed to close')
      const next = pickNext(current, cands)
      if (next === startEdge) break
      if (visited.has(next.aKey)) {
        throw new Error('panelClip: loop is not simple (revisits a vertex)')
      }
      visited.add(next.aKey)
      usedEdges.add(next)
      loopEdges.push(next)
      current = next
      guard++
      if (guard > survivingEdges.length + 4) throw new Error('panelClip: loop failed to close')
    }
    if (current.bKey !== startEdge.aKey) throw new Error('panelClip: loop failed to close')
    rawLoops.push(loopEdges)
  }

  return rawLoops
    .map((edges) => {
      const pts2D = edges.map((e) => e.a)
      const tags = edges.map((e) => e.tag)
      return { pts2D, tags, signedArea: area2(pts2D) }
    })
    .filter((l) => Math.abs(l.signedArea) >= areaFloor)
}

/** Per-panel-unit clip. Isolated from `clipPanels` so the outer function
 * stays a thin map over units. */
function clipOneUnit(unit: PanelUnit, unitIndex: number, model: DomeModel, radius: number, prisms: OpeningPrism[]): ClippedPanel {
  const P = (vi: number): Vec3 =>
    model.vertices[vi].position.map((c) => c * radius) as unknown as Vec3
  const pts3 = unit.ring.map(P)
  const nV = pts3.length

  // ---- Panel plane basis: Newell normal + first-edge e1, e2 = n×e1 (same
  // construction as panelFrames.ts). ----
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < nV; i++) {
    const a = pts3[i]
    const b = pts3[(i + 1) % nV]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  const nl = Math.hypot(nx, ny, nz) || 1
  const n = [nx / nl, ny / nl, nz / nl] as const
  const cen = pts3
    .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
    .map((c) => c / nV) as [number, number, number]
  const e0raw = [pts3[1][0] - pts3[0][0], pts3[1][1] - pts3[0][1], pts3[1][2] - pts3[0][2]]
  const d0 = e0raw[0] * n[0] + e0raw[1] * n[1] + e0raw[2] * n[2]
  const e1v = [e0raw[0] - d0 * n[0], e0raw[1] - d0 * n[1], e0raw[2] - d0 * n[2]]
  const e1l = Math.hypot(e1v[0], e1v[1], e1v[2]) || 1
  const e1 = [e1v[0] / e1l, e1v[1] / e1l, e1v[2] / e1l] as const
  const e2 = [
    n[1] * e1[2] - n[2] * e1[1],
    n[2] * e1[0] - n[0] * e1[2],
    n[0] * e1[1] - n[1] * e1[0],
  ] as const

  let ring = [...unit.ring]
  let outline: Pt2[] = pts3.map(
    (p) =>
      [
        (p[0] - cen[0]) * e1[0] + (p[1] - cen[1]) * e1[1] + (p[2] - cen[2]) * e1[2],
        (p[0] - cen[0]) * e2[0] + (p[1] - cen[1]) * e2[1] + (p[2] - cen[2]) * e2[2],
      ] as Pt2,
  )
  let origArea = area2(outline)
  if (origArea < 0) {
    ring = ring.slice().reverse()
    outline = outline.slice().reverse()
    origArea = -origArea
  }

  const toWorld = (s: Pt2): Vec3 => [
    cen[0] + s[0] * e1[0] + s[1] * e2[0],
    cen[1] + s[0] * e1[1] + s[1] * e2[1],
    cen[2] + s[0] * e1[2] + s[1] * e2[2],
  ]

  const wholeResult = (): ClippedPanel => {
    const pts = outline.map(toWorld)
    return {
      unitIndex,
      ring,
      faceIds: unit.faceIds,
      status: 'whole',
      fragments: [pts],
      loops: [{ pts, cut: pts.map(() => false) }],
      area: origArea,
    }
  }

  let diameter = 0
  for (let i = 0; i < nV; i++) {
    for (let j = i + 1; j < nV; j++) {
      const dx = pts3[i][0] - pts3[j][0]
      const dy = pts3[i][1] - pts3[j][1]
      const dz = pts3[i][2] - pts3[j][2]
      diameter = Math.max(diameter, Math.hypot(dx, dy, dz))
    }
  }
  if (diameter <= 0) diameter = 1e-6

  // ---- Per-prism candidate filter + 2D half-plane construction ----
  const candidates: Plane2[][] = []
  for (const prism of prisms) {
    const { ux, uy, z0, planes, cutPlaneDist } = prism

    // Fast reject: entirely behind the radial cut plane by more than a
    // panel diameter, or entirely outside one envelope plane by more than a
    // panel diameter (safe because u/t/z are linear over the convex hull).
    let allBehind = true
    for (const p of pts3) {
      if (ux * p[0] + uy * p[1] >= cutPlaneDist - diameter) {
        allBehind = false
        break
      }
    }
    if (allBehind) continue

    let rejected = false
    for (const pl of planes) {
      let allOutside = true
      for (const p of pts3) {
        const t = -uy * p[0] + ux * p[1]
        const z = p[2] - z0
        if (pl.nt * t + pl.nz * z - pl.c <= diameter) {
          allOutside = false
          break
        }
      }
      if (allOutside) {
        rejected = true
        break
      }
    }
    if (rejected) continue

    // Substitute P(s1,s2) = cen + s1·e1 + s2·e2 into t = -uy·x + ux·y and
    // z - z0, and into u = ux·x + uy·y, to get linear 2D forms.
    const t0 = -uy * cen[0] + ux * cen[1]
    const tE1 = -uy * e1[0] + ux * e1[1]
    const tE2 = -uy * e2[0] + ux * e2[1]
    const zC = cen[2] - z0
    const zE1 = e1[2]
    const zE2 = e2[2]
    const u0 = ux * cen[0] + uy * cen[1]
    const uE1 = ux * e1[0] + uy * e1[1]
    const uE2 = ux * e2[0] + uy * e2[1]

    const planes2: Plane2[] = planes.map((pl) => {
      const A = pl.nt * tE1 + pl.nz * zE1
      const B = pl.nt * tE2 + pl.nz * zE2
      const C = pl.c - pl.nt * t0 - pl.nz * zC
      return { A, B, C, norm: Math.hypot(A, B) || 1 }
    })
    // u ≥ cutPlaneDist  ⇔  -uE1·s1 - uE2·s2 ≤ u0 - cutPlaneDist
    planes2.push({ A: -uE1, B: -uE2, C: u0 - cutPlaneDist, norm: Math.hypot(uE1, uE2) || 1 })
    candidates.push(planes2)
  }

  if (candidates.length === 0) return wholeResult()

  // ---- Convex-difference decomposition: for each prism's half-planes
  // H_0..H_K, each current fragment F splits into F∩H̄_j∩H_0..j-1 (kept,
  // outside the prism) for j = 0..K, and the final F∩H_0..H_K (fully
  // inside the prism) is discarded. Each fragment carries a parallel tag
  // per edge identifying which fixed line (an original outline edge, or a
  // specific prism half-plane) it lies on — see `buildLoopsFromFragments`
  // for why. ----
  const REL_EPS = 1e-9
  const areaFloor = origArea * 1e-6
  let fragments: TaggedFrag[] = [{ pts: outline, tags: outline.map((_, i) => outlineTag(i)) }]

  for (let ci = 0; ci < candidates.length; ci++) {
    const planeSet = candidates[ci]
    const next: TaggedFrag[] = []
    for (const frag of fragments) {
      let remaining = frag
      for (let pj = 0; pj < planeSet.length; pj++) {
        const pl = planeSet[pj]
        const eps = REL_EPS * diameter * pl.norm
        const tag = prismTag(ci, pj)
        const outside = clipHalfPlaneTagged(remaining.pts, remaining.tags, -pl.A, -pl.B, -pl.C, eps, tag)
        if (outside.pts.length >= 3 && Math.abs(area2(outside.pts)) >= areaFloor) next.push(outside)
        remaining = clipHalfPlaneTagged(remaining.pts, remaining.tags, pl.A, pl.B, pl.C, eps, tag)
        if (remaining.pts.length < 3) break
      }
    }
    fragments = next
  }

  const totalArea = fragments.reduce((s, f) => s + Math.abs(area2(f.pts)), 0)

  // ---- Loops ----
  // Not derived from the fragment wedge fan above (see `buildLoopsFromFragments`'s
  // doc comment on why that's fragile once a prism has many sides): instead,
  // walk the candidates one at a time against the current set of tracked
  // pieces (starting from just the outline, isHole=false). For each piece,
  // `bite` = piece ∩ this one prism, computed as a single sequential
  // half-plane clip (never decomposed into wedges).
  //
  // Every piece — outer material AND any hole recorded earlier — is run
  // through the exact same bite/touch/notch logic. That uniformity is what
  // keeps overlapping opening prisms honest: users can place two windows
  // that overlap, or a door that entirely swallows an earlier window, and
  // the optimizer only discourages this, it doesn't forbid it (`clipPanels`
  // is a public engine API). If a hole's own prior bite were exempted from
  // later prisms (as it used to be), a second prism overlapping it would
  // either double-subtract the overlap (recording two overlapping hole
  // loops for what should be one merged void) or leave a hole loop floating
  // inside a notch that already swallowed it — both silently wrong, since
  // `fragments`/`area` don't go through this path and stay correct, so only
  // `loops` would lie.
  //
  // Processing every piece uniformly against every candidate makes this
  // correct by the set identity A∪B = (A\B)∪B, applied piece by piece: a
  // fresh, still-untouched piece (isHole=false, i.e. outer material whose
  // own boundary a hole never alters) captures each new prism's bite in
  // full the first time it doesn't touch that piece's boundary (the "∪B"
  // term); every OTHER already-tracked piece — outer or hole — that the
  // same bite also overlaps gets notched down by exactly that overlap (the
  // "A\B" term), whether it's a clean interior hole a corner nibbles off
  // (fixing repro 1: two overlapping windows shrink to non-overlapping
  // pieces whose union is exact) or an entire hole a later door swallows,
  // which notches to nothing at all and is correctly dropped (fixing repro
  // 2: no floating hole regardless of prism order). A non-touching bite
  // found against an EXISTING hole (fully redundant, already-void overlap)
  // is discarded rather than recorded again, since it carries no new area.
  interface TrackedFrag extends TaggedFrag {
    isHole: boolean
  }
  let pieces: TrackedFrag[] = [{ pts: outline, tags: outline.map((_, i) => outlineTag(i)), isHole: false }]
  const containEps = 1e-6 * diameter
  for (let ci = 0; ci < candidates.length; ci++) {
    const planeSet = candidates[ci]
    const ownPrefix = `p:${ci}:`
    // Existing holes as of *before* this candidate — a non-touching bite
    // found against a fresh (non-hole) piece only earns a new hole entry if
    // it isn't already entirely accounted for by one of these. Snapshotting
    // them here (rather than re-deriving from `nextPieces`, which this
    // candidate is still building) means a piece this same candidate
    // notched down doesn't retroactively suppress its own new hole.
    const existingHoles = pieces.filter((p) => p.isHole)
    const nextPieces: TrackedFrag[] = []
    for (const piece of pieces) {
      let bite: TaggedFrag = piece
      for (let pj = 0; pj < planeSet.length; pj++) {
        const pl = planeSet[pj]
        const eps = REL_EPS * diameter * pl.norm
        bite = clipHalfPlaneTagged(bite.pts, bite.tags, pl.A, pl.B, pl.C, eps, prismTag(ci, pj))
        if (bite.pts.length < 3) break
      }
      if (bite.pts.length < 3 || Math.abs(area2(bite.pts)) < areaFloor) {
        nextPieces.push(piece)
        continue
      }
      const touchesBoundary = bite.tags.some((t) => !t.startsWith(ownPrefix))
      if (!touchesBoundary) {
        nextPieces.push(piece)
        // A non-touching bite off a fresh piece is normally a brand-new
        // hole — UNLESS this exact area is already void: a later prism
        // strictly inside an earlier hole (e.g. a small window re-drawn
        // inside a bigger one already removed) clips to a bite entirely
        // contained in that hole. Recording it again would double-subtract
        // area a hole-side check elsewhere already discards as redundant
        // (see the `piece.isHole` branch just above — this is its mirror
        // for the non-hole side).
        if (!piece.isHole && !existingHoles.some((h) => polygonContainsConvex(h.pts, bite.pts, containEps))) {
          nextPieces.push({ ...bite, isHole: true })
        }
        continue
      }
      const notched = buildLoopsFromFragments([piece, reverseTaggedFrag(bite)], diameter, areaFloor)
      for (const n of notched) nextPieces.push({ pts: n.pts2D, tags: n.tags, isHole: piece.isHole })
    }
    pieces = nextPieces
  }

  const loopsWithArea: LoopWithArea[] = pieces
    .map((p) => (p.isHole ? reverseTaggedFrag(p) : p))
    .map((f) => ({ pts2D: f.pts, tags: f.tags, signedArea: area2(f.pts) }))
    .filter((l) => Math.abs(l.signedArea) >= areaFloor)
  loopsWithArea.sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea))
  const loops: ClippedLoop[] = loopsWithArea.map((l) => ({
    pts: l.pts2D.map(toWorld),
    cut: l.tags.map(isPrismTag),
  }))

  const anyCut = loops.some((l) => l.cut.some(Boolean))
  let status: 'whole' | 'clipped' | 'removed'
  if (fragments.length === 0) status = 'removed'
  else if (totalArea >= (1 - 1e-9) * origArea && !anyCut) status = 'whole'
  else status = 'clipped'

  // A candidate prism can pass the fast-reject filter without actually
  // removing anything usable (e.g. it only shaves off a sliver thinner
  // than the area floor) — the contract is that 'whole' always reports
  // exactly one fragment, the original ring, not whatever partial wedge
  // partition the decomposition happened to leave lying around.
  if (status === 'whole') return wholeResult()

  return {
    unitIndex,
    ring,
    faceIds: unit.faceIds,
    status,
    fragments: fragments.map((f) => f.pts.map(toWorld)),
    loops,
    area: totalArea,
  }
}

/** Clip every panel unit against every opening prism, producing surviving
 * convex fragments and merged boundary loops (outer + hole). Runs in world
 * working-unit space (positions × radius); returned points are at that
 * scale. */
export function clipPanels(model: DomeModel, radius: number, prisms: OpeningPrism[]): ClippedPanel[] {
  const units = panelUnits(model)
  return units.map((u, i) => clipOneUnit(u, i, model, radius, prisms))
}
