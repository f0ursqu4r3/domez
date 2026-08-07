import type { DomeModel, Vec3 } from './types'

/** A parametric doorway standing on the base plane. Working units. */
export interface DoorSpec {
  /** Label, e.g. D1. */
  id: string
  /** Position around the base ring, degrees (0 = +x). */
  azimuthDeg: number
  /** Rough opening width. */
  width: number
  /** Rough opening height above the base plane. */
  height: number
}

/** A strut interrupted by a doorway: the surviving piece lands on the buck. */
export interface TrimmedStrut {
  edgeId: number
  typeId: number
  doorId: string
  /** Piece length, working units. */
  length: number
  /** Piece endpoints on the unit sphere scale (world = unit × radius). */
  aUnit: Vec3
  bUnit: Vec3
}

export interface DoorFrameInfo extends DoorSpec {
  /** Vertical buck members, one per side (cut length = height). */
  jambLength: number
  /** Horizontal header member (rough-opening span; add your framing allowances). */
  headerLength: number
  /** Distance of the vertical buck plane from the dome axis. */
  framePlaneDist: number
  /** How far the buck plane sits inside the base ring at the door center. */
  tunnelDepth: number
  /** False when the rectangle does not fit inside the shell (too tall/wide). */
  fits: boolean
  removedStrutCount: number
  trimmedStrutCount: number
  removedHubCount: number
  removedPanelCount: number
  /** Door slab area, width × height. */
  area: number
  /** Closure ("extruded entry") sheathing that seals the shell back to the
   * buck: two vertical side walls and a flat top, from the buck plane out
   * to the sphere surface. Working units². Zero when the door doesn't fit. */
  closureSideArea: number
  closureTopArea: number
  /** Stick framing for the closure, cut-list ready. `at` locates the piece:
   * studs/plates by radial distance from the axis (side walls), top blocking
   * by tangential offset from the door centerline. */
  closureFraming: ClosureMember[]
}

export interface ClosureMember {
  part: 'wall plate' | 'wall stud' | 'top blocking'
  /** Cut length, working units. */
  length: number
  quantity: number
  /** Position: radial distance (plate start / stud center) or tangential
   * offset (top blocking), working units. */
  at: number
}

export interface DoorwayCut {
  doors: DoorFrameInfo[]
  removedEdges: Set<number>
  /** Edges replaced by shorter pieces (also absent from the normal count). */
  trimmedEdges: Set<number>
  trimmed: TrimmedStrut[]
  removedFaces: Set<number>
  removedVertices: Set<number>
}

export interface DoorwayOptions {
  /** Trimmed pieces shorter than this are scrap and count as removed. */
  minStubLength: number
  /** Closure framing stud spacing (16″ / 400 mm o.c.). 0 or omitted skips
   * closure framing entirely (e.g. when the closure is toggled off). */
  studSpacing?: number
}

export function emptyDoorwayCut(): DoorwayCut {
  return {
    doors: [],
    removedEdges: new Set(),
    trimmedEdges: new Set(),
    trimmed: [],
    removedFaces: new Set(),
    removedVertices: new Set(),
  }
}

export interface PlacementStats {
  trimmed: number
  removed: number
  hubsRemoved: number
  /** Count of distinct trimmed cut lengths (custom cuts to make). */
  distinctTrims: number
  /** Trimmed pieces shorter than twice the scrap floor — fussy stubs. */
  shortPieces: number
  score: number
}

export interface DoorPlacementResult {
  fromAzimuthDeg: number
  azimuthDeg: number
  before: PlacementStats
  after: PlacementStats
  improved: boolean
  evaluated: number
}

export interface PlacementOptions extends DoorwayOptions {
  /** Search window each side of the current bearing. 36° covers the full
   * unique pattern of an icosahedral dome (72° period × mirror). */
  searchHalfWidthDeg?: number
  stepDeg?: number
  /** Rounding increment used to group trimmed lengths into distinct cuts. */
  increment: number
  /** Other doors to keep clear of. */
  otherDoors?: DoorSpec[]
}

interface DoorFrame {
  spec: DoorSpec
  /** Radial horizontal unit vector at the azimuth. */
  ux: number
  uy: number
  /** Base plane height, working units (cutZ × radius). */
  z0: number
  halfWidth: number
  height: number
}

/** Interval [s0, s1] of a segment inside the door passage, or null. The
 * passage is the door rectangle extruded radially through the shell:
 * |tangential| ≤ w/2, base ≤ z ≤ base + h, on the door's side of the axis. */
