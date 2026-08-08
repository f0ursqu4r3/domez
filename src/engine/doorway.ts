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
  /** Recess of the buck plane relative to the auto fit. Positive = deeper
   * entry; negative pushes the buck outward toward (or proud of) the shell,
   * clamped to the base ring radius. */
  extraDepth?: number
  /** Clearance band around the rough opening: the shell is cut back this
   * much beyond the buck outline (trim/shim zone on the face plane). */
  margin?: number
}

/** A strut interrupted by a doorway: the surviving piece lands on the
 * closure (side wall, top plane, or the face plane at the buck). */
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

export interface ClosureMember {
  part: 'wall plate' | 'wall stud' | 'top blocking'
  /** Cut length, working units. */
  length: number
  quantity: number
  /** Position: radial distance (plate start / stud center) or tangential
   * offset (top blocking), working units. */
  at: number
  /** Which side wall the piece belongs to (+1 / -1 tangential); 0 = top. */
  side: -1 | 0 | 1
}

/** Faceted closure outline, sectioned from the actual triangulated shell
 * (not the ideal sphere), in door-local coordinates. */
export interface ClosureProfile {
  /** Envelope half-width = width/2 + margin. */
  halfWidth: number
  /** Envelope top above the base plane = height + margin. */
  topHeight: number
  /** Side-wall outer edges: [radialDist, heightAboveBase][], ordered by
   * radial distance from the buck plane out to where the shell meets the
   * base. side +1 / -1 tangential. */
  wallPos: [number, number][]
  wallNeg: [number, number][]
  /** Top-plane outer edge: [tangentialOffset, radialDist][]. */
  top: [number, number][]
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
  /** Closure sheathing sealing the shell back to the buck, measured on the
   * faceted shell. Working units². Zero when the door doesn't fit. */
  closureSideArea: number
  closureTopArea: number
  /** Flat face band at the buck plane between the buck outline and the cut
   * envelope (only non-zero with margin). */
  closureFaceArea: number
  /** Stick framing for the closure, cut-list ready. */
  closureFraming: ClosureMember[]
  /** Faceted closure outline for rendering; null when the door doesn't fit. */
  closureProfile: ClosureProfile | null
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

interface DoorFrame {
  spec: DoorSpec
  /** Radial horizontal unit vector at the azimuth. */
  ux: number
  uy: number
  /** Base plane height, working units (cutZ × radius). */
  z0: number
  /** Cut envelope: buck + margin. */
  halfWidth: number
  height: number
  /** Cutting starts at the buck plane — struts behind it pass through. */
  framePlaneDist: number
}

/** Interval [s0, s1] of a segment inside the door passage, or null. The
 * passage is the cut envelope extruded radially OUTWARD from the buck plane:
 * |tangential| ≤ hw, z ≤ base + h, radial ≥ buck plane. Struts passing
 * behind the buck plane connect through untouched. */
function insideInterval(frame: DoorFrame, a: Vec3, b: Vec3): [number, number] | null {
  let s0 = 0
  let s1 = 1
  const clip = (fa: number, fb: number, lo: number, hi: number): boolean => {
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
  if (!clip(uA, uB, frame.framePlaneDist, 1e12)) return null
  return s1 - s0 > 1e-9 ? [s0, s1] : null
}

function insidePoint(frame: DoorFrame, p: Vec3): boolean {
  const t = -frame.uy * p[0] + frame.ux * p[1]
  const z = p[2] - frame.z0
  const u = frame.ux * p[0] + frame.uy * p[1]
  return Math.abs(t) <= frame.halfWidth && z <= frame.height && u >= frame.framePlaneDist
}

const lerp3 = (a: Vec3, b: Vec3, s: number): Vec3 => [
  a[0] + (b[0] - a[0]) * s,
  a[1] + (b[1] - a[1]) * s,
  a[2] + (b[2] - a[2]) * s,
]

/** All shell triangles in door-local coordinates (u radial, t tangential,
 * z absolute height). */
function localTriangles(
  model: DomeModel,
  radius: number,
  ux: number,
  uy: number,
): [number, number, number][][] {
  return model.faces.map((f) =>
    f.vertexIds.map((vi) => {
      const p = model.vertices[vi].position
      const x = p[0] * radius
      const y = p[1] * radius
      return [ux * x + uy * y, -uy * x + ux * y, p[2] * radius] as [number, number, number]
    }),
  )
}

/** Intersect triangles with the plane axis=value; return segments projected
 * to the other two coordinates [(c1a, c2a, c1b, c2b)]. axis/keep indices
 * refer to the local (u, t, z) triple. */
function sectionSegments(
  tris: [number, number, number][][],
  axis: 0 | 1 | 2,
  value: number,
  keepA: 0 | 1 | 2,
  keepB: 0 | 1 | 2,
): [number, number, number, number][] {
  const segs: [number, number, number, number][] = []
  for (const tri of tris) {
    const pts: [number, number][] = []
    for (let i = 0; i < 3; i++) {
      const p = tri[i]
      const q = tri[(i + 1) % 3]
      const fp = p[axis] - value
      const fq = q[axis] - value
      if ((fp > 0 && fq > 0) || (fp < 0 && fq < 0)) continue
      const d = fq - fp
      if (Math.abs(d) < 1e-12) continue
      const s = -fp / d
      if (s < -1e-9 || s > 1 + 1e-9) continue
      pts.push([p[keepA] + s * (q[keepA] - p[keepA]), p[keepB] + s * (q[keepB] - p[keepB])])
    }
    if (pts.length >= 2) {
      segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
    }
  }
  return segs
}

/** Upper envelope of section segments: for a coordinate x, the maximum of
 * the second coordinate across all segments spanning x. Returns breakpoints
 * (segment endpoints + uniform fill) so shell facets stay straight lines. */
function upperEnvelope(
  segs: [number, number, number, number][],
  xMin: number,
  xMax: number,
  fill: number,
): [number, number][] {
  const xs = new Set<number>([xMin, xMax])
  for (const [x1, , x2] of segs) {
    if (x1 > xMin - 1e-6 && x1 < xMax + 1e-6) xs.add(x1)
    if (x2 > xMin - 1e-6 && x2 < xMax + 1e-6) xs.add(x2)
  }
  for (let i = 1; i < fill; i++) xs.add(xMin + ((xMax - xMin) * i) / fill)
  const yAt = (x: number): number => {
    let best = -Infinity
    for (const [x1, y1, x2, y2] of segs) {
      const lo = Math.min(x1, x2)
      const hi = Math.max(x1, x2)
      if (x < lo - 1e-6 || x > hi + 1e-6) continue
      if (Math.abs(x2 - x1) < 1e-9) {
        best = Math.max(best, y1, y2)
      } else {
        best = Math.max(best, y1 + ((y2 - y1) * (x - x1)) / (x2 - x1))
      }
    }
    return best
  }
  return [...xs]
    .sort((a, b) => a - b)
    .map((x) => [x, yAt(x)] as [number, number])
    .filter(([, y]) => y > -Infinity)
}

/** Trapezoid area under a profile, with values clamped to [0, cap]. */
function profileArea(profile: [number, number][], cap: number): number {
  let area = 0
  for (let i = 1; i < profile.length; i++) {
    const y0 = Math.min(Math.max(profile[i - 1][1], 0), cap)
    const y1 = Math.min(Math.max(profile[i][1], 0), cap)
    area += ((y0 + y1) / 2) * (profile[i][0] - profile[i - 1][0])
  }
  return area
}

/** Linear interpolation on a profile. */
function profileAt(profile: [number, number][], x: number): number {
  if (profile.length === 0) return 0
  if (x <= profile[0][0]) return profile[0][1]
  for (let i = 1; i < profile.length; i++) {
    if (x <= profile[i][0]) {
      const [x0, y0] = profile[i - 1]
      const [x1, y1] = profile[i]
      return x1 - x0 < 1e-9 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return profile[profile.length - 1][1]
}

/**
 * Cut parametric doorways into the dome. Struts crossing a doorway are
 * trimmed back to the passage boundary (the surviving piece runs from its
 * hub to the closure); struts and panels fully inside are removed, and
 * struts passing behind the buck plane connect through untouched. The buck
 * (2 jambs + header), the faceted closure outline, its sheathing areas and
 * stick framing are reported per door.
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
  const rBase = Math.sqrt(Math.max(0, radius * radius - z0 * z0))

  const perDoor = new Map<string, DoorFrameInfo>()
  const frames: DoorFrame[] = []

  for (const spec of doors) {
    const az = (spec.azimuthDeg * Math.PI) / 180
    const ux = Math.cos(az)
    const uy = Math.sin(az)
    const margin = Math.max(0, spec.margin ?? 0)
    const extraDepth = spec.extraDepth ?? 0
    const halfBuck = spec.width / 2
    const zTop = z0 + spec.height

    const fitSq = radius * radius - zTop * zTop - halfBuck * halfBuck
    const fits = fitSq > 0
    // Auto fit puts the buck corners on the sphere. Positive extra depth
    // recesses the buck (clamped clear of the dome center); negative pushes
    // it outward, up to the base ring.
    const framePlaneDist = fits
      ? Math.min(Math.max(Math.sqrt(fitSq) - extraDepth, rBase * 0.15), rBase)
      : 0

    const halfEnv = halfBuck + margin
    const envHeight = spec.height + margin
    const zTopEnv = z0 + envHeight

    // ---- Faceted closure profiles from the actual shell ----
    let closureProfile: ClosureProfile | null = null
    let closureSideArea = 0
    let closureTopArea = 0
    const closureFraming: ClosureMember[] = []
    if (fits) {
      const tris = localTriangles(model, radius, ux, uy)
      const wallFor = (side: -1 | 1): [number, number][] => {
        const segs = sectionSegments(tris, 1, side * halfEnv, 0, 2).filter(
          ([u1, , u2]) => Math.max(u1, u2) > framePlaneDist - 1e-6,
        )
        const uMaxSeg = segs.reduce((m, s) => Math.max(m, s[0], s[2]), framePlaneDist)
        const raw = upperEnvelope(segs, framePlaneDist, uMaxSeg, 8)
        // Heights above the base plane, clamped to the envelope top; walk
        // out until the shell meets the base.
        const pts: [number, number][] = []
        for (const [u, zAbs] of raw) {
          const h = Math.min(zAbs - z0, envHeight)
          if (h <= 1e-6 && pts.length > 0) {
            // Interpolate the exact base landing and stop.
            const [pu, ph] = pts[pts.length - 1]
            if (ph > 1e-6) pts.push([pu + ((u - pu) * ph) / (ph - h || 1), 0])
            break
          }
          pts.push([u, Math.max(0, h)])
        }
        return pts
      }
      const wallPos = wallFor(1)
      const wallNeg = wallFor(-1)

      const topSegs = sectionSegments(tris, 2, zTopEnv, 1, 0).filter(
        ([, u1, , u2]) => Math.max(u1, u2) > framePlaneDist - 1e-6,
      )
      const top = upperEnvelope(topSegs, -halfEnv, halfEnv, 12).map(
        ([t, u]) => [t, Math.max(u, framePlaneDist)] as [number, number],
      )

      closureProfile = { halfWidth: halfEnv, topHeight: envHeight, wallPos, wallNeg, top }
      closureSideArea =
        profileArea(wallPos, envHeight) + profileArea(wallNeg, envHeight)
      closureTopArea = profileArea(
        top.map(([t, u]) => [t, u - framePlaneDist] as [number, number]),
        1e9,
      )

      // ---- Closure framing on the faceted profiles ----
      const spacing = opts.studSpacing ?? 0
      if (spacing > 0) {
        for (const [side, wall] of [
          [1, wallPos],
          [-1, wallNeg],
        ] as const) {
          if (wall.length < 2) continue
          const uEnd = wall[wall.length - 1][0]
          const plateLen = uEnd - framePlaneDist
          if (plateLen >= opts.minStubLength) {
            closureFraming.push({
              part: 'wall plate', length: plateLen, quantity: 1, at: framePlaneDist, side,
            })
          }
          for (let u = framePlaneDist + spacing; u < uEnd; u += spacing) {
            const studLen = profileAt(wall, u)
            if (studLen < opts.minStubLength) break
            closureFraming.push({ part: 'wall stud', length: studLen, quantity: 1, at: u, side })
          }
        }
        for (let t = -halfEnv + spacing; t < halfEnv - 1e-9; t += spacing) {
          const len = profileAt(top, t) - framePlaneDist
          if (len >= opts.minStubLength) {
            closureFraming.push({ part: 'top blocking', length: len, quantity: 1, at: t, side: 0 })
          }
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
      closureSideArea,
      closureTopArea,
      closureFaceArea: fits ? 2 * halfEnv * envHeight - spec.width * spec.height : 0,
      closureFraming,
      closureProfile,
    })

    frames.push({
      spec,
      ux,
      uy,
      z0,
      halfWidth: halfEnv,
      height: envHeight,
      framePlaneDist,
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

  const rBase = Math.sqrt(Math.max(0, 1 - model.cutZ * model.cutZ)) * radius
  const clearanceDeg = (otherWidth: number) =>
    (Math.asin(Math.min(1, (spec.width / 2 + otherWidth / 2) / rBase)) * 180) / Math.PI + 5
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
