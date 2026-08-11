import type { DomeModel, UnitSystem, Vec3 } from './types'
import type { DoorwayCut } from './doorway'
import { clipPanels, panelUnits, type ClippedLoop, type ClippedPanel } from './panelClip'

/** One distinct member cut within a frame type. */
export interface FrameMemberSpec {
  label: string
  count: number
  longPointLength: number
  miterStartDeg: number
  miterEndDeg: number
  bevelDeg: number
  boundary: boolean
  /** True when this cut lies on the opening interface (X-types only) —
   * there's no shell edge to bevel against, and no bolt seam on the far
   * side (the opening closure attaches here instead). */
  cutEdge?: boolean
}

/** A jig recipe: one panel shape + dihedral context, built panelCount times. */
export interface FrameType {
  label: string
  panelCount: number
  sides: number
  members: FrameMemberSpec[]
  outline: [number, number][]
  cornerAnglesDeg: number[]
  /** For each outline edge (same order/index as `outline`), the index into
   * `members[]` of the spec that edge is actually cut from. `members` is
   * deduped (one entry per distinct cut, with a `count`), so this is the
   * only place the true per-edge mapping survives — geometry alone (edge
   * length + corner angles) cannot always reconstruct it, since two
   * members can be geometrically identical and differ only in bevel or
   * boundary (e.g. a symmetric panel with one boundary/sill edge among
   * otherwise-identical interior edges). */
  edgeMemberIdx: number[]
  /** 2D hole outlines (same plane basis as `outline`) — X-types only, one
   * entry per opening-carved void fully inside this panel. */
  holes?: [number, number][][]
  /** True for a one-off, site-fit panel produced by clipping against an
   * opening — no signature grouping, `panelCount` is always 1. */
  siteFit?: boolean
}

export interface PanelFramePlan {
  types: FrameType[]
  totalPanels: number
  totalMembers: number
  seamCount: number
  totalSeamLength: number
  boltCount: number
  omittedPanels: number
}

const deg = (r: number) => (r * 180) / Math.PI
const r1 = (x: number) => Math.round(x * 10) / 10

interface PanelGeom {
  ring: number[]
  outline: [number, number][] // 2D, CCW
  corners: number[] // interior angle at each outline vertex, deg
  edges: { len: number; bevel: number; boundary: boolean; edgeId: number }[]
}

/** A loop's edges + corner angles, projected into a panel's plane basis. */
interface LoopGeom {
  pts2D: [number, number][]
  corners: number[]
  edges: { len: number; bevel: number; boundary: boolean; cutEdge: boolean }[]
}

/** Right-handed in-plane basis for a ring: Newell normal, e1 from the first
 * ring edge (projected orthogonal to the normal), e2 = n×e1, centroid
 * origin. Shared by the whole-panel path and the X-type (clipped) path so
 * both agree on the same 2D frame for a given unit. */
function ringBasis(pts: Vec3[]) {
  const nV = pts.length
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < nV; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % nV]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  const nl = Math.hypot(nx, ny, nz) || 1
  const n = [nx / nl, ny / nl, nz / nl] as const
  const cen = pts
    .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
    .map((c) => c / nV) as [number, number, number]
  const e0raw = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]]
  const d0 = e0raw[0] * n[0] + e0raw[1] * n[1] + e0raw[2] * n[2]
  const e1v = [e0raw[0] - d0 * n[0], e0raw[1] - d0 * n[1], e0raw[2] - d0 * n[2]]
  const e1l = Math.hypot(e1v[0], e1v[1], e1v[2]) || 1
  const e1 = [e1v[0] / e1l, e1v[1] / e1l, e1v[2] / e1l] as const
  const e2 = [
    n[1] * e1[2] - n[2] * e1[1],
    n[2] * e1[0] - n[0] * e1[2],
    n[0] * e1[1] - n[1] * e1[0],
  ] as const
  return { n, cen, e1, e2 }
}

