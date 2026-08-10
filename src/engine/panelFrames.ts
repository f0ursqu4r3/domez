import type { DomeModel, UnitSystem } from './types'
import type { DoorwayCut } from './doorway'

/** One distinct member cut within a frame type. */
export interface FrameMemberSpec {
  label: string
  count: number
  longPointLength: number
  miterStartDeg: number
  miterEndDeg: number
  bevelDeg: number
  boundary: boolean
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

/**
 * Framed-panel ("double wall") takeoff: every panel becomes an independent
 * mitered/beveled frame; interior seams carry two members. Doorway-removed
 * panels are omitted — frame those openings on site.
 */
export function buildPanelFrames(
  model: DomeModel,
  radius: number,
  units: UnitSystem,
  doorway: DoorwayCut,
): PanelFramePlan {
  // ---- Panel units: outline rings + owning faces ----
  let units_: { ring: number[]; faceIds: number[] }[]
  if (model.polys) {
    units_ = model.polys.map((p) => ({ ring: [...p.vertexIds], faceIds: [...p.faceIds] }))
  } else if (model.rhombi) {
    units_ = model.rhombi.map((r) => ({ ring: [...r.vertexIds], faceIds: [...r.faceIds] }))
    const covered = new Set(model.rhombi.flatMap((r) => r.faceIds))
    for (const f of model.faces) {
      if (!covered.has(f.id)) units_.push({ ring: [...f.vertexIds], faceIds: [f.id] })
    }
  } else {
    units_ = model.faces.map((f) => ({ ring: [...f.vertexIds], faceIds: [f.id] }))
  }

  const kept = units_.filter((u) => !u.faceIds.some((fid) => doorway.removedFaces.has(fid)))
  const omittedPanels = units_.length - kept.length

  // ---- Edge lookup + leveled-base detection ----
  const edgeByKey = new Map<string, number>()
  model.edges.forEach((e) => edgeByKey.set(`${Math.min(e.v0, e.v1)}:${Math.max(e.v0, e.v1)}`, e.id))
  const baseZ = model.vertices.filter((v) => v.isBase).map((v) => v.position[2])
  const leveledBase = baseZ.length > 0 && Math.max(...baseZ) - Math.min(...baseZ) < 1e-6

  // ---- Per-panel geometry ----
  const P = (vid: number) =>
    model.vertices[vid].position.map((c) => c * radius) as unknown as [number, number, number]
  const geoms: PanelGeom[] = kept.map((u) => {
    const pts = u.ring.map(P)
    // Newell normal.
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      nx += (a[1] - b[1]) * (a[2] + b[2])
      ny += (a[2] - b[2]) * (a[0] + b[0])
      nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    const nl = Math.hypot(nx, ny, nz) || 1
    const n = [nx / nl, ny / nl, nz / nl] as const
    // In-plane basis from the first edge.
    const cen = pts
      .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
      .map((c) => c / pts.length)
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
    let ring = [...u.ring]
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
      const edge = eid !== undefined ? model.edges[eid] : undefined
      let bevel = 0
      let boundary = true
      if (edge && edge.faceIds.length === 2 && Number.isFinite(edge.dihedralDeg)) {
        bevel = (180 - edge.dihedralDeg) / 2
        boundary = false
      } else if (leveledBase) {
        bevel = Math.max(0, 90 - deg(Math.acos(Math.min(1, Math.abs(n[2])))))
      }
      return { len, bevel, boundary, edgeId: eid ?? -1 }
    })
    return { ring, outline, corners, edges }
  })

  // ---- Group by canonical cyclic signature ----
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
  const types: FrameType[] = sorted.map((grp, ti) => {
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

  // ---- Seams + bolts ----
  const keptFaces = new Set(kept.flatMap((u) => u.faceIds))
  const spacing = units === 'imperial' ? 16 : 400
  let seamCount = 0
  let totalSeamLength = 0
  let boltCount = 0
  for (const e of model.edges) {
    if (e.faceIds.length !== 2) continue
    if (doorway.removedEdges.has(e.id) || doorway.trimmedEdges.has(e.id)) continue
    if (!e.faceIds.every((f) => keptFaces.has(f))) continue
    const len = e.chordFactor * radius
    seamCount++
    totalSeamLength += len
    boltCount += Math.max(2, Math.ceil(len / spacing))
  }

  return {
    types,
    totalPanels: kept.length,
    totalMembers: types.reduce((s, t) => s + t.panelCount * t.sides, 0),
    seamCount,
    totalSeamLength,
    boltCount,
    omittedPanels,
  }
}
