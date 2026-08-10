import type { DomeModel, Vec3 } from './types'
import {
  archTooFlat,
  effectiveHeight,
  offsetConvexOutward,
  openingArea,
  openingOutline,
  type OpeningShapeKind,
} from './openingShapes'

export type { OpeningShapeKind } from './openingShapes'

/** A parametric doorway standing on the base plane. Working units. */
export interface DoorSpec {
  /** Label, e.g. D1. */
  id: string
  /** Position around the base ring, degrees (0 = +x). */
  azimuthDeg: number
  /** Rough opening width. */
  width: number
  /** Rough opening height above the base plane. Ignored (= width) for
   * circle — see `effectiveHeight`. */
  height: number
  /** Opening shape; default 'rect'. Arch/circle/triangle cut struts, panels
   * and vertices like a rect does, but their closure (sheathing + framing)
   * is reported as zero/empty until Task 3. */
  shape?: OpeningShapeKind
  /** Recess of the buck plane relative to the auto fit. Positive = deeper
   * entry; negative pushes the buck outward toward (or proud of) the shell,
   * clamped to the base ring radius. */
  extraDepth?: number
  /** Clearance band around the rough opening: the shell is cut back this
   * much beyond the buck outline (trim/shim zone on the face plane). */
  margin?: number
  /** Height of the opening's bottom above the base plane. 0 = a door on
   * the ground; > 0 = a framed window floating on the shell (its buck gains
   * a sill and the closure gains a bottom apron). */
  sillHeight?: number
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
  part:
    | 'wall plate'
    | 'wall stud'
    | 'top blocking'
    | 'shell edge'
    | 'top edge'
    | 'sill blocking'
    | 'sill edge'
  /** Cut length, working units. */
  length: number
  quantity: number
  /** Which side wall the piece belongs to (+1 / -1 tangential); 0 = top plane. */
  side: -1 | 0 | 1
  /** Endpoints in the member's plane, working units. Wall members (side ±1):
   * (radialDist, heightAboveBase). Top-plane members (side 0):
   * (tangentialOffset, radialDist) at the envelope top. */
  a: [number, number]
  b: [number, number]
}

/** Faceted closure outline, sectioned from the actual triangulated shell
 * (not the ideal sphere), in door-local coordinates. */
export interface ClosureProfile {
  /** Envelope half-width = width/2 + margin. */
  halfWidth: number
  /** Envelope top above the base plane = sill + height + margin. */
  topHeight: number
  /** Envelope bottom above the base plane (0 for doors; sill − margin for
   * framed windows, which also get a bottom apron plane). */
  lowHeight: number
  /** Side-wall outer edges: [radialDist, heightAboveBase][], ordered by
   * radial distance. side +1 / -1 tangential. */
  wallPos: [number, number][]
  wallNeg: [number, number][]
  /** Top-plane outer edge: [tangentialOffset, radialDist][]. */
  top: [number, number][]
  /** Bottom-plane (sill apron) outer edge; empty for doors. */
  bottom: [number, number][]
}

export interface DoorFrameInfo extends DoorSpec {
  /** Vertical buck members, one per side (cut length = height). */
  jambLength: number
  /** Horizontal header member (rough-opening span; add your framing allowances). */
  headerLength: number
  /** Distance of the vertical buck plane from the dome axis. */
  framePlaneDist: number
  /** How far the buck plane sits inside the base ring at the door center.
   * Negative when the entry projects beyond the base ring. */
  tunnelDepth: number
  /** False when the rectangle does not fit inside the shell (too tall/wide). */
  fits: boolean
  /** Opening bottom relative to the BASE plane; negative when the riser
   * drops the floor below it. Equals sillHeight (or 0) when no riser. */
  buckBottomRel: number
  /** Opening top relative to the base plane: buckBottomRel + height. */
  buckTopRel: number
  /** True when the riser makes the portal unbuildable (door not taller than
   * the riser; window sill inside the riser band incl. margin). Forces
   * fits = false. */
  riserConflict: boolean
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
  /** Bottom apron plane under a framed window (0 for doors). */
  closureBottomArea: number
  /** Flat face band at the buck plane between the buck outline and the cut
   * envelope (only non-zero with margin). */
  closureFaceArea: number
  /** Stick framing for the closure, cut-list ready. */
  closureFraming: ClosureMember[]
  /** Unique framing junctions (member ends + buck corners) — connector count. */
  closureJointCount: number
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
  /** Riser (knee) wall height under the base ring, working units. When set,
   * portal dimensions are FLOOR-referenced: a door's height spans from the
   * foundation, a window's sill is measured above the foundation. */
  riserHeight?: number
}

