import type { DomeModel } from './types'
import { cross, sub } from './vec'

export type OpeningType = 'window' | 'door' | 'vent'

/** Sparse face assignment: faceId -> opening type. */
export type OpeningAssignments = Record<number, OpeningType>

export interface OpeningGroup {
  /** W1, D1, V2, ... numbered per type in discovery order. */
  label: string
  type: OpeningType
  faceIds: number[]
  /** True panel area at the given radius (working units squared). */
  area: number
  /** Total length of the group's boundary edges (working units). */
  perimeter: number
  /** Edges fully inside the group (both faces assigned to it). A real build
   * cuts these struts out and frames the opening — they are still counted
   * in the cut list so the frame material is on hand. */
  interiorEdgeIds: number[]
  /** Interior struts summarized as "2× E, 1× F". */
  interiorSummary: string
  /** Boundary strut labels around the opening, for the frame/buck. */
  perimeterSummary: string
  /** True when the opening includes a face touching the base ring —
   * a door that doesn't reach the base needs a landing. */
  reachesBase: boolean
}

const TYPE_PREFIX: Record<OpeningType, string> = { window: 'W', door: 'D', vent: 'V' }

function summarize(model: DomeModel, edgeIds: number[]): string {
  const tally = new Map<string, number>()
  for (const eid of edgeIds) {
    const label = model.strutTypes[model.edges[eid].typeId].label
    tally.set(label, (tally.get(label) ?? 0) + 1)
  }
  return [...tally.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, n]) => `${n}× ${label}`)
    .join(', ')
}

/**
 * Merge same-type assigned faces into connected opening groups (adjacency via
 * shared edges) and compute the fabrication data for each.
 */
export function analyzeOpenings(
  model: DomeModel,
  assignments: OpeningAssignments,
  radius: number,
): OpeningGroup[] {
  const groups: OpeningGroup[] = []
  const counters: Record<OpeningType, number> = { window: 0, door: 0, vent: 0 }
  const visited = new Set<number>()

  const faceArea = (faceId: number): number => {
    const [a, b, c] = model.faces[faceId].vertexIds.map((vi) => model.vertices[vi].position)
    const n = cross(sub(b, a), sub(c, a))
    return 0.5 * Math.hypot(n[0], n[1], n[2]) * radius * radius
  }

  for (const idStr of Object.keys(assignments)) {
    const seed = Number(idStr)
    if (visited.has(seed) || !model.faces[seed]) continue
    const type = assignments[seed]

    // Flood fill across neighbors sharing the same opening type.
    const faceIds: number[] = []
    const stack = [seed]
    visited.add(seed)
    while (stack.length > 0) {
      const fid = stack.pop()!
      faceIds.push(fid)
      for (const nid of model.faces[fid].neighborIds) {
        if (!visited.has(nid) && assignments[nid] === type) {
          visited.add(nid)
          stack.push(nid)
        }
      }
    }

    const inGroup = new Set(faceIds)
    const interiorEdgeIds: number[] = []
    const perimeterEdgeIds: number[] = []
    const seenEdges = new Set<number>()
    for (const fid of faceIds) {
      for (const eid of model.faces[fid].edgeIds) {
        if (seenEdges.has(eid)) continue
        seenEdges.add(eid)
        const e = model.edges[eid]
        const facesInGroup = e.faceIds.filter((f) => inGroup.has(f)).length
        if (facesInGroup === 2) interiorEdgeIds.push(eid)
        else perimeterEdgeIds.push(eid)
      }
    }

    counters[type]++
    groups.push({
      label: `${TYPE_PREFIX[type]}${counters[type]}`,
      type,
      faceIds: faceIds.sort((a, b) => a - b),
      area: faceIds.reduce((s, fid) => s + faceArea(fid), 0),
      perimeter: perimeterEdgeIds.reduce((s, eid) => s + model.edges[eid].chordFactor * radius, 0),
      interiorEdgeIds,
      interiorSummary: summarize(model, interiorEdgeIds),
      perimeterSummary: summarize(model, perimeterEdgeIds),
      reachesBase: faceIds.some((fid) =>
        model.faces[fid].vertexIds.some((vi) => model.vertices[vi].isBase),
      ),
    })
  }

  // Stable order: doors, windows, vents; then by label.
  const order: Record<OpeningType, number> = { door: 0, window: 1, vent: 2 }
  return groups.sort((a, b) => order[a.type] - order[b.type] || a.label.localeCompare(b.label))
}