function insideInterval(frame: DoorFrame, a: Vec3, b: Vec3): [number, number] | null {
  let s0 = 0
  let s1 = 1
  const clip = (fa: number, fb: number, lo: number, hi: number): boolean => {
    // f(s) = fa + s (fb - fa) must lie within [lo, hi]
    const d = fb - fa
    if (Math.abs(d) < 1e-12) {
      return fa >= lo && fa <= hi
    }
    let t0 = (lo - fa) / d
    let t1 = (hi - fa) / d
    if (t0 > t1) [t0, t1] = [t1, t0]
    s0 = Math.max(s0, t0)
    s1 = Math.min(s1, t1)
    return s1 > s0
  }
  const tA = -frame.uy * a[0] + frame.ux * a[1]
  const tB = -frame.uy * b[0] + frame.ux * b[1]
  if (!clip(tA, tB, -frame.halfWidth, frame.halfWidth)) return null
  const zA = a[2] - frame.z0
  const zB = b[2] - frame.z0
  if (!clip(zA, zB, -1e9, frame.height)) return null
  const uA = frame.ux * a[0] + frame.uy * a[1]
  const uB = frame.ux * b[0] + frame.uy * b[1]
  if (!clip(uA, uB, 0, 1e12)) return null
  return s1 - s0 > 1e-9 ? [s0, s1] : null
}

function insidePoint(frame: DoorFrame, p: Vec3): boolean {
  const t = -frame.uy * p[0] + frame.ux * p[1]
  const z = p[2] - frame.z0
  const u = frame.ux * p[0] + frame.uy * p[1]
  return Math.abs(t) <= frame.halfWidth && z <= frame.height && u >= 0
}

const lerp3 = (a: Vec3, b: Vec3, s: number): Vec3 => [
  a[0] + (b[0] - a[0]) * s,
  a[1] + (b[1] - a[1]) * s,
  a[2] + (b[2] - a[2]) * s,
]

/**
 * Cut parametric doorways into the dome. Struts crossing a doorway are
 * trimmed back to the passage boundary (the surviving piece runs from its
 * hub to the buck); struts and panels fully inside are removed. The buck
 * itself (2 jambs + header) is reported per door for the cut list.
 */
