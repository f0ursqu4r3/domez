import type { DomeModel, Edge, Face, Fraction, Frequency, Vertex } from './types'
import { subdivideIcosahedron } from './subdivide'
import { classifyModel } from './classify'
import { cross, distance, dot, normalize } from './vec'

/** Hex/pent (Goldberg dual) dome parameters. */
export interface GoldbergParams {
  frequency: Frequency
  fraction: Fraction
  /** natural = whole panels only (scalloped rim); leveled = straddling
   * panels clipped at the cut plane (trapezoid partials + chord edges →
   * planar base ring). */
  baseMode: 'natural' | 'leveled'
}

function targetActual(fraction: Fraction): number {
  switch (fraction) {
    case '3/8':
      return 0.375
    case '1/2':
      return 0.5
    case '5/8':
      return 0.625
    case 'full':
      return 1
  }
}

/**
 * Generate the Goldberg dual of the geodesic sphere: one dual vertex per
 * icosphere triangle (normalized centroid), one polygon per icosphere
 * vertex — 12 pentagons in a field of hexagons, every joint 3-way.
 * Polygons enter the DomeModel as triangle fans (no phantom vertices;
 * diagonals excluded from edges) with `polys` pairing metadata.
 *
 * Structural honesty: a bare hex frame is NOT rigid — panels (stressed
 * skin) or added bracing carry the shape. The UI carries this disclosure.
 */
