import type { DomeModel, Edge, Face, Frequency, Vertex } from './types'
import { classifyModel } from './classify'
import { distance } from './vec'

/** A zome: the top portion of a polar zonohedron. Every edge is a translate
 * of one of n equal generator vectors, so every strut is the same length. */
export interface ZomeParams {
  /** Number of generators / segments around the axis, 4..16. */
  sides: number
  /** Generator angle off the dome axis, degrees, 20..70. Low = tall bullet,
   * high = squat onion. */
  pitchDeg: number
  /** Rhombus bands kept from the apex down, 1..sides−2. */
  rows: number
  /** natural = the mathematically pure zigzag rim (one strut type);
   * leveled = the zigzag notches filled with half-rhombus triangles plus
   * horizontal base chords (flat planar ring, one extra strut type). */
  baseMode: 'natural' | 'leveled'
}

/**
 * Generate a zome as a standard DomeModel: each rhombus becomes two
 * triangles in `faces` (split along its vertical diagonal), while `edges`
 * holds only real zonohedron edges (no diagonals) — the classifier then
 * yields a single strut type (two when leveled). Rows are planar; the model
 * is normalized so the widest kept row has unit radius, with that row at
 * z = 0 (mirroring the geodesic equator convention).
 */
export function generateZome(params: ZomeParams): DomeModel {
  const n = Math.max(4, Math.min(16, Math.round(params.sides)))
  const rows = Math.max(1, Math.min(n - 2, Math.round(params.rows)))
  const theta = (Math.max(20, Math.min(70, params.pitchDeg)) * Math.PI) / 180
  const leveled = params.baseMode === 'leveled'

  // Generators point down-and-out from the apex.
  const g: [number, number, number][] = Array.from({ length: n }, (_, i) => {
    const phi = (2 * Math.PI * i) / n
    return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), -Math.cos(theta)]
  })

  // v(k, i) = g_i + ... + g_{i+k-1}; apex v(0) at the origin. Row k is
  // planar at z = -k cos(theta) by symmetry.
  const vid = new Map<string, number>()
  const raw: [number, number, number][] = []
  const V = (k: number, i: number): number => {
    const ii = ((i % n) + n) % n
    const key = k === 0 ? '0' : `${k}:${ii}`
    let id = vid.get(key)
    if (id === undefined) {
      let x = 0
      let y = 0
      let z = 0
      for (let j = 0; j < k; j++) {
        const gv = g[(ii + j) % n]
        x += gv[0]
        y += gv[1]
        z += gv[2]
      }
      id = raw.length
      vid.set(key, id)
      raw.push([x, y, z])
    }
    return id
  }

  // Rhombus band k (1..rows): corners T=v(k−1,i+1), A=v(k,i), Btm=v(k+1,i),
  // B=v(k,i+1). Split along the vertical diagonal T–Btm.
  const rhombi: { vertexIds: [number, number, number, number]; faceIds: [number, number] }[] = []
  const triangles: [number, number, number][] = []
  const realPairs: [number, number][] = []
  for (let k = 1; k <= rows; k++) {
    for (let i = 0; i < n; i++) {
      const T = V(k - 1, i + 1)
      const A = V(k, i)
      const Btm = V(k + 1, i)
      const B = V(k, i + 1)
      const f0 = triangles.length
      triangles.push([T, A, Btm], [T, Btm, B])
      rhombi.push({ vertexIds: [T, A, Btm, B], faceIds: [f0, f0 + 1] })
      realPairs.push([T, A], [A, Btm], [Btm, B], [B, T])
    }
  }
  if (leveled) {
    // Fill each zigzag notch with the top half of band rows+1: the slanted
    // edges already exist as band-`rows` lower edges; only the horizontal
    // base chord is new.
    for (let i = 0; i < n; i++) {
      const T = V(rows, i + 1)
      const A = V(rows + 1, i)
      const B = V(rows + 1, i + 1)
      triangles.push([T, A, B])
      realPairs.push([A, B])
    }
  }

  // ---- Normalize: widest row to unit radius, that row at z = 0 ----
  const rowZ = new Map<number, number>() // rounded z -> max horizontal radius
  for (const [x, y, z] of raw) {
    const key = Math.round(z * 1e9)
    rowZ.set(key, Math.max(rowZ.get(key) ?? 0, Math.hypot(x, y)))
  }
  let widestR = 0
  let widestZ = 0
  for (const [key, r] of rowZ) {
    if (r > widestR + 1e-12) {
      widestR = r
      widestZ = key / 1e9
    }
  }
  const scale = 1 / widestR

  const vertices: Vertex[] = raw.map(([x, y, z], id) => ({
    id,
    position: [x * scale, y * scale, (z - widestZ) * scale] as const,
    edgeIds: [],
    hubTypeId: -1,
    isBase: false,
  }))

  // ---- Edges: dedupe real zonohedron pairs ----
  const edgeIndex = new Map<string, number>()
  const edges: Edge[] = []
  const edgeBetween = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    let id = edgeIndex.get(key)
    if (id === undefined) {
      id = edges.length
      edgeIndex.set(key, id)
      edges.push({
        id,
        v0: Math.min(a, b),
        v1: Math.max(a, b),
        chordFactor: 0,
        typeId: -1,
        faceIds: [],
        dihedralDeg: NaN,
      })
      vertices[a].edgeIds.push(id)
      vertices[b].edgeIds.push(id)
    }
    return id
  }
  for (const [a, b] of realPairs) edgeBetween(a, b)

  // ---- Faces: outward winding, real border edges only ----
  const zLowRaw = Math.min(...vertices.map((v) => v.position[2]))
  const zHighRaw = Math.max(...vertices.map((v) => v.position[2]))
  const center: [number, number, number] = [0, 0, (zLowRaw + zHighRaw) / 2]
  const faces: Face[] = []
  for (const tri of triangles) {
    const [a, b, c] = tri.map((vi) => vertices[vi].position)
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nrm = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    const cen = [
      (a[0] + b[0] + c[0]) / 3 - center[0],
      (a[1] + b[1] + c[1]) / 3 - center[1],
      (a[2] + b[2] + c[2]) / 3 - center[2],
    ]
    const vertexIds: [number, number, number] =
      nrm[0] * cen[0] + nrm[1] * cen[1] + nrm[2] * cen[2] < 0
        ? [tri[0], tri[2], tri[1]]
        : [tri[0], tri[1], tri[2]]
    const id = faces.length
    const face: Face = { id, vertexIds, neighborIds: [], edgeIds: [] }
    // Only real zonohedron edges join edgeIds — a rhombus half carries 2,
    // a leveled half-rhombus triangle all 3 (its base chord is real).
    for (const [x, y] of [
      [vertexIds[0], vertexIds[1]],
      [vertexIds[1], vertexIds[2]],
      [vertexIds[2], vertexIds[0]],
    ] as const) {
      const key = x < y ? `${x}:${y}` : `${y}:${x}`
      const eid = edgeIndex.get(key)
      if (eid !== undefined) {
        face.edgeIds.push(eid)
        edges[eid].faceIds.push(id)
      }
    }
    faces.push(face)
  }

  // ---- Base flags from boundary edges, chord factors, classification ----
  for (const e of edges) {
    if (e.faceIds.length === 1) {
      vertices[e.v0].isBase = true
      vertices[e.v1].isBase = true
    }
  }
  for (const e of edges) {
    e.chordFactor = distance(vertices[e.v0].position, vertices[e.v1].position)
  }
  const { strutTypes, hubTypes } = classifyModel(vertices, edges, faces)

  const zLow = Math.min(...vertices.map((v) => v.position[2]))
  const zHigh = Math.max(...vertices.map((v) => v.position[2]))
  const baseRing = vertices.filter((v) => v.isBase)
  return {
    params: { frequency: 1 as Frequency, fraction: 'full' }, // nominal; `zome` is authoritative
    vertices,
    edges,
    faces,
    strutTypes,
    hubTypes,
    cutZ: zLow,
    actualFraction: rows / (n - 1),
    unitHeight: zHigh - zLow,
    unitBaseRadius: Math.max(...baseRing.map((v) => Math.hypot(v.position[0], v.position[1]))),
    rhombi,
    zome: { sides: n, pitchDeg: params.pitchDeg, rows, leveled },
  }
}