export function cutDoorways(
  model: DomeModel,
  doors: DoorSpec[],
  radius: number,
  opts: DoorwayOptions,
): DoorwayCut {
  const result = emptyDoorwayCut()
  if (doors.length === 0) return result

  const z0 = model.cutZ * radius
  const frames: DoorFrame[] = doors.map((spec) => {
    const az = (spec.azimuthDeg * Math.PI) / 180
    return {
      spec,
      ux: Math.cos(az),
      uy: Math.sin(az),
      z0,
      halfWidth: spec.width / 2,
      height: spec.height,
    }
  })

  const perDoor = new Map<string, DoorFrameInfo>()
  const rBase = Math.sqrt(Math.max(0, radius * radius - z0 * z0))

  // Simpson integration of max(0, f(x)) over [a, b].
  const integrate = (f: (x: number) => number, a: number, b: number): number => {
    const n = 32
    const h = (b - a) / n
    let sum = Math.max(0, f(a)) + Math.max(0, f(b))
    for (let i = 1; i < n; i++) sum += Math.max(0, f(a + i * h)) * (i % 2 === 0 ? 2 : 4)
    return (sum * h) / 3
  }

  for (const spec of doors) {
    const zTop = z0 + spec.height
    const halfW = spec.width / 2
    const fitSq = radius * radius - zTop * zTop - halfW * halfW
    const fits = fitSq > 0
    const framePlaneDist = fits ? Math.sqrt(fitSq) : 0
    // Extruded-entry closure: wall depth from the buck plane to the sphere.
    const wallDepth = (z: number) =>
      Math.sqrt(Math.max(0, radius * radius - z * z - halfW * halfW)) - framePlaneDist
    const topDepth = (t: number) =>
      Math.sqrt(Math.max(0, radius * radius - zTop * zTop - t * t)) - framePlaneDist

    // Closure stick framing. Side walls live in the plane t = ±w/2 where the
    // shell traces the circle u² + z² = R'², R' = sqrt(R² − (w/2)²).
    const closureFraming: ClosureMember[] = []
    const spacing = opts.studSpacing ?? 0
    if (fits && spacing > 0) {
      const rPrimeSq = radius * radius - halfW * halfW
      const uMax = Math.sqrt(Math.max(0, rPrimeSq - z0 * z0))
      const plateLen = uMax - framePlaneDist
      if (plateLen >= opts.minStubLength) {
        closureFraming.push({ part: 'wall plate', length: plateLen, quantity: 2, at: framePlaneDist })
      }
      for (let u = framePlaneDist + spacing; u < uMax; u += spacing) {
        const studLen = Math.sqrt(Math.max(0, rPrimeSq - u * u)) - z0
        if (studLen < opts.minStubLength) break
        closureFraming.push({ part: 'wall stud', length: studLen, quantity: 2, at: u })
      }
      for (let t = -halfW + spacing; t < halfW - 1e-9; t += spacing) {
        const len = topDepth(t)
        if (len >= opts.minStubLength) {
          closureFraming.push({ part: 'top blocking', length: len, quantity: 1, at: t })
        }
      }
    }

    perDoor.set(spec.id, {
      ...spec,
      jambLength: spec.height,
      headerLength: spec.width,
      framePlaneDist,
      tunnelDepth: Math.max(0, rBase - framePlaneDist),
      fits,
      removedStrutCount: 0,
      trimmedStrutCount: 0,
      removedHubCount: 0,
      removedPanelCount: 0,
      area: spec.width * spec.height,
      closureSideArea: fits ? 2 * integrate(wallDepth, z0, zTop) : 0,
      closureTopArea: fits ? integrate(topDepth, -halfW, halfW) : 0,
      closureFraming,
    })
  }

  // ---- Struts: clip each edge against every door passage ----
  for (const e of model.edges) {
    const a: Vec3 = [
      model.vertices[e.v0].position[0] * radius,
      model.vertices[e.v0].position[1] * radius,
      model.vertices[e.v0].position[2] * radius,
    ]
    const b: Vec3 = [
      model.vertices[e.v1].position[0] * radius,
      model.vertices[e.v1].position[1] * radius,
      model.vertices[e.v1].position[2] * radius,
    ]
    // Union of inside intervals across doors (doors rarely overlap).
    const intervals: [number, number, string][] = []
    for (const frame of frames) {
      const hit = insideInterval(frame, a, b)
      if (hit) intervals.push([hit[0], hit[1], frame.spec.id])
    }
    if (intervals.length === 0) continue
    intervals.sort((x, y) => x[0] - y[0])
    const merged: [number, number, string][] = []
    for (const iv of intervals) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1])
      else merged.push([...iv] as [number, number, string])
    }
    const doorId = merged[0][2]
    const info = perDoor.get(doorId)!

    // Outside pieces = complement of merged intervals within [0, 1].
    const pieces: [number, number][] = []
    let cursor = 0
    for (const [i0, i1] of merged) {
      if (i0 > cursor + 1e-9) pieces.push([cursor, i0])
      cursor = Math.max(cursor, i1)
    }
    if (cursor < 1 - 1e-9) pieces.push([cursor, 1])

    const edgeLength = e.chordFactor * radius
    const keptPieces = pieces.filter(([p0, p1]) => (p1 - p0) * edgeLength >= opts.minStubLength)
    if (keptPieces.length === 0) {
      result.removedEdges.add(e.id)
      info.removedStrutCount++
      continue
    }
    result.trimmedEdges.add(e.id)
    info.trimmedStrutCount += keptPieces.length
    for (const [p0, p1] of keptPieces) {
      result.trimmed.push({
        edgeId: e.id,
        typeId: e.typeId,
        doorId,
        length: (p1 - p0) * edgeLength,
        aUnit: lerp3(model.vertices[e.v0].position, model.vertices[e.v1].position, p0),
        bUnit: lerp3(model.vertices[e.v0].position, model.vertices[e.v1].position, p1),
      })
    }
  }

  // ---- Vertices fully inside a passage ----
  for (const v of model.vertices) {
    const p: Vec3 = [v.position[0] * radius, v.position[1] * radius, v.position[2] * radius]
    for (const frame of frames) {
      if (insidePoint(frame, p)) {
        result.removedVertices.add(v.id)
        perDoor.get(frame.spec.id)!.removedHubCount++
        break
      }
    }
  }

  // ---- Panels: any sampled point inside → the panel is part of the opening ----
  for (const f of model.faces) {
    const pts = f.vertexIds.map(
      (vi): Vec3 => [
        model.vertices[vi].position[0] * radius,
        model.vertices[vi].position[1] * radius,
        model.vertices[vi].position[2] * radius,
      ],
    )
    const samples: Vec3[] = [
      ...pts,
      lerp3(pts[0], pts[1], 0.5),
      lerp3(pts[1], pts[2], 0.5),
      lerp3(pts[2], pts[0], 0.5),
      [
        (pts[0][0] + pts[1][0] + pts[2][0]) / 3,
        (pts[0][1] + pts[1][1] + pts[2][1]) / 3,
        (pts[0][2] + pts[1][2] + pts[2][2]) / 3,
      ],
    ]
    outer: for (const frame of frames) {
      for (const p of samples) {
        if (insidePoint(frame, p)) {
          result.removedFaces.add(f.id)
          perDoor.get(frame.spec.id)!.removedPanelCount++
          break outer
        }
      }
    }
  }

  result.doors = doors.map((d) => perDoor.get(d.id)!)
  return result
}

