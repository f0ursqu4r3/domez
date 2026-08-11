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
 * `A·x + B·y ≤ C + eps`. */
function clipHalfPlane(poly: Pt2[], A: number, B: number, C: number, eps: number): Pt2[] {
  const n = poly.length
  if (n === 0) return []
  const out: Pt2[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const da = A * a[0] + B * a[1] - C
    const db = A * b[0] + B * b[1] - C
    const aIn = da <= eps
    const bIn = db <= eps
    if (aIn) out.push(a)
    if (aIn !== bIn) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
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

interface DirEdge {
  a: Pt2
  b: Pt2
  aKey: string
  bKey: string
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

  if (candidates.length === 0) {
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

  // ---- Convex-difference decomposition: for each prism's half-planes
  // H_0..H_K, each current fragment F splits into F∩H̄_j∩H_0..j-1 (kept,
  // outside the prism) for j = 0..K, and the final F∩H_0..H_K (fully
  // inside the prism) is discarded. ----
  const REL_EPS = 1e-9
  const areaFloor = origArea * 1e-6
  let fragments: Pt2[][] = [outline]

  for (const planeSet of candidates) {
    const next: Pt2[][] = []
    for (const frag of fragments) {
      let remaining = frag
      for (const pl of planeSet) {
        const eps = REL_EPS * diameter * pl.norm
        const outside = clipHalfPlane(remaining, -pl.A, -pl.B, -pl.C, eps)
        if (outside.length >= 3 && Math.abs(area2(outside)) >= areaFloor) next.push(outside)
        remaining = clipHalfPlane(remaining, pl.A, pl.B, pl.C, eps)
        if (remaining.length < 3) break
      }
    }
    fragments = next
  }

  const totalArea = fragments.reduce((s, f) => s + Math.abs(area2(f)), 0)

  type LoopWithArea = { pts2D: Pt2[]; cut: boolean[]; signedArea: number }

  // ---- General fallback: chain surviving fragment edges by rounded
  // endpoint key, canceling exact-duplicate edges (internal decomposition
  // seams), for panels where a prism's cut region touches the original
  // outline (a genuine boundary notch, not a self-contained hole). ----
  function buildLoopsFromFragments(): LoopWithArea[] {
    const grid = diameter * 1e-4
    const keyOf = (p: Pt2) => `${Math.round(p[0] / grid)}:${Math.round(p[1] / grid)}`

    const edgeGroups = new Map<string, DirEdge[]>()
    for (const frag of fragments) {
      const n2 = frag.length
      for (let i = 0; i < n2; i++) {
        const a = frag[i]
        const b = frag[(i + 1) % n2]
        const aKey = keyOf(a)
        const bKey = keyOf(b)
        if (aKey === bKey) continue
        const undirected = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
        const list = edgeGroups.get(undirected)
        if (list) list.push({ a, b, aKey, bKey })
        else edgeGroups.set(undirected, [{ a, b, aKey, bKey }])
      }
    }

    const survivingEdges: DirEdge[] = []
    for (const [key, list] of edgeGroups) {
      if (list.length === 1) survivingEdges.push(list[0])
      else if (list.length === 2) continue
      else throw new Error(`panelClip: boundary edge ${key} appears ${list.length} times (expected 1 or 2)`)
    }

    const outMap = new Map<string, DirEdge[]>()
    for (const e of survivingEdges) {
      const list = outMap.get(e.aKey)
      if (list) list.push(e)
      else outMap.set(e.aKey, [e])
    }

    // Several surviving edges can end at the same rounded point (e.g. a hole
    // vertex that also sits on the original outline, where the decomposition
    // leaves a 4-way branch). Disambiguate by turning angle: coming in along
    // `incoming`, take the outgoing edge that requires the smallest
    // counterclockwise rotation from the reversed incoming direction (the
    // tightest right turn) — the standard rule for tracing a single boundary
    // component out of a set of CCW-oriented fragment edges.
    const pickNext = (incoming: DirEdge, cands: DirEdge[]): DirEdge => {
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

    const usedEdges = new Set<DirEdge>()
    const rawLoops: DirEdge[][] = []
    for (const startEdge of survivingEdges) {
      if (usedEdges.has(startEdge)) continue
      const loopEdges: DirEdge[] = [startEdge]
      usedEdges.add(startEdge)
      let current = startEdge
      let guard = 0
      while (true) {
        const pool = outMap.get(current.bKey) ?? []
        const cands = pool.filter((e) => e === startEdge || !usedEdges.has(e))
        if (cands.length === 0) throw new Error('panelClip: loop failed to close')
        const next = pickNext(current, cands)
        if (next === startEdge) break
        usedEdges.add(next)
        loopEdges.push(next)
        current = next
        guard++
        if (guard > survivingEdges.length + 4) throw new Error('panelClip: loop failed to close')
      }
      if (current.bKey !== startEdge.aKey) throw new Error('panelClip: loop failed to close')
      rawLoops.push(loopEdges)
    }

    // A loop edge is 'cut' when its midpoint lies on some prism's 2D
    // half-plane boundary AND inside that prism's other half-planes — i.e.
    // it borders the removed region.
    const cutEps = 1e-6 * diameter
    const isCutEdge = (e: DirEdge): boolean => {
      const mx = (e.a[0] + e.b[0]) / 2
      const my = (e.a[1] + e.b[1]) / 2
      for (const planeSet of candidates) {
        for (let j = 0; j < planeSet.length; j++) {
          const pj = planeSet[j]
          const distJ = (pj.A * mx + pj.B * my - pj.C) / pj.norm
          if (Math.abs(distJ) >= cutEps) continue
          let insideOthers = true
          for (let k = 0; k < planeSet.length; k++) {
            if (k === j) continue
            const pk = planeSet[k]
            const distK = (pk.A * mx + pk.B * my - pk.C) / pk.norm
            if (distK > cutEps) {
              insideOthers = false
              break
            }
          }
          if (insideOthers) return true
        }
      }
      return false
    }

    // Branch-point disambiguation (picking the tightest-turn continuation at
    // a vertex where several fragments meet) occasionally closes off a
    // degenerate near-zero-area sliver instead of continuing through it —
    // floating-point noise, not real geometry. Drop those before reporting.
    return rawLoops
      .map((edges) => {
        const pts2D = edges.map((e) => e.a)
        const cut = edges.map(isCutEdge)
        return { pts2D, cut, signedArea: area2(pts2D) }
      })
      .filter((l) => Math.abs(l.signedArea) >= areaFloor)
  }

  // ---- Loops ----
  // Fast, exact path first: if every candidate's cut region sits fully
  // interior to the panel (never touching the original outline), each one
  // is a clean hole — outer loop is the untouched outline, one hole loop
  // per prism. This is the common "opening lands inside one panel" case,
  // and sidesteps the general edge-soup reconstruction below (which, once
  // several prism half-planes fan out from an interior point, has enough
  // coincident branch vertices that naive chaining can misroute).
  const touchEps = 1e-6 * diameter
  const pointNearSegment = (p: Pt2, a: Pt2, b: Pt2, eps: number): boolean => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]) < eps
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    const cx = a[0] + t * dx
    const cy = a[1] + t * dy
    return Math.hypot(p[0] - cx, p[1] - cy) < eps
  }
  const pointOnOutline = (p: Pt2): boolean => {
    const n2 = outline.length
    for (let i = 0; i < n2; i++) {
      if (pointNearSegment(p, outline[i], outline[(i + 1) % n2], touchEps)) return true
    }
    return false
  }

  let anyTouch = false
  const holeCandidates: Pt2[][] = []
  for (const planeSet of candidates) {
    let bite: Pt2[] = outline
    for (const pl of planeSet) {
      const eps = REL_EPS * diameter * pl.norm
      bite = clipHalfPlane(bite, pl.A, pl.B, pl.C, eps)
      if (bite.length < 3) break
    }
    if (bite.length < 3 || Math.abs(area2(bite)) < areaFloor) continue
    if (bite.some((p) => pointOnOutline(p))) {
      anyTouch = true
      break
    }
    holeCandidates.push(bite)
  }

  let loopsWithArea: LoopWithArea[]

  if (!anyTouch) {
    const outer: LoopWithArea = { pts2D: outline, cut: outline.map(() => false), signedArea: origArea }
    const holes: LoopWithArea[] = holeCandidates.map((bite) => {
      const rev = bite.slice().reverse()
      return { pts2D: rev, cut: rev.map(() => true), signedArea: area2(rev) }
    })
    loopsWithArea = [outer, ...holes]
  } else {
    loopsWithArea = buildLoopsFromFragments()
  }
  loopsWithArea.sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea))
  const loops: ClippedLoop[] = loopsWithArea.map((l) => ({ pts: l.pts2D.map(toWorld), cut: l.cut }))

  const anyCut = loops.some((l) => l.cut.some(Boolean))
  let status: 'whole' | 'clipped' | 'removed'
  if (fragments.length === 0) status = 'removed'
  else if (totalArea >= (1 - 1e-9) * origArea && !anyCut) status = 'whole'
  else status = 'clipped'

  return {
    unitIndex,
    ring,
    faceIds: unit.faceIds,
    status,
    fragments: fragments.map((f) => f.map(toWorld)),
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