export interface PlacementStats {
  trimmed: number
  removed: number
  hubsRemoved: number
  /** Count of distinct trimmed cut lengths (custom cuts to make). */
  distinctTrims: number
  /** Trimmed pieces shorter than twice the scrap floor — fussy stubs. */
  shortPieces: number
  /** Distance from the door's center plane to the nearest hub or strut
   * midline in the door zone — 0 means the entry is visually centered on
   * the frame pattern. Working units. */
  centerOffset: number
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

/** A half-plane of the door's cut envelope in local (t, hRel) coordinates:
 * inside = nt·t + nz·(z − z0) ≤ c. Built from the margined opening outline
 * (one plane per polygon edge); floor-standing doors drop the bottom edge's
 * plane entirely (see `buildEnvelopePlanes`). */
interface EnvelopePlane {
  nt: number
  nz: number
  c: number
}

interface DoorFrame {
  spec: DoorSpec
  /** Radial horizontal unit vector at the azimuth. */
  ux: number
  uy: number
  /** Base plane height, working units (cutZ × radius). */
  z0: number
  /** Convex polygon half-planes bounding the cut envelope (t, hRel). */
  planes: EnvelopePlane[]
  /** Cutting starts here — the buck plane, or the auto-fit plane when the
   * buck projects beyond it (the walkway must still pierce the shell).
   * Struts behind this plane pass through untouched. */
  cutPlaneDist: number
}

/** Convex polygon half-planes for the door's cut envelope: the margined
 * opening outline, one plane per edge. Floor-standing doors (not a window)
 * skip the bottom edge's plane entirely — this reproduces the legacy
 * `zClipLow = -1e9` behavior so base-ring struts aren't borderline-excluded
 * by an edge that, for a door, isn't really a boundary (the portal continues
 * down through the riser/base, off the bottom of the shell). */
function buildEnvelopePlanes(
  shape: OpeningShapeKind,
  width: number,
  effH: number,
  buckBottomRel: number,
  margin: number,
  isWindow: boolean,
): EnvelopePlane[] {
  const poly = offsetConvexOutward(
    openingOutline(shape, width, effH, buckBottomRel),
    margin,
    isWindow ? margin : 0,
  )
  const n = poly.length
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return { nt: dy / len, nz: -dx / len, a, midH: (a[1] + b[1]) / 2 }
  })
  // Same bottom-edge detection as offsetConvexOutward's bottomIdx: the
  // edge with an (almost) straight-down normal, breaking ties by height.
  let bottomIdx = -1
  let bottomH = Infinity
  if (!isWindow) {
    edges.forEach((e, i) => {
      if (e.nz < -0.99 && e.midH < bottomH) {
        bottomH = e.midH
        bottomIdx = i
      }
    })
  }
  return edges
    .filter((_, i) => i !== bottomIdx)
    .map((e) => ({ nt: e.nt, nz: e.nz, c: e.nt * e.a[0] + e.nz * e.a[1] }))
}

/** Interval [s0, s1] of a segment inside the door passage, or null. The
 * passage is the cut envelope extruded radially OUTWARD from the buck plane:
 * inside every envelope plane, radial ≥ buck plane. Struts passing behind
 * the buck plane connect through untouched. */