/** Score a single door placement: lower = cleaner. Hubs inside the passage
 * are the worst offense; trims and distinct custom lengths are the mess a
 * builder feels; removing whole struts is largely what a door SHOULD do. */
function placementStats(
  model: DomeModel,
  spec: DoorSpec,
  radius: number,
  opts: PlacementOptions,
): PlacementStats {
  const cut = cutDoorways(model, [spec], radius, { minStubLength: opts.minStubLength })
  const info = cut.doors[0]
  const distinct = new Set(
    cut.trimmed.map((t) => Math.round(t.length / Math.max(opts.increment, 1e-9))),
  )
  const shortLimit = opts.minStubLength * 2
  const shortPieces = cut.trimmed.filter((t) => t.length < shortLimit).length
  const stats: PlacementStats = {
    trimmed: info.trimmedStrutCount,
    removed: info.removedStrutCount,
    hubsRemoved: info.removedHubCount,
    distinctTrims: distinct.size,
    shortPieces,
    score: 0,
  }
  stats.score =
    stats.hubsRemoved * 10 +
    stats.trimmed * 3 +
    stats.distinctTrims * 2 +
    stats.shortPieces * 2 +
    stats.removed * 0.25
  return stats
}

/**
 * Find the bearing near the door's current position where the doorway meets
 * the frame most cleanly. Ties resolve to the bearing closest to where the
 * user put the door.
 */
export function optimizeDoorPlacement(
  model: DomeModel,
  spec: DoorSpec,
  radius: number,
  opts: PlacementOptions,
): DoorPlacementResult {
  const halfWidth = opts.searchHalfWidthDeg ?? 36
  const step = opts.stepDeg ?? 0.25
  const before = placementStats(model, spec, radius, opts)

  // Keep clear of other doors: candidate centers must stay outside the
  // combined angular half-widths (plus a small margin) of every other door.
  const rBase = Math.sqrt(Math.max(0, 1 - model.cutZ * model.cutZ)) * radius
  const clearanceDeg = (otherWidth: number) =>
    ((Math.asin(Math.min(1, (spec.width / 2 + otherWidth / 2) / rBase)) * 180) / Math.PI) + 5
  const blocked = (az: number) =>
    (opts.otherDoors ?? []).some((d) => {
      let delta = Math.abs(az - d.azimuthDeg) % 360
      if (delta > 180) delta = 360 - delta
      return delta < clearanceDeg(d.width)
    })

  let best = { azimuthDeg: spec.azimuthDeg, stats: before, distance: 0 }
  let evaluated = 1
  const n = Math.round(halfWidth / step)
  for (let i = -n; i <= n; i++) {
    if (i === 0) continue
    const az = (((spec.azimuthDeg + i * step) % 360) + 360) % 360
    if (blocked(az)) continue
    const stats = placementStats(model, { ...spec, azimuthDeg: az }, radius, opts)
    evaluated++
    const distance = Math.abs(i * step)
    if (
      stats.score < best.stats.score - 1e-9 ||
      (Math.abs(stats.score - best.stats.score) <= 1e-9 && distance < best.distance)
    ) {
      best = { azimuthDeg: az, stats, distance }
    }
  }

  return {
    fromAzimuthDeg: spec.azimuthDeg,
    azimuthDeg: Math.round(best.azimuthDeg * 4) / 4,
    before,
    after: best.stats,
    improved: best.stats.score < before.score - 1e-9,
    evaluated,
  }
}