/**
 * Framed-panel ("double wall") takeoff: every panel becomes an independent
 * mitered/beveled frame; interior seams carry two members. Whole panels
 * group by signature into F-types; panels clipped by an opening become
 * one-off, site-fit X-types built straight from the clip's boundary loops.
 * Fully-removed panels are omitted — frame those openings on site.
 */
export function buildPanelFrames(
  model: DomeModel,
  radius: number,
  units: UnitSystem,
  _doorway: DoorwayCut,
  clips: ClippedPanel[],
): PanelFramePlan {
  // ---- Panel units: outline rings + owning faces (index-aligned with `clips`) ----
  const unitsAll = panelUnits(model)
  // Callers may pass `[]` as a "no openings" shorthand (e.g. skipping the
  // clip pass entirely when there are no doors/windows) — treat any clips
  // array that isn't actually index-aligned with `unitsAll` as exactly that,
  // and derive the real (all-'whole') clip set ourselves.
  if (clips.length !== unitsAll.length) clips = clipPanels(model, radius, [])

  // ---- Edge lookup + leveled-base detection ----
  const edgeByKey = new Map<string, number>()
  model.edges.forEach((e) => edgeByKey.set(`${Math.min(e.v0, e.v1)}:${Math.max(e.v0, e.v1)}`, e.id))
  const baseZ = model.vertices.filter((v) => v.isBase).map((v) => v.position[2])
  const leveledBase = baseZ.length > 0 && Math.max(...baseZ) - Math.min(...baseZ) < 1e-6

  const P = (vid: number): Vec3 => model.vertices[vid].position.map((c) => c * radius) as unknown as Vec3

  /** Bevel + boundary flag for a model edge (or its absence), matching the
   * legacy per-edge rule exactly: a real interior dihedral bevels to half
   * the supplement; anything else (true boundary, or an opening-cut edge
   * with no model edge at all) falls back to the leveled-base floor bevel
   * when the base is flat, else a square cut. */
  const edgeBevelBoundary = (eid: number | undefined, nz: number): { bevel: number; boundary: boolean } => {
    const edge = eid !== undefined ? model.edges[eid] : undefined
    let bevel = 0
    let boundary = true
    if (edge && edge.faceIds.length === 2 && Number.isFinite(edge.dihedralDeg)) {
      bevel = (180 - edge.dihedralDeg) / 2
      boundary = false
    } else if (leveledBase) {
      bevel = Math.max(0, 90 - deg(Math.acos(Math.min(1, Math.abs(nz)))))
    }
    return { bevel, boundary }
  }

  // ---- Whole-panel geometry (byte-identical to the pre-clip implementation) ----
  const buildWholeGeom = (ring0: number[]): PanelGeom => {
    const pts = ring0.map(P)
    const { n, cen, e1, e2 } = ringBasis(pts)
    let ring = [...ring0]
    let outline = pts.map(
      (p) =>
        [
          (p[0] - cen[0]) * e1[0] + (p[1] - cen[1]) * e1[1] + (p[2] - cen[2]) * e1[2],
          (p[0] - cen[0]) * e2[0] + (p[1] - cen[1]) * e2[1] + (p[2] - cen[2]) * e2[2],
        ] as [number, number],
    )
    // CCW normalization.
    let area = 0
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]
      const b = outline[(i + 1) % outline.length]
      area += a[0] * b[1] - b[0] * a[1]
    }
    if (area < 0) {
      ring = ring.slice().reverse()
      outline = outline.slice().reverse()
    }
    // Corner interior angles.
    const nV = outline.length
    const corners = outline.map((p, i) => {
      const prev = outline[(i + nV - 1) % nV]
      const next = outline[(i + 1) % nV]
      const a = [prev[0] - p[0], prev[1] - p[1]]
      const b = [next[0] - p[0], next[1] - p[1]]
      const la = Math.hypot(a[0], a[1]) || 1
      const lb = Math.hypot(b[0], b[1]) || 1
      const cos = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))
      return deg(Math.acos(cos))
    })
    // Edges: ring[i] → ring[i+1].
    const edges = ring.map((va, i) => {
      const vb = ring[(i + 1) % nV]
      const a = outline[i]
      const b = outline[(i + 1) % nV]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const eid = edgeByKey.get(`${Math.min(va, vb)}:${Math.max(va, vb)}`)
      const { bevel, boundary } = edgeBevelBoundary(eid, n[2])
      return { len, bevel, boundary, edgeId: eid ?? -1 }
    })
    return { ring, outline, corners, edges }
  }

  // ---- Split clips into whole (grouped) vs clipped (one-off) vs removed ----
  let omittedPanels = 0
  const geoms: PanelGeom[] = []
  const clippedUnitIndices: number[] = []
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    if (clip.status === 'removed') {
      omittedPanels++
    } else if (clip.status === 'whole') {
      geoms.push(buildWholeGeom(unitsAll[i].ring))
    } else {
      clippedUnitIndices.push(i)
    }
  }

  // ---- Group whole panels by canonical cyclic signature (F-types) ----
  const sigOf = (g: PanelGeom): string => {
    const nV = g.edges.length
    const entry = (ei: number, ci: number) =>
      `${r1(g.edges[ei].len)}|${r1(g.edges[ei].bevel)}|${r1(g.corners[ci])}`
    const candidates: string[] = []
    for (let s = 0; s < nV; s++) {
      const fwd: string[] = []
      const rev: string[] = []
      for (let k = 0; k < nV; k++) {
        const ef = (s + k) % nV
        fwd.push(entry(ef, ef))
        // Reversed traversal: edge (s−k) with its END corner as the start.
        const er = (s - k + 2 * nV) % nV
        rev.push(entry(er, (er + 1) % nV))
      }
      candidates.push(fwd.join(';'), rev.join(';'))
    }
    return candidates.sort()[0]
  }
  const groups = new Map<string, { rep: PanelGeom; count: number }>()
  for (const g of geoms) {
    const sig = sigOf(g)
    const cur = groups.get(sig)
    if (cur) cur.count++
    else groups.set(sig, { rep: g, count: 1 })
  }

  const sorted = [...groups.values()].sort((a, b) => b.count - a.count)
  const fTypes: FrameType[] = sorted.map((grp, ti) => {
    const g = grp.rep
    const nV = g.edges.length
    // Dedupe identical member cuts within the panel, tracking each edge's
    // key so the true per-edge → member mapping survives the dedupe.
    const specs = new Map<string, FrameMemberSpec>()
    const edgeKeys: string[] = new Array(nV)
    g.edges.forEach((e, i) => {
      const ms = g.corners[i] / 2
      const me = g.corners[(i + 1) % nV] / 2
      const [a, b] = ms <= me ? [ms, me] : [me, ms]
      const key = `${r1(e.len)}|${r1(e.bevel)}|${r1(a)}|${r1(b)}|${e.boundary}`
      edgeKeys[i] = key
      const cur = specs.get(key)
      if (cur) cur.count++
      else
        specs.set(key, {
          label: '',
          count: 1,
          longPointLength: e.len,
          miterStartDeg: a,
          miterEndDeg: b,
          bevelDeg: e.bevel,
          boundary: e.boundary,
        })
    })
    const members = [...specs.values()]
    members.forEach((m, i) => (m.label = `F${ti + 1}-${String.fromCharCode(97 + i)}`))
    const idxByKey = new Map([...specs.keys()].map((k, idx) => [k, idx]))
    const edgeMemberIdx = edgeKeys.map((k) => idxByKey.get(k)!)
    return {
      label: `F${ti + 1}`,
      panelCount: grp.count,
      sides: nV,
      members,
      outline: g.outline,
      cornerAnglesDeg: g.corners,
      edgeMemberIdx,
    }
  })

  // ---- X-types: one-off site-fit frames for clipped panels ----
  const unitRingPts: Vec3[][] = unitsAll.map((u) => u.ring.map(P))
  const diameterCache: number[] = new Array(unitsAll.length)
  const unitDiameter = (idx: number): number => {
    if (diameterCache[idx] !== undefined) return diameterCache[idx]
    const pts = unitRingPts[idx]
    let d = 0
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        d = Math.max(
          d,
          Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]),
        )
      }
    }
    return (diameterCache[idx] = d || 1e-6)
  }

  /** A ring edge lies on a fixed 3D line; a loop edge belongs to it when
   * both its endpoints fall within `eps` of that line AND within its
   * param range (a non-cut loop edge is either the full ring edge or a
   * sub-piece split off at a T-junction with another prism). Returns the
   * ring edge index, or undefined if no ring edge matches. */
  const matchRingEdge = (ringPts: Vec3[], a: Vec3, b: Vec3, eps: number): number | undefined => {
    const nV = ringPts.length
    for (let i = 0; i < nV; i++) {
      const ra = ringPts[i]
      const rb = ringPts[(i + 1) % nV]
      const dx = rb[0] - ra[0]
      const dy = rb[1] - ra[1]
      const dz = rb[2] - ra[2]
      const segLenSq = dx * dx + dy * dy + dz * dz
      if (segLenSq < 1e-18) continue
      const paramAndDist = (p: Vec3) => {
        const t = ((p[0] - ra[0]) * dx + (p[1] - ra[1]) * dy + (p[2] - ra[2]) * dz) / segLenSq
        const cx = ra[0] + t * dx
        const cy = ra[1] + t * dy
        const cz = ra[2] + t * dz
        return { t, dist: Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) }
      }
      const pa = paramAndDist(a)
      const pb = paramAndDist(b)
      if (pa.dist > eps || pb.dist > eps) continue
      if (pa.t < -1e-6 || pa.t > 1 + 1e-6 || pb.t < -1e-6 || pb.t > 1 + 1e-6) continue
      return i
    }
    return undefined
  }

  /** Project + measure one clip loop into the unit's plane basis, resolving
   * each non-cut edge's bevel against the model edge it lies on. */
  const buildLoopGeom = (
    loop: ClippedLoop,
    ring: number[],
    ringPts: Vec3[],
    basis: ReturnType<typeof ringBasis>,
    eps: number,
  ): LoopGeom => {
    const { cen, e1, e2, n } = basis
    const to2D = (p: Vec3): [number, number] => [
      (p[0] - cen[0]) * e1[0] + (p[1] - cen[1]) * e1[1] + (p[2] - cen[2]) * e1[2],
      (p[0] - cen[0]) * e2[0] + (p[1] - cen[1]) * e2[1] + (p[2] - cen[2]) * e2[2],
    ]
    const pts2D = loop.pts.map(to2D)
    const nV = pts2D.length
    const corners = pts2D.map((p, i) => {
      const prev = pts2D[(i + nV - 1) % nV]
      const next = pts2D[(i + 1) % nV]
      const va = [prev[0] - p[0], prev[1] - p[1]]
      const vb = [next[0] - p[0], next[1] - p[1]]
      const la = Math.hypot(va[0], va[1]) || 1
      const lb = Math.hypot(vb[0], vb[1]) || 1
      const cos = Math.min(1, Math.max(-1, (va[0] * vb[0] + va[1] * vb[1]) / (la * lb)))
      return deg(Math.acos(cos))
    })
    const edges = loop.pts.map((a, i) => {
      const b = loop.pts[(i + 1) % nV]
      const len = Math.hypot(pts2D[i][0] - pts2D[(i + 1) % nV][0], pts2D[i][1] - pts2D[(i + 1) % nV][1])
      if (loop.cut[i]) return { len, bevel: 0, boundary: true, cutEdge: true }
      const ringIdx = matchRingEdge(ringPts, a, b, eps)
      const eid =
        ringIdx !== undefined
          ? edgeByKey.get(
              `${Math.min(ring[ringIdx], ring[(ringIdx + 1) % ring.length])}:${Math.max(ring[ringIdx], ring[(ringIdx + 1) % ring.length])}`,
            )
          : undefined
      const { bevel, boundary } = edgeBevelBoundary(eid, n[2])
      return { len, bevel, boundary, cutEdge: false }
    })
    return { pts2D, corners, edges }
  }

  const xTypes: FrameType[] = clippedUnitIndices.map((unitIndex, xi) => {
    const unit = unitsAll[unitIndex]
    const ringPts = unitRingPts[unitIndex]
    const basis = ringBasis(ringPts)
    const eps = 1e-6 * unitDiameter(unitIndex)
    const clip = clips[unitIndex]

    const isHoleLoop = (l: ClippedLoop) => l.cut.every(Boolean)
    const outerLoop = clip.loops.find((l) => !isHoleLoop(l)) ?? clip.loops[0]
    const holeLoops = clip.loops.filter((l) => l !== outerLoop && isHoleLoop(l))

    const outerGeom = buildLoopGeom(outerLoop, unit.ring, ringPts, basis, eps)
    const holeGeoms = holeLoops.map((l) => buildLoopGeom(l, unit.ring, ringPts, basis, eps))

    // Dedupe identical member cuts across every loop edge (outline + holes).
    const specs = new Map<string, FrameMemberSpec>()
    const keyOf = (
      e: { len: number; bevel: number; boundary: boolean; cutEdge: boolean },
      ms: number,
      me: number,
    ) => {
      const [a, b] = ms <= me ? [ms, me] : [me, ms]
      return `${r1(e.len)}|${r1(e.bevel)}|${r1(a)}|${r1(b)}|${e.boundary}|${e.cutEdge}`
    }
    const register = (
      e: { len: number; bevel: number; boundary: boolean; cutEdge: boolean },
      ms: number,
      me: number,
    ): string => {
      const [a, b] = ms <= me ? [ms, me] : [me, ms]
      const key = keyOf(e, ms, me)
      const cur = specs.get(key)
      if (cur) cur.count++
      else
        specs.set(key, {
          label: '',
          count: 1,
          longPointLength: e.len,
          miterStartDeg: a,
          miterEndDeg: b,
          bevelDeg: e.bevel,
          boundary: e.boundary,
          cutEdge: e.cutEdge,
        })
      return key
    }

    const outerEdgeKeys = outerGeom.edges.map((e, i) => {
      const nV = outerGeom.edges.length
      return register(e, outerGeom.corners[i] / 2, outerGeom.corners[(i + 1) % nV] / 2)
    })
    for (const hg of holeGeoms) {
      hg.edges.forEach((e, i) => {
        const nV = hg.edges.length
        register(e, hg.corners[i] / 2, hg.corners[(i + 1) % nV] / 2)
      })
    }

    const members = [...specs.values()]
    const label = `X${xi + 1}`
    members.forEach((m, i) => (m.label = `${label}-${String.fromCharCode(97 + i)}`))
    const idxByKey = new Map([...specs.keys()].map((k, idx) => [k, idx]))
    const edgeMemberIdx = outerEdgeKeys.map((k) => idxByKey.get(k)!)

    return {
      label,
      panelCount: 1,
      sides: outerGeom.pts2D.length,
      members,
      outline: outerGeom.pts2D,
      cornerAnglesDeg: outerGeom.corners,
      edgeMemberIdx,
      holes: holeGeoms.length > 0 ? holeGeoms.map((hg) => hg.pts2D) : undefined,
      siteFit: true,
    }
  })

  const types: FrameType[] = [...fTypes, ...xTypes]

  // ---- Seams + bolts: surviving-overlap of the two adjoining panels' material ----
  const faceToUnit = new Map<number, number>()
  unitsAll.forEach((u, i) => u.faceIds.forEach((f) => faceToUnit.set(f, i)))

  /** Union of param intervals [0,1] along (edgeA→edgeB) where this clip's
   * material still covers the segment — i.e. the non-cut loop edges lying
   * on that exact line, within range. */
  const survivingIntervals = (
    clip: ClippedPanel,
    edgeA: Vec3,
    edgeB: Vec3,
    eps: number,
  ): [number, number][] => {
    const dx = edgeB[0] - edgeA[0]
    const dy = edgeB[1] - edgeA[1]
    const dz = edgeB[2] - edgeA[2]
    const segLenSq = dx * dx + dy * dy + dz * dz || 1
    const paramAndDist = (p: Vec3) => {
      const t = ((p[0] - edgeA[0]) * dx + (p[1] - edgeA[1]) * dy + (p[2] - edgeA[2]) * dz) / segLenSq
      const cx = edgeA[0] + t * dx
      const cy = edgeA[1] + t * dy
      const cz = edgeA[2] + t * dz
      return { t, dist: Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) }
    }
    const raw: [number, number][] = []
    for (const loop of clip.loops) {
      const nV = loop.pts.length
      for (let k = 0; k < nV; k++) {
        if (loop.cut[k]) continue
        const a = loop.pts[k]
        const b = loop.pts[(k + 1) % nV]
        const pa = paramAndDist(a)
        const pb = paramAndDist(b)
        if (pa.dist > eps || pb.dist > eps) continue
        if (pa.t < -1e-6 || pa.t > 1 + 1e-6 || pb.t < -1e-6 || pb.t > 1 + 1e-6) continue
        const lo = Math.max(0, Math.min(pa.t, pb.t))
        const hi = Math.min(1, Math.max(pa.t, pb.t))
        if (hi > lo) raw.push([lo, hi])
      }
    }
    if (raw.length === 0) return []
    raw.sort((x, y) => x[0] - y[0])
    const merged: [number, number][] = [[raw[0][0], raw[0][1]]]
    for (let i = 1; i < raw.length; i++) {
      const last = merged[merged.length - 1]
      if (raw[i][0] <= last[1] + 1e-9) last[1] = Math.max(last[1], raw[i][1])
      else merged.push([raw[i][0], raw[i][1]])
    }
    return merged
  }

  const intervalOverlapFrac = (a: [number, number][], b: [number, number][]): number => {
    let total = 0
    for (const [a0, a1] of a) {
      for (const [b0, b1] of b) {
        const lo = Math.max(a0, b0)
        const hi = Math.min(a1, b1)
        if (hi > lo) total += hi - lo
      }
    }
    return total
  }

  const spacing = units === 'imperial' ? 16 : 400
  let seamCount = 0
  let totalSeamLength = 0
  let boltCount = 0
  for (const e of model.edges) {
    if (e.faceIds.length !== 2) continue
    const u0 = faceToUnit.get(e.faceIds[0])
    const u1 = faceToUnit.get(e.faceIds[1])
    if (u0 === undefined || u1 === undefined) continue
    const c0 = clips[u0]
    const c1 = clips[u1]
    if (!c0 || !c1 || c0.status === 'removed' || c1.status === 'removed') continue
    const a = P(e.v0)
    const b = P(e.v1)
    const eps0 = 1e-6 * unitDiameter(u0)
    const eps1 = 1e-6 * unitDiameter(u1)
    const i0 = survivingIntervals(c0, a, b, eps0)
    const i1 = survivingIntervals(c1, a, b, eps1)
    const overlapFrac = intervalOverlapFrac(i0, i1)
    if (overlapFrac <= 0) continue
    const edgeLen = e.chordFactor * radius
    const len = overlapFrac * edgeLen
    if (len <= 1e-6) continue
    seamCount++
    totalSeamLength += len
    boltCount += Math.max(2, Math.ceil(len / spacing))
  }

  return {
    types,
    totalPanels: clips.length - omittedPanels,
    totalMembers: types.reduce(
      (s, t) => s + t.panelCount * (t.sides + (t.holes ?? []).reduce((hs, h) => hs + h.length, 0)),
      0,
    ),
    seamCount,
    totalSeamLength,
    boltCount,
    omittedPanels,
  }
}