function insideInterval(frame: DoorFrame, a: Vec3, b: Vec3): [number, number] | null {
  let s0 = 0
  let s1 = 1
  // One-sided clip: constrains s so lerp(fa, fb, s) ≤ hi.
  const clipMax = (fa: number, fb: number, hi: number): boolean => {
    const d = fb - fa
    if (Math.abs(d) < 1e-12) {
      return fa <= hi
    }
    const t = (hi - fa) / d
    if (d > 0) s1 = Math.min(s1, t)
    else s0 = Math.max(s0, t)
    return s1 > s0
  }
  const tA = -frame.uy * a[0] + frame.ux * a[1]
  const tB = -frame.uy * b[0] + frame.ux * b[1]
  const zA = a[2] - frame.z0
  const zB = b[2] - frame.z0
  for (const p of frame.planes) {
    if (!clipMax(p.nt * tA + p.nz * zA, p.nt * tB + p.nz * zB, p.c)) return null
  }
  // Two-sided clip (hi effectively infinite) for the radial bound — unchanged
  // from before the polygon generalization.
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
  const uA = frame.ux * a[0] + frame.uy * a[1]
  const uB = frame.ux * b[0] + frame.uy * b[1]
  if (!clip(uA, uB, frame.cutPlaneDist, 1e12)) return null
  return s1 - s0 > 1e-9 ? [s0, s1] : null
}