export function generateGoldberg(params: GoldbergParams): DomeModel {
  const sphere = subdivideIcosahedron(params.frequency)
  const leveled = params.baseMode === 'leveled' && params.fraction !== 'full'

  // ---- Dual vertices: normalized face centroids (id = face index) ----
  const dualPos: [number, number, number][] = sphere.faces.map(([a, b, c]) => {
    const p: [number, number, number] = [
      (sphere.vertices[a][0] + sphere.vertices[b][0] + sphere.vertices[c][0]) / 3,
      (sphere.vertices[a][1] + sphere.vertices[b][1] + sphere.vertices[c][1]) / 3,
      (sphere.vertices[a][2] + sphere.vertices[b][2] + sphere.vertices[c][2]) / 3,
    ]
    const l = Math.hypot(p[0], p[1], p[2])
    return [p[0] / l, p[1] / l, p[2] / l]
  })

  // ---- Polygons: adjacent face centroids ordered CCW around each vertex ----
  const facesOf = new Map<number, number[]>()
  sphere.faces.forEach((f, fi) => {
    for (const vi of f) {
      if (!facesOf.has(vi)) facesOf.set(vi, [])
      facesOf.get(vi)!.push(fi)
    }
  })
  interface RawPoly {
    ownerZ: number
    /** Ring of node keys: `d<faceId>` dual verts; clipping adds `x<a>:<b>`. */
    ring: string[]
  }
  const rawPolys: RawPoly[] = []
  for (const [vi, fids] of facesOf) {
    const n = sphere.vertices[vi]
    const ref: readonly [number, number, number] = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
    const e1 = normalize(cross(n, ref))
    const e2 = cross(n, e1)
    const ring = fids
      .map((fi) => ({ fi, ang: Math.atan2(dot(dualPos[fi], e2), dot(dualPos[fi], e1)) }))
      .sort((x, y) => x.ang - y.ang)
      .map((x) => `d${x.fi}`)
    rawPolys.push({ ownerZ: n[2], ring })
  }

  const posOf = new Map<string, [number, number, number]>()
  dualPos.forEach((p, i) => posOf.set(`d${i}`, p))
  const zOf = (key: string) => posOf.get(key)![2]

  // ---- Cut selection on owner z levels ----
  let kept: RawPoly[]
  if (params.fraction === 'full') {
    kept = rawPolys
  } else {
    const Z_TOL = 1e-6
    const levels: number[] = []
    for (const p of rawPolys) {
      if (!levels.some((z) => Math.abs(z - p.ownerZ) < Z_TOL)) levels.push(p.ownerZ)
    }
    levels.sort((a, b) => b - a)
    const target = targetActual(params.fraction)
    let best: { polys: RawPoly[]; score: number } | null = null
    for (const level of levels) {
      const polys = rawPolys.filter((p) => p.ownerZ >= level - Z_TOL)
      if (polys.length === 0) continue
      let zLow = 1
      for (const p of polys) for (const k of p.ring) zLow = Math.min(zLow, zOf(k))
      const score = Math.abs((1 - zLow) / 2 - target)
      if (!best || score < best.score) best = { polys, score }
    }
    kept = best!.polys
  }

  // ---- Leveled: clip straddling polygons at the natural scallop floor ----
  if (leveled) {
    let zPlane = 1
    for (const p of kept) for (const k of p.ring) zPlane = Math.min(zPlane, zOf(k))
    // Shared intersection vertex per crossing dual edge.
    const crossings = new Map<string, string>()
    const intersect = (a: string, b: string): string => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      let id = crossings.get(key)
      if (id === undefined) {
        const pa = posOf.get(a)!
        const pb = posOf.get(b)!
        const t = (zPlane - pa[2]) / (pb[2] - pa[2])
        id = `x${key}`
        posOf.set(id, [
          pa[0] + (pb[0] - pa[0]) * t,
          pa[1] + (pb[1] - pa[1]) * t,
          zPlane,
        ])
        crossings.set(key, id)
      }
      return id
    }
    const clipped: RawPoly[] = []
    for (const p of rawPolys) {
      const zs = p.ring.map(zOf)
      if (!zs.some((z) => z > zPlane + 1e-9)) continue
      if (zs.every((z) => z >= zPlane - 1e-9)) {
        clipped.push(p)
        continue
      }
      // Sutherland–Hodgman against z ≥ zPlane.
      const out: string[] = []
      for (let i = 0; i < p.ring.length; i++) {
        const a = p.ring[i]
        const b = p.ring[(i + 1) % p.ring.length]
        const za = zOf(a)
        const zb = zOf(b)
        if (za >= zPlane - 1e-9) out.push(a)
        if ((za > zPlane + 1e-9 && zb < zPlane - 1e-9) || (za < zPlane - 1e-9 && zb > zPlane + 1e-9)) {
          out.push(intersect(a, b))
        }
      }
      if (out.length >= 3) clipped.push({ ownerZ: p.ownerZ, ring: out })
    }
    kept = clipped
  }

  // ---- Re-index nodes used by kept rings ----
  const idOf = new Map<string, number>()
  const vertices: Vertex[] = []
  for (const p of kept) {
    for (const k of p.ring) {
      if (idOf.has(k)) continue
      const id = vertices.length
      idOf.set(k, id)
      const pos = posOf.get(k)!
      vertices.push({
        id,
        position: [pos[0], pos[1], pos[2]] as const,
        edgeIds: [],
        hubTypeId: -1,
        isBase: false,
      })
    }
  }

  // ---- Edges from consecutive ring pairs ----
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
  const rings = kept.map((p) => p.ring.map((k) => idOf.get(k)!))
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) edgeBetween(ring[i], ring[(i + 1) % ring.length])
  }

  // ---- Faces: fan each polygon from its first vertex ----
  const zAll = vertices.map((v) => v.position[2])
  const centerZ = (Math.min(...zAll) + Math.max(...zAll)) / 2
  const faces: Face[] = []
  const polys: { vertexIds: number[]; faceIds: number[] }[] = []
  for (const ring of rings) {
    const faceIds: number[] = []
    for (let i = 1; i < ring.length - 1; i++) {
      const tri: [number, number, number] = [ring[0], ring[i], ring[i + 1]]
      const [a, b, c] = tri.map((vi) => vertices[vi].position)
      const nrm = cross(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      )
      const cen: [number, number, number] = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3 - centerZ,
      ]
      const vertexIds: [number, number, number] =
        dot(nrm, cen) < 0 ? [tri[0], tri[2], tri[1]] : tri
      const id = faces.length
      const face: Face = { id, vertexIds, neighborIds: [], edgeIds: [] }
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
      faceIds.push(id)
    }
    polys.push({ vertexIds: ring, faceIds })
  }

  // ---- Base flags, chords, classification ----
  if (params.fraction !== 'full') {
    for (const e of edges) {
      if (e.faceIds.length === 1) {
        vertices[e.v0].isBase = true
        vertices[e.v1].isBase = true
      }
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
    params: { frequency: params.frequency, fraction: params.fraction },
    vertices,
    edges,
    faces,
    strutTypes,
    hubTypes,
    cutZ: params.fraction === 'full' ? -1 : zLow,
    actualFraction: params.fraction === 'full' ? 1 : (1 - zLow) / 2,
    unitHeight: zHigh - zLow,
    unitBaseRadius:
      baseRing.length > 0
        ? Math.max(...baseRing.map((v) => Math.hypot(v.position[0], v.position[1])))
        : 0,
    polys,
    goldberg: { frequency: params.frequency, fraction: params.fraction, leveled },
  }
}
