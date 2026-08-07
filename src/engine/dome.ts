import type {
  DomeModel,
  DomeParams,
  Edge,
  Face,
  Fraction,
  HubType,
  StrutType,
  Vertex,
} from './types'
import { subdivideIcosahedron } from './subdivide'
import { cross, distance, dot, normalize, sub } from './vec'

const CHORD_TOL = 1e-6
const Z_TOL = 1e-6

/** Target truncation plane z for a nominal fraction of sphere height kept. */
function targetCutZ(fraction: Fraction): number {
  switch (fraction) {
    case '3/8':
      return 0.25
    case '1/2':
      return 0
    case '5/8':
      return -0.25
    case 'full':
      return -1
  }
}

/**
 * Generate a dome model on the unit sphere from first principles.
 *
 * The icosphere is vertex-up. Projected vertices fall on discrete z-levels,
 * but a subdivision "row" can span several close levels, so truncation keeps
 * whole FACES: a face survives only when all three vertices sit at or above
 * the cut level (the vertex z-level nearest the requested fraction).
 * Vertices and edges not referenced by a surviving face are dropped.
 *
 * For odd frequencies the resulting base ring is slightly staggered in z —
 * true of real 3V/5V domes. `baseMode: 'leveled'` slides each boundary hub
 * along the sphere onto the cut plane (the "flat base" variant kit vendors
 * sell), which introduces a few extra strut types near the base.
 */
export function generateDome(params: DomeParams & { baseMode?: 'natural' | 'leveled' }): DomeModel {
  const { frequency, fraction } = params
  const baseMode = params.baseMode ?? 'natural'
  const sphere = subdivideIcosahedron(frequency)

  // Distinct z-levels, descending.
  const levels: number[] = []
  for (const v of sphere.vertices) {
    if (!levels.some((z) => Math.abs(z - v[2]) < Z_TOL)) levels.push(v[2])
  }
  levels.sort((a, b) => b - a)

  // Full-sphere edge list with face adjacency, used to score candidate cuts.
  const sphereEdges = new Map<string, { a: number; b: number; faces: number[] }>()
  sphere.faces.forEach(([a, b, c], fi) => {
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = x < y ? `${x}:${y}` : `${y}:${x}`
      let e = sphereEdges.get(key)
      if (!e) {
        e = { a: Math.min(x, y), b: Math.max(x, y), faces: [] }
        sphereEdges.set(key, e)
      }
      e.faces.push(fi)
    }
  })

  let cutZ: number
  if (fraction === 'full') {
    cutZ = -1
  } else {
    // Candidate cuts are vertex z-levels. Nearby levels can differ wildly in
    // base quality: one yields a near-flat ring, another a boundary that
    // staggers across whole sub-rows. Score = fraction miss + base z-span,
    // so conventional ring cuts (3V 4/9 & 5/9, even-frequency equator) win.
    const target = targetCutZ(fraction)
    let best = { z: levels[0], score: Infinity }
    for (const z of levels.slice(1)) {
      const keptFace = sphere.faces.map((f) => f.every((vi) => sphere.vertices[vi][2] >= z - Z_TOL))
      let boundaryMin = Infinity
      let boundaryMax = -Infinity
      let keptCount = 0
      for (const e of sphereEdges.values()) {
        const kept = e.faces.filter((fi) => keptFace[fi]).length
        if (kept > 0) keptCount++
        if (kept === 1) {
          for (const vi of [e.a, e.b]) {
            boundaryMin = Math.min(boundaryMin, sphere.vertices[vi][2])
            boundaryMax = Math.max(boundaryMax, sphere.vertices[vi][2])
          }
        }
      }
      if (keptCount === 0 || boundaryMin === Infinity) continue
      const actual = (1 - z) / 2
      const score = Math.abs(actual - (1 - target) / 2) + (boundaryMax - boundaryMin)
      if (score < best.score) best = { z, score }
    }
    cutZ = best.z
  }

  // ---- Keep whole faces above the cut ----
  const vertexKept = sphere.vertices.map((v) => v[2] >= cutZ - Z_TOL)
  const keptFaces = sphere.faces.filter(
    ([a, b, c]) => vertexKept[a] && vertexKept[b] && vertexKept[c],
  )

  // ---- Re-index vertices referenced by surviving faces ----
  const oldToNew = new Map<number, number>()
  const vertices: Vertex[] = []
  for (const face of keptFaces) {
    for (const oldId of face) {
      if (oldToNew.has(oldId)) continue
      const id = vertices.length
      oldToNew.set(oldId, id)
      vertices.push({
        id,
        position: sphere.vertices[oldId],
        edgeIds: [],
        hubTypeId: -1,
        isBase: false,
      })
    }
  }

  // ---- Faces and edges ----
  const faces: Face[] = []
  const edgeIndex = new Map<string, number>()
  const edges: Edge[] = []

  const edgeBetween = (a: number, b: number, faceId: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    let id = edgeIndex.get(key)
    if (id === undefined) {
      id = edges.length
      edgeIndex.set(key, id)
      edges.push({
        id,
        v0: Math.min(a, b),
        v1: Math.max(a, b),
        chordFactor: 0, // set after optional base leveling
        typeId: -1,
        faceIds: [],
        dihedralDeg: NaN,
      })
      vertices[a].edgeIds.push(id)
      vertices[b].edgeIds.push(id)
    }
    edges[id].faceIds.push(faceId)
    return id
  }

  for (const [a, b, c] of keptFaces) {
    const [na, nb, nc] = [oldToNew.get(a)!, oldToNew.get(b)!, oldToNew.get(c)!]
    const id = faces.length
    const face: Face = { id, vertexIds: [na, nb, nc], neighborIds: [], edgeIds: [] }
    faces.push(face)
    face.edgeIds.push(edgeBetween(na, nb, id), edgeBetween(nb, nc, id), edgeBetween(nc, na, id))
  }

  // ---- Base ring: vertices on boundary edges (single adjacent face) ----
  if (fraction !== 'full') {
    for (const e of edges) {
      if (e.faceIds.length === 1) {
        vertices[e.v0].isBase = true
        vertices[e.v1].isBase = true
      }
    }
  }

  // ---- Optional base leveling: slide boundary hubs along the sphere onto
  // the cut plane (z = cutZ, radius stays 1). ----
  if (baseMode === 'leveled' && fraction !== 'full') {
    const ringR = Math.sqrt(Math.max(0, 1 - cutZ * cutZ))
    for (const v of vertices) {
      if (!v.isBase) continue
      const [x, y] = v.position
      const r = Math.hypot(x, y)
      if (r < 1e-12) continue
      v.position = [(x / r) * ringR, (y / r) * ringR, cutZ]
    }
  }

  // ---- Chord factors (after leveling) ----
  for (const e of edges) {
    e.chordFactor = distance(vertices[e.v0].position, vertices[e.v1].position)
  }

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

  const lowestZ = fraction === 'full' ? -1 : Math.min(...vertices.map((v) => v.position[2]))
  return {
    params: { frequency, fraction },
    vertices,
    edges,
    faces,
    strutTypes,
    hubTypes,
    cutZ: fraction === 'full' ? -1 : cutZ,
    actualFraction: fraction === 'full' ? 1 : (1 - cutZ) / 2,
    unitHeight: 1 - lowestZ,
    unitBaseRadius: fraction === 'full' ? 0 : Math.sqrt(Math.max(0, 1 - cutZ * cutZ)),
  }
}

/** A, B, ..., Z, AA, AB ... */
export function strutLabel(index: number): string {
  let label = ''
  let n = index
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}