function insidePoint(frame: DoorFrame, p: Vec3): boolean {
  const t = -frame.uy * p[0] + frame.ux * p[1]
  const z = p[2] - frame.z0
  for (const pl of frame.planes) {
    if (pl.nt * t + pl.nz * z > pl.c) return false
  }
  const u = frame.ux * p[0] + frame.uy * p[1]
  return u >= frame.cutPlaneDist
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

/** Merge consecutive collinear points so facet segments stay whole. */
function mergeCollinear(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts
  const out: [number, number][] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = out[out.length - 1]
    const [bx, by] = pts[i]
    const [cx, cy] = pts[i + 1]
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    const scale = Math.hypot(cx - ax, cy - ay) || 1
    if (Math.abs(cross) / scale > 1e-3) out.push(pts[i])
  }
  out.push(pts[pts.length - 1])
  return out
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
    const shape: OpeningShapeKind = spec.shape ?? 'rect'
    // Circle's true height is its width; every other shape passes height
    // through unchanged.
    const effH = effectiveHeight(shape, spec.width, spec.height)
    const az = (spec.azimuthDeg * Math.PI) / 180
    const ux = Math.cos(az)
    const uy = Math.sin(az)
    const margin = Math.max(0, spec.margin ?? 0)
    const extraDepth = spec.extraDepth ?? 0
    const halfBuck = spec.width / 2
    const sill = Math.max(0, spec.sillHeight ?? 0)
    const riser = Math.max(0, opts.riserHeight ?? 0)
    const isWindow = sill > 0
    // Portal dims are floor-referenced; the shell works from the base plane.
    const buckBottomRel = (isWindow ? sill : 0) - riser
    const buckTopRel = buckBottomRel + effH
    const riserConflict =
      riser > 0 && (isWindow ? buckBottomRel - margin < 0 : buckTopRel <= 0)
    // An arch shorter than a semicircle (height < width/2) can't exist —
    // refuse to fit and cut nothing, rather than push a degenerate outline.
    const tooFlat = archTooFlat(shape, spec.width, spec.height)

    // Every vertex of the PRE-margin outline must land inside the sphere.
    // Below-base vertices don't constrain (they sit in the riser/base, not
    // the shell) — matches the legacy max(0, buckBottomRel) rule.
    const preMarginPoly = tooFlat ? [] : openingOutline(shape, spec.width, effH, buckBottomRel)
    let maxTerm = 0
    for (const [t, hRel] of preMarginPoly) {
      const zAbs = z0 + Math.max(0, hRel)
      maxTerm = Math.max(maxTerm, zAbs * zAbs + t * t)
    }
    const fitSq = radius * radius - maxTerm
    const fits = !tooFlat && fitSq > 0 && !riserConflict
    // Auto fit puts the outline vertices on the sphere. Positive extra depth
    // recesses the buck (clamped clear of the dome center); negative pushes
    // it outward — past the base ring the entry becomes a projecting
    // vestibule, sealed by the same closure rules.
    const framePlaneDist = fits ? Math.max(Math.sqrt(fitSq) - extraDepth, rBase * 0.15) : 0

    const halfEnv = halfBuck + margin
    /** Envelope vertical bounds relative to the base plane. Doors sit on the
     * ground (or pass through the riser); framed windows float, with margin
     * cut above AND below. */
    const zLowRel = isWindow ? Math.max(0, buckBottomRel - margin) : 0
    const zHighRel = buckTopRel + margin
    const zTopEnv = z0 + zHighRel
    const zLowEnv = z0 + zLowRel

    // ---- Faceted closure from the actual shell. The closure seals the
    // region BETWEEN the shell section and the buck plane: outside the buck
    // for a recessed entry, outside the shell for a projecting one.
    // Rect only — shaped closures land in Task 3; until then shaped specs
    // still cut struts/panels/vertices below, but report a zero closure. ----
    let closureProfile: ClosureProfile | null = null
    let closureSideArea = 0
    let closureTopArea = 0
    let closureBottomArea = 0
    const closureFraming: ClosureMember[] = []
    if (fits && shape === 'rect') {
      const tris = localTriangles(model, radius, ux, uy)
      const wallFor = (side: -1 | 1): [number, number][] => {
        const segs = sectionSegments(tris, 1, side * halfEnv, 0, 2).filter(
          ([u1, , u2]) => Math.max(u1, u2) > 0,
        )
        const uShellMax = segs.reduce((m, s) => Math.max(m, s[0], s[2]), 0)
        const lo = Math.min(framePlaneDist, uShellMax)
        const hi = Math.max(framePlaneDist, uShellMax)
        const raw = upperEnvelope(segs, lo, hi, 12)
        // Shell height above the base, clamped to the envelope band; beyond
        // the shell's reach the height drops to the band floor (open air).
        const pts: [number, number][] = []
        const clampH = (u: number, zAbs: number) =>
          u > uShellMax - 1e-9 ? zLowRel : Math.min(Math.max(zAbs - z0, zLowRel), zHighRel)
        for (const [u, zAbs] of raw) pts.push([u, clampH(u, zAbs)])
        if (pts.length === 0 || pts[0][0] > lo + 1e-6) pts.unshift([lo, zHighRel])
        if (pts[pts.length - 1][0] < hi - 1e-6) pts.push([hi, zLowRel])
        // Ensure a breakpoint exactly at the buck plane (render rule splits there).
        if (!pts.some(([u]) => Math.abs(u - framePlaneDist) < 1e-6)) {
          pts.push([
            framePlaneDist,
            Math.min(Math.max(profileAt(pts, framePlaneDist), zLowRel), zHighRel),
          ])
          pts.sort((p, q) => p[0] - q[0])
        }
        return pts
      }
      const wallPos = wallFor(1)
      const wallNeg = wallFor(-1)

      const planeProfile = (zPlaneAbs: number): [number, number][] => {
        const segs = sectionSegments(tris, 2, zPlaneAbs, 1, 0).filter(
          ([, u1, , u2]) => Math.max(u1, u2) > 0,
        )
        // Raw shell radial distance at the plane (inside OR outside the buck
        // plane); 0 where the plane clears the shell entirely.
        return upperEnvelope(segs, -halfEnv, halfEnv, 12).map(
          ([t, u]) => [t, Math.max(u, 0)] as [number, number],
        )
      }
      const top = planeProfile(zTopEnv)
      const bottom = isWindow ? planeProfile(zLowEnv) : []

      closureProfile = {
        halfWidth: halfEnv,
        topHeight: zHighRel,
        lowHeight: zLowRel,
        wallPos,
        wallNeg,
        top,
        bottom,
      }

      // Wall region height at u: recessed side (u ≥ buck plane) spans the
      // band floor to the shell; projecting side spans shell to band top.
      const regionProfile = (wall: [number, number][]): [number, number][] =>
        wall.map(([u, h]) => [u, u >= framePlaneDist - 1e-9 ? h - zLowRel : zHighRel - h])
      closureSideArea =
        profileArea(regionProfile(wallPos), zHighRel - zLowRel) +
        profileArea(regionProfile(wallNeg), zHighRel - zLowRel)
      const planeArea = (profile: [number, number][]) =>
        profileArea(
          profile.map(([t, u]) => [t, Math.abs(u - framePlaneDist)] as [number, number]),
          1e9,
        )
      closureTopArea = planeArea(top)
      closureBottomArea = isWindow ? planeArea(bottom) : 0

      // ---- Closure framing on the faceted profiles ----
      const spacing = opts.studSpacing ?? 0
      if (spacing > 0) {
        for (const [side, wall] of [
          [1, wallPos],
          [-1, wallNeg],
        ] as const) {
          if (wall.length < 2) continue
          // Band-floor plate spans from the buck plane to where the shell
          // meets the envelope floor (the base for doors, the sill apron
          // plane for windows).
          let uZero = wall[wall.length - 1][0]
          for (let i = 1; i < wall.length; i++) {
            const [u0, h0] = wall[i - 1]
            const [u1, h1] = wall[i]
            if (h0 > zLowRel + 1e-6 && h1 <= zLowRel + 1e-6) {
              uZero = u0 + ((u1 - u0) * (h0 - zLowRel)) / (h0 - h1 || 1)
              break
            }
          }
          const plateA = Math.min(framePlaneDist, uZero)
          const plateB = Math.max(framePlaneDist, uZero)
          if (plateB - plateA >= opts.minStubLength) {
            closureFraming.push({
              part: 'wall plate',
              length: plateB - plateA,
              quantity: 1,
              side,
              a: [plateA, zLowRel],
              b: [plateB, zLowRel],
            })
          }
          // Studs march outward from the buck plane in both directions.
          const uLo = wall[0][0]
          const uHi = wall[wall.length - 1][0]
          for (const dir of [1, -1]) {
            for (let u = framePlaneDist + dir * spacing; u > uLo && u < uHi; u += dir * spacing) {
              const h = Math.min(Math.max(profileAt(wall, u), zLowRel), zHighRel)
              const [zA, zB] = u >= framePlaneDist ? [zLowRel, h] : [h, zHighRel]
              if (zB - zA < opts.minStubLength) continue
              closureFraming.push({
                part: 'wall stud',
                length: zB - zA,
                quantity: 1,
                side,
                a: [u, zA],
                b: [u, zB],
              })
            }
          }
          // Shell-edge members: the closure boundary follows the faceted
          // shell — one member per facet segment, chained end-to-end so the
          // frame connects. Sub-minimum slivers merge into their neighbor.
          const merged = mergeCollinear(wall)
          const runs: [number, number][][] = []
          let run: [number, number][] = []
          for (let i = 1; i < merged.length; i++) {
            const h0 = merged[i - 1][1]
            const h1 = merged[i][1]
            const flat0 = h0 <= zLowRel + 1e-6 && h1 <= zLowRel + 1e-6
            const flatTop = h0 >= zHighRel - 1e-6 && h1 >= zHighRel - 1e-6
            if (flat0 || flatTop) {
              if (run.length > 1) runs.push(run)
              run = []
            } else {
              if (run.length === 0) run.push(merged[i - 1])
              run.push(merged[i])
            }
          }
          if (run.length > 1) runs.push(run)
          for (const pts of runs) {
            let start = pts[0]
            for (let j = 1; j < pts.length; j++) {
              const len = Math.hypot(pts[j][0] - start[0], pts[j][1] - start[1])
              const isLast = j === pts.length - 1
              if (len >= opts.minStubLength || (isLast && len > 1e-6)) {
                const prev = closureFraming[closureFraming.length - 1]
                if (isLast && len < opts.minStubLength && prev?.part === 'shell edge' && prev.side === side) {
                  // Fold the trailing sliver into the previous member.
                  prev.b = pts[j]
                  prev.length = Math.hypot(prev.b[0] - prev.a[0], prev.b[1] - prev.a[1])
                } else {
                  closureFraming.push({
                    part: 'shell edge',
                    length: len,
                    quantity: 1,
                    side,
                    a: start,
                    b: pts[j],
                  })
                }
                start = pts[j]
              }
            }
          }
        }
        // Blocking + edge members on the horizontal closure planes (roof,
        // and the sill apron for windows).
        const planeMembers = (
          profile: [number, number][],
          blockingPart: 'top blocking' | 'sill blocking',
          edgePart: 'top edge' | 'sill edge',
        ) => {
          for (let t = -halfEnv + spacing; t < halfEnv - 1e-9; t += spacing) {
            const uShell = profileAt(profile, t)
            const len = Math.abs(uShell - framePlaneDist)
            if (len >= opts.minStubLength && uShell > 1e-6) {
              closureFraming.push({
                part: blockingPart,
                length: len,
                quantity: 1,
                side: 0,
                a: [t, Math.min(uShell, framePlaneDist)],
                b: [t, Math.max(uShell, framePlaneDist)],
              })
            }
          }
          const mergedPlane = mergeCollinear(profile)
          for (let i = 1; i < mergedPlane.length; i++) {
            const [t0, u0] = mergedPlane[i - 1]
            const [t1, u1] = mergedPlane[i]
            if (u0 <= 1e-6 && u1 <= 1e-6) continue
            if (Math.max(Math.abs(u0 - framePlaneDist), Math.abs(u1 - framePlaneDist)) < opts.minStubLength) continue
            const len = Math.hypot(t1 - t0, u1 - u0)
            if (len < opts.minStubLength) continue
            closureFraming.push({
              part: edgePart,
              length: len,
              quantity: 1,
              side: 0,
              a: [t0, u0],
              b: [t1, u1],
            })
          }
        }
        planeMembers(top, 'top blocking', 'top edge')
        if (isWindow) planeMembers(bottom, 'sill blocking', 'sill edge')
      }
    }

    // Unique framing junctions (member ends + the four buck corners).
    const joints = new Set<string>()
    const jkey = (plane: number, x: number, y: number) =>
      `${plane}:${Math.round(x * 2)}:${Math.round(y * 2)}`
    for (const m of closureFraming) {
      joints.add(jkey(m.side, m.a[0], m.a[1]))
      joints.add(jkey(m.side, m.b[0], m.b[1]))
    }
    if (fits && shape === 'rect') {
      joints.add(jkey(9, -halfBuck, buckBottomRel))
      joints.add(jkey(9, halfBuck, buckBottomRel))
      joints.add(jkey(9, -halfBuck, buckTopRel))
      joints.add(jkey(9, halfBuck, buckTopRel))
    }

    perDoor.set(spec.id, {
      ...spec,
      jambLength: spec.height,
      headerLength: spec.width,
      framePlaneDist,
      tunnelDepth: rBase - framePlaneDist,
      fits,
      buckBottomRel,
      buckTopRel,
      riserConflict,
      removedStrutCount: 0,
      trimmedStrutCount: 0,
      removedHubCount: 0,
      removedPanelCount: 0,
      area: openingArea(shape, spec.width, spec.height),
      closureSideArea,
      closureTopArea,
      closureBottomArea,
      closureFaceArea:
        fits && shape === 'rect'
          ? 2 * halfEnv * (zHighRel - zLowRel) -
            spec.width * Math.max(0, Math.min(buckTopRel, zHighRel) - Math.max(buckBottomRel, zLowRel))
          : 0,
      closureFraming,
      closureJointCount: joints.size,
      closureProfile,
    })

    // A riser-conflicted or too-flat-arch portal cuts nothing.
    if (!riserConflict && !tooFlat) {
      frames.push({
        spec,
        ux,
        uy,
        z0,
        planes: buildEnvelopePlanes(shape, spec.width, effH, buckBottomRel, margin, isWindow),
        cutPlaneDist: fits ? Math.min(framePlaneDist, Math.sqrt(fitSq)) : framePlaneDist,
      })
    }
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
 * builder feels; removing whole struts is largely what a door SHOULD do.
 * A centering term biases the door toward sitting symmetrically on a hub
 * or a strut midline — the visually appealing placements. */
function placementStats(
  model: DomeModel,
  spec: DoorSpec,
  radius: number,
  opts: PlacementOptions,
): PlacementStats {
  const cut = cutDoorways(model, [spec], radius, {
    minStubLength: opts.minStubLength,
    riserHeight: opts.riserHeight,
  })
  const info = cut.doors[0]
  const distinct = new Set(
    cut.trimmed.map((t) => Math.round(t.length / Math.max(opts.increment, 1e-9))),
  )
  const shortLimit = opts.minStubLength * 2
  const shortPieces = cut.trimmed.filter((t) => t.length < shortLimit).length

  // How far the door's center plane is from the nearest hub or strut
  // midpoint in the zone above/around the opening.
  const az = (spec.azimuthDeg * Math.PI) / 180
  const ux = Math.cos(az)
  const uy = Math.sin(az)
  const z0 = model.cutZ * radius
  // Zone heights are shell-relative: shift a floor-referenced sill down by the riser.
  const sillZone = Math.max(0, (spec.sillHeight ?? 0) - (opts.riserHeight ?? 0))
  const effH = effectiveHeight(spec.shape ?? 'rect', spec.width, spec.height)
  const inZone = (x: number, y: number, z: number) => {
    const u = ux * x + uy * y
    const t = -uy * x + ux * y
    const h = z - z0
    return u > radius * 0.4 &&
      h >= sillZone - effH * 0.25 &&
      h <= sillZone + effH * 1.25 &&
      Math.abs(t) <= spec.width
      ? Math.abs(t)
      : Infinity
  }
  let centerOffset = spec.width / 2
  for (const v of model.vertices) {
    centerOffset = Math.min(
      centerOffset,
      inZone(v.position[0] * radius, v.position[1] * radius, v.position[2] * radius),
    )
  }
  for (const e of model.edges) {
    const p0 = model.vertices[e.v0].position
    const p1 = model.vertices[e.v1].position
    centerOffset = Math.min(
      centerOffset,
      inZone(
        ((p0[0] + p1[0]) / 2) * radius,
        ((p0[1] + p1[1]) / 2) * radius,
        ((p0[2] + p1[2]) / 2) * radius,
      ),
    )
  }

  const stats: PlacementStats = {
    trimmed: info.trimmedStrutCount,
    removed: info.removedStrutCount,
    hubsRemoved: info.removedHubCount,
    distinctTrims: distinct.size,
    shortPieces,
    centerOffset,
    score: 0,
  }
  stats.score =
    stats.hubsRemoved * 10 +
    stats.trimmed * 3 +
    stats.distinctTrims * 2 +
    stats.shortPieces * 2 +
    stats.removed * 0.25 +
    (centerOffset / (spec.width / 2)) * 5
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
