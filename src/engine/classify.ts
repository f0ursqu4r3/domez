import type { Edge, Face, HubType, StrutType, Vertex } from './types'
import { strutLabel } from './dome'
import { cross, dot, normalize, sub } from './vec'

const CHORD_TOL = 1e-6

/**
 * Fill face adjacency and edge dihedrals, then classify strut types (by
 * chord factor, shortest first) and hub types (valence + surrounding strut
 * pattern + base flag). Mutates edges, faces, and vertices in place; returns
 * the type tables. Shared by the geodesic and zome generators.
 */
export function classifyModel(
  vertices: Vertex[],
  edges: Edge[],
  faces: Face[],
): { strutTypes: StrutType[]; hubTypes: HubType[] } {
  // ---- Face adjacency + dihedrals ----
  const faceNormal = (f: Face) => {
    const [a, b, c] = f.vertexIds.map((i) => vertices[i].position)
    return normalize(cross(sub(b, a), sub(c, a)))
  }
  const normals = faces.map(faceNormal)
  for (const e of edges) {
    if (e.faceIds.length === 2) {
      const [f0, f1] = e.faceIds
      faces[f0].neighborIds.push(f1)
      faces[f1].neighborIds.push(f0)
      const cosA = Math.min(1, Math.max(-1, dot(normals[f0], normals[f1])))
      e.dihedralDeg = 180 - (Math.acos(cosA) * 180) / Math.PI
    }
  }

  // ---- Strut classification by chord factor ----
  const strutTypes: StrutType[] = []
  for (const e of edges.slice().sort((x, y) => x.chordFactor - y.chordFactor)) {
    let t = strutTypes.find((s) => Math.abs(s.chordFactor - e.chordFactor) < CHORD_TOL)
    if (!t) {
      t = {
        id: strutTypes.length,
        label: strutLabel(strutTypes.length),
        chordFactor: e.chordFactor,
        count: 0,
        axialAngleDeg: 90 - (Math.asin(e.chordFactor / 2) * 180) / Math.PI,
        dihedralMinDeg: Infinity,
        dihedralMaxDeg: -Infinity,
        edgeIds: [],
      }
      strutTypes.push(t)
    }
    e.typeId = t.id
    t.count++
    t.edgeIds.push(e.id)
    if (!Number.isNaN(e.dihedralDeg)) {
      t.dihedralMinDeg = Math.min(t.dihedralMinDeg, e.dihedralDeg)
      t.dihedralMaxDeg = Math.max(t.dihedralMaxDeg, e.dihedralDeg)
    }
  }
  for (const t of strutTypes) {
    if (t.dihedralMinDeg === Infinity) {
      t.dihedralMinDeg = NaN
      t.dihedralMaxDeg = NaN
    }
  }

  // ---- Hub classification: valence + surrounding strut pattern + base flag ----
  const hubTypes: HubType[] = []
  for (const v of vertices) {
    const pattern = v.edgeIds
      .map((eid) => strutTypes[edges[eid].typeId].label)
      .sort()
      .join('-')
    let h = hubTypes.find(
      (t) => t.valence === v.edgeIds.length && t.pattern === pattern && t.isBase === v.isBase,
    )
    if (!h) {
      h = {
        id: hubTypes.length,
        label: `H${hubTypes.length + 1}`,
        valence: v.edgeIds.length,
        pattern,
        isBase: v.isBase,
        count: 0,
        vertexIds: [],
      }
      hubTypes.push(h)
    }
    v.hubTypeId = h.id
    h.count++
    h.vertexIds.push(v.id)
  }

  return { strutTypes, hubTypes }
}
