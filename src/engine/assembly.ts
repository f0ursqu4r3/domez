import type { DomeModel } from './types'

export interface AssemblyCourse {
  /** 0 = base ring, counting upward to the apex. */
  index: number
  /** Mean height of the course's hubs, unit sphere. */
  meanZ: number
  hubIds: number[]
  /** Struts lying within this course (both ends in it). */
  ringStrutIds: number[]
  /** Struts rising from the previous course into this one. */
  riserStrutIds: number[]
  /** Strut type label -> count needed for this course. */
  strutTally: Record<string, number>
}

export interface AssemblyPlan {
  courses: AssemblyCourse[]
  /** One label per hub: "V12 · H3 · A A B B C C". */
  hubLabels: { vertexId: number; hubLabel: string; pattern: string; course: number }[]
}

const COURSE_TOL = 0.02

/**
 * Bottom-up assembly plan. Hubs cluster into horizontal courses (nearby
 * z-levels merge, so a staggered 3V base counts as one course). Each course
 * lists its ring struts and the risers connecting it to the course below —
 * the order a crew actually raises a dome.
 */
export function buildAssemblyPlan(model: DomeModel): AssemblyPlan {
  // Cluster vertex z's into courses.
  const zs = model.vertices.map((v) => ({ id: v.id, z: v.position[2] }))
  zs.sort((a, b) => a.z - b.z)
  const courses: AssemblyCourse[] = []
  for (const { id, z } of zs) {
    const current = courses[courses.length - 1]
    if (current && z - current.meanZ < COURSE_TOL * 2) {
      current.hubIds.push(id)
      current.meanZ += (z - current.meanZ) / current.hubIds.length
    } else {
      courses.push({
        index: courses.length,
        meanZ: z,
        hubIds: [id],
        ringStrutIds: [],
        riserStrutIds: [],
        strutTally: {},
      })
    }
  }
  const courseOf = new Map<number, number>()
  courses.forEach((c) => c.hubIds.forEach((h) => courseOf.set(h, c.index)))

  for (const e of model.edges) {
    const c0 = courseOf.get(e.v0)!
    const c1 = courseOf.get(e.v1)!
    const upper = Math.max(c0, c1)
    const label = model.strutTypes[e.typeId].label
    const course = courses[upper]
    if (c0 === c1) course.ringStrutIds.push(e.id)
    else course.riserStrutIds.push(e.id)
    course.strutTally[label] = (course.strutTally[label] ?? 0) + 1
  }

  const hubLabels = model.vertices
    .map((v) => {
      const hub = model.hubTypes[v.hubTypeId]
      return {
        vertexId: v.id,
        hubLabel: hub.label,
        pattern: hub.pattern.replaceAll('-', ' '),
        course: courseOf.get(v.id)!,
      }
    })
    .sort((a, b) => a.course - b.course || a.vertexId - b.vertexId)

  return { courses, hubLabels }
}
