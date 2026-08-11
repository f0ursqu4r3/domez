import type { DomeModel, Vec3 } from './types'
import {
  archTooFlat,
  bottomEdgeIndex,
  effectiveHeight,
  offsetConvexOutward,
  openingArea,
  openingOutline,
  outlineBuckMembers,
  type BuckMember,
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
    | 'ring blocking'
  /** Cut length, working units. */
  length: number
  quantity: number
  /** Which side wall the piece belongs to (+1 / -1 tangential); 0 = top plane. */
  side: -1 | 0 | 1
  /** Endpoints in the member's plane, working units. Wall members (side ±1):
   * (radialDist, heightAboveBase). Top-plane members (side 0):
   * (tangentialOffset, radialDist) at the envelope top. Shaped-tunnel
   * members ('ring blocking' / 'shell edge', side 0): (tangential, hRel) —
   * the radial extent is carried separately in `ua`/`ub`. */
  a: [number, number]
  b: [number, number]
  /** Radial distance (u) at each end — shaped-tunnel members only ('ring
   * blocking' / 'shell edge' on arch, circle, triangle openings); rect
   * closure members leave these unset. */
  ua?: number
  ub?: number
}

/** Margined-polygon-edge tunnel strip, sampled with `TUNNEL_STATIONS` evenly
 * spaced stations (inclusive of endpoints) — the sampled shell profile the
 * shaped-opening closure (sheathing area + framing) is built from. */
export interface TunnelStrip {
  /** Margined polygon edge endpoints (t, hRel). */
  a: [number, number]
  b: [number, number]
  /** Shell radial distance at evenly spaced stations a→b (0 where the
   * radial line misses the shell). */
  uShell: number[]
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
  /** Opening shape, echoed and defaulted to 'rect'. */
  shape: OpeningShapeKind
  /** Pre-margin opening outline (t, hRel) — the true opening polygon before
   * the trim/shim margin is applied. */
  outline: [number, number][]
  /** Rough-buck cut list for the opening shape (jamb/header/sill for rect;
   * arch/rim/rake members for the others). Reported for every door. */
  buckMembers: BuckMember[]
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
  /** Sampled tunnel strips along the margined-polygon edges — arch/circle/
   * triangle openings only; undefined for rect (which uses `closureProfile`
   * instead). */
  closureTunnel?: TunnelStrip[]
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
  /** Human-readable summary of why the chosen spot won. */
  reason: string
  /** Sill height the search started from — windows only (sill axis searched). */
  fromSillHeight?: number
  /** Best sill height found — windows only (may equal fromSillHeight). */
  sillHeight?: number
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
  /** Window-only second axis: sill search half-band, working units. 0/omitted = bearing only. */
  sillSearchHalfWidth?: number
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

/** Convex polygon half-planes for the door's cut envelope from the already-
 * margined opening outline (`poly`), one plane per edge, with the bottom
 * edge special-cased to match the two legacy rect rules exactly:
 * - Floor-standing doors (not a window) skip the bottom edge's plane
 *   entirely — this reproduces the legacy `zClipLow = -1e9` behavior so
 *   base-ring struts aren't borderline-excluded by an edge that, for a
 *   door, isn't really a boundary (the portal continues down through the
 *   riser/base, off the bottom of the shell).
 * - Windows never cut below `zLowRel = max(0, buckBottomRel − margin)`,
 *   even though the offset polygon's own bottom edge sinks to
 *   `buckBottomRel − margin` unclamped when margin exceeds buckBottomRel
 *   (e.g. a floor-adjacent window with a wide margin and no riser). The
 *   bottom edge's plane is overridden with that clamped horizontal bound
 *   instead of the raw offset geometry — matching the legacy behavior of
 *   `zClipLow` being a plain height clip, independent of shape. */
function buildEnvelopePlanes(
  poly: [number, number][],
  isWindow: boolean,
  zLowRel: number,
): EnvelopePlane[] {
  const n = poly.length
  const bottomIdx = bottomEdgeIndex(poly)
  const planes: EnvelopePlane[] = []
  for (let i = 0; i < n; i++) {
    if (i === bottomIdx) {
      if (!isWindow) continue
      planes.push({ nt: 0, nz: -1, c: -zLowRel })
      continue
    }
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const nt = dy / len
    const nz = -dx / len
    planes.push({ nt, nz, c: nt * a[0] + nz * a[1] })
  }
  return planes
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

/** Per-door geometry shared by `cutDoorways`' closure/framing build and by
 * `openingPrisms`: fit test, margined cut-envelope polygon, and the
 * envelope's vertical bounds. Depends only on the spec and options — no
 * shell/model access. Factored out of `cutDoorways` so both callers share one
 * construction. */
interface DoorGeometry {
  spec: DoorSpec
  shape: OpeningShapeKind
  effH: number
  ux: number
  uy: number
  margin: number
  extraDepth: number
  halfBuck: number
  sill: number
  riser: number
  isWindow: boolean
  buckBottomRel: number
  buckTopRel: number
  riserConflict: boolean
  tooFlat: boolean
  preMarginPoly: [number, number][]
  fitSq: number
  fits: boolean
  framePlaneDist: number
  halfEnv: number
  zLowRel: number
  zHighRel: number
  zTopEnv: number
  zLowEnv: number
  marginedPoly: [number, number][]
  buckMembers: BuckMember[]
  jambLength: number
  headerLength: number
}

function computeDoorGeometry(
  spec: DoorSpec,
  opts: DoorwayOptions,
  radius: number,
  z0: number,
  rBase: number,
): DoorGeometry {
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

  // Margined opening outline (the actual cut boundary) — computed once and
  // reused by the envelope-plane builder below and by the shaped-opening
  // tunnel closure.
  const marginedPoly = tooFlat
    ? []
    : offsetConvexOutward(
        openingOutline(shape, spec.width, effH, buckBottomRel),
        margin,
        isWindow ? margin : 0,
      )

  // Rough-buck cut list, reported for every door. Rect's jamb/header stay
  // as the legacy rough-opening dimensions; the other shapes are
  // self-closing curves with no separate jamb/header run.
  const buckMembers = outlineBuckMembers(shape, spec.width, effH, isWindow)
  let jambLength = spec.height
  let headerLength = spec.width
  if (shape === 'arch') {
    jambLength = effH - spec.width / 2
    headerLength = 0
  } else if (shape === 'circle' || shape === 'triangle') {
    jambLength = 0
    headerLength = 0
  }

  return {
    spec,
    shape,
    effH,
    ux,
    uy,
    margin,
    extraDepth,
    halfBuck,
    sill,
    riser,
    isWindow,
    buckBottomRel,
    buckTopRel,
    riserConflict,
    tooFlat,
    preMarginPoly,
    fitSq,
    fits,
    framePlaneDist,
    halfEnv,
    zLowRel,
    zHighRel,
    zTopEnv,
    zLowEnv,
    marginedPoly,
    buckMembers,
    jambLength,
    headerLength,
  }
}

/** Build the door's cut frame (envelope half-planes + cutPlaneDist) from its
 * geometry, or null when the door contributes no cut at all (riser conflict
 * or too-flat arch) — mirrors the exact `cutDoorways` push condition so
 * `openingPrisms` produces a prism exactly when `cutDoorways` would cut with
 * it. NOTE: a door that fails the sphere-fit test (`fits === false`) for
 * reasons OTHER than riserConflict/tooFlat still gets a frame, with
 * `cutPlaneDist` collapsed to `framePlaneDist` (0) — this reproduces
 * existing legacy behavior and is intentionally NOT the same condition as
 * `fits`. */
function buildCutFrame(g: DoorGeometry, z0: number): DoorFrame | null {
  if (g.riserConflict || g.tooFlat) return null
  return {
    spec: g.spec,
    ux: g.ux,
    uy: g.uy,
    z0,
    planes: buildEnvelopePlanes(g.marginedPoly, g.isWindow, g.zLowRel),
    cutPlaneDist: g.fits ? Math.min(g.framePlaneDist, Math.sqrt(g.fitSq)) : g.framePlaneDist,
  }
}

/** The cut region ("prism") a door carves through the shell, in the shared
 * frame representation `cutDoorways` uses internally: a radial half-space
 * (u ≥ cutPlaneDist) intersected with the envelope half-planes. Exported for
 * the panel-clipping module (Task 2+) — one prism per door that actually
 * cuts, in the same order as `doors`, omitting riser-conflicted or too-flat
 * doors exactly as `cutDoorways` does. */
export interface OpeningPrism {
  doorId: string
  ux: number
  uy: number
  z0: number
  /** Inside = every nt·t + nz·(z − z0) ≤ c, with t = −uy·x + ux·y. */
  planes: { nt: number; nz: number; c: number }[]
  /** AND u = ux·x + uy·y ≥ cutPlaneDist. */
  cutPlaneDist: number
}

/** Export the per-door cut regions `cutDoorways` uses to remove struts,
 * vertices and panels — same construction, no shell/model traversal. A
 * panel-clipping module can test any point against `insidePrism`-style logic
 * (see `insidePoint` above) without re-deriving the envelope math. */
export function openingPrisms(
  model: DomeModel,
  doors: DoorSpec[],
  radius: number,
  opts: DoorwayOptions,
): OpeningPrism[] {
  const z0 = model.cutZ * radius
  const rBase = Math.sqrt(Math.max(0, radius * radius - z0 * z0))
  const prisms: OpeningPrism[] = []
  for (const spec of doors) {
    const g = computeDoorGeometry(spec, opts, radius, z0, rBase)
    const frame = buildCutFrame(g, z0)
    if (!frame) continue
    prisms.push({
      doorId: spec.id,
      ux: frame.ux,
      uy: frame.uy,
      z0: frame.z0,
      planes: frame.planes.map((p) => ({ nt: p.nt, nz: p.nz, c: p.c })),
      cutPlaneDist: frame.cutPlaneDist,
    })
  }
  return prisms
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

/** Stations sampled per margined-polygon edge for the tunnel closure (arch/
 * circle/triangle), inclusive of both endpoints. */
const TUNNEL_STATIONS = 8

/** Max radial (u) hit of the vertical line at (t, zAbs) through the shell. */
function radialShellDistance(tris: [number, number, number][][], t: number, z: number): number {
  let best = 0
  for (const tri of tris) {
    const [p, q, r] = tri
    const det = (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1])
    if (Math.abs(det) < 1e-12) continue
    const bx = t - p[1], by = z - p[2]
    const a = (bx * (r[2] - p[2]) - by * (r[1] - p[1])) / det
    const c = ((q[1] - p[1]) * by - (q[2] - p[2]) * bx) / det
    if (a < -1e-9 || c < -1e-9 || a + c > 1 + 1e-9) continue
    best = Math.max(best, p[0] + a * (q[0] - p[0]) + c * (r[0] - p[0]))
  }
  return best
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
    const g = computeDoorGeometry(spec, opts, radius, z0, rBase)
    const {
      shape,
      ux,
      uy,
      halfBuck,
      isWindow,
      buckBottomRel,
      buckTopRel,
      riserConflict,
      preMarginPoly,
      fits,
      framePlaneDist,
      halfEnv,
      zLowRel,
      zHighRel,
      zTopEnv,
      zLowEnv,
      marginedPoly,
      buckMembers,
      jambLength,
      headerLength,
    } = g

    // ---- Faceted closure from the actual shell. The closure seals the
    // region BETWEEN the shell section and the buck plane: outside the buck
    // for a recessed entry, outside the shell for a projecting one. Rect
    // sections the shell profile directly; arch/circle/triangle sample a
    // tunnel strip along each margined-polygon edge instead. ----
    let closureProfile: ClosureProfile | null = null
    let closureSideArea = 0
    let closureTopArea = 0
    let closureBottomArea = 0
    let closureTunnel: TunnelStrip[] | undefined
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
    } else if (fits) {
      // ---- Shaped (arch/circle/triangle) tunnel closure: sample each
      // margined-polygon edge at TUNNEL_STATIONS stations and read the shell
      // radial distance directly (no facet sectioning — the polygon has
      // arbitrarily many edges at arbitrary angles). ----
      const tris = localTriangles(model, radius, ux, uy)
      const n = marginedPoly.length
      const strips: TunnelStrip[] = []
      for (let i = 0; i < n; i++) {
        const a = marginedPoly[i]
        const b = marginedPoly[(i + 1) % n]
        const uShell: number[] = []
        for (let s = 0; s < TUNNEL_STATIONS; s++) {
          const frac = s / (TUNNEL_STATIONS - 1)
          const t = a[0] + (b[0] - a[0]) * frac
          const hRel = a[1] + (b[1] - a[1]) * frac
          uShell.push(radialShellDistance(tris, t, z0 + hRel))
        }
        strips.push({ a, b, uShell })
      }
      closureTunnel = strips

      // closureSideArea: trapezoid integral of |uShell − framePlaneDist|
      // along each edge (TUNNEL_STATIONS − 1 spans). Absolute: a recessed
      // buck seals shell → inward, a projecting one (negative depth) seals
      // shell → outward; stations where the radial line misses the shell
      // (uShell 0, open air) contribute nothing.
      for (const strip of strips) {
        const edgeLen = Math.hypot(strip.b[0] - strip.a[0], strip.b[1] - strip.a[1])
        const spanLen = edgeLen / (TUNNEL_STATIONS - 1)
        for (let s = 1; s < TUNNEL_STATIONS; s++) {
          const v0 = strip.uShell[s - 1] > 1e-9 ? Math.abs(strip.uShell[s - 1] - framePlaneDist) : 0
          const v1 = strip.uShell[s] > 1e-9 ? Math.abs(strip.uShell[s] - framePlaneDist) : 0
          closureSideArea += ((v0 + v1) / 2) * spanLen
        }
      }

      // ---- Closure framing along the tunnel ----
      const spacing = opts.studSpacing ?? 0
      if (spacing > 0) {
        for (let i = 0; i < n; i++) {
          const a = marginedPoly[i]
          const b = marginedPoly[(i + 1) % n]
          const strip = strips[i]
          const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1])
          const stationPos = (s: number): [number, number] => [
            a[0] + ((b[0] - a[0]) * s) / (TUNNEL_STATIONS - 1),
            a[1] + ((b[1] - a[1]) * s) / (TUNNEL_STATIONS - 1),
          ]

          // Ring blocking: radial stubs at k/nBlock along the edge. k=0 is
          // the shared vertex with the previous edge — the next edge's own
          // k=0 covers this edge's far endpoint, so no duplicates.
          const nBlock = Math.max(1, Math.ceil(edgeLen / spacing))
          for (let k = 0; k < nBlock; k++) {
            const frac = k / nBlock
            const t = a[0] + (b[0] - a[0]) * frac
            const hRel = a[1] + (b[1] - a[1]) * frac
            const uShellExact = radialShellDistance(tris, t, z0 + hRel)
            const length = Math.abs(uShellExact - framePlaneDist)
            // Blocking spans buck plane → shell in whichever direction the
            // shell lies (recessed: outward; projecting buck: inward). Skip
            // stations whose radial line misses the shell entirely.
            if (uShellExact > 1e-9 && length >= opts.minStubLength) {
              closureFraming.push({
                part: 'ring blocking',
                length,
                quantity: 1,
                side: 0,
                a: [t, hRel],
                b: [t, hRel],
                ua: framePlaneDist,
                ub: uShellExact,
              })
            }
          }

          // Shell edge: chain consecutive tunnel stations that both clear
          // the buck plane; fold a sub-minimum trailing span into its
          // predecessor (same pattern as the rect shell-edge chain above),
          // skip isolated single-station slivers.
          const qualifies = (s: number) => strip.uShell[s] > framePlaneDist + 1e-6
          let idx = 0
          while (idx < TUNNEL_STATIONS) {
            if (!qualifies(idx)) {
              idx++
              continue
            }
            let end = idx
            while (end + 1 < TUNNEL_STATIONS && qualifies(end + 1)) end++
            if (end > idx) {
              let start = idx
              // Track this run's own last-pushed member (not just whatever
              // happens to be at the end of closureFraming) so a fold never
              // reaches across into an unrelated edge or run.
              let lastInRun: ClosureMember | null = null
              for (let k = idx + 1; k <= end; k++) {
                const p0 = stationPos(start)
                const p1 = stationPos(k)
                const u0 = strip.uShell[start]
                const u1 = strip.uShell[k]
                const len = Math.hypot(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), u1 - u0)
                const isLastInRun = k === end
                if (len >= opts.minStubLength) {
                  const member: ClosureMember = {
                    part: 'shell edge',
                    length: len,
                    quantity: 1,
                    side: 0,
                    a: p0,
                    b: p1,
                    ua: u0,
                    ub: u1,
                  }
                  closureFraming.push(member)
                  lastInRun = member
                  start = k
                } else if (isLastInRun) {
                  // Trailing span too short for its own member: fold it into
                  // this run's previous member if one exists, otherwise it's
                  // an isolated sliver with nothing to attach to — drop it.
                  if (len > 1e-6 && lastInRun) {
                    lastInRun.b = p1
                    lastInRun.ub = u1
                    lastInRun.length = Math.hypot(
                      Math.hypot(p1[0] - lastInRun.a[0], p1[1] - lastInRun.a[1]),
                      u1 - lastInRun.ua!,
                    )
                  }
                  start = k
                }
              }
            }
            idx = end + 1
          }
        }
      }
    }

    // Unique framing junctions (member ends + buck corners, or — for shaped
    // openings — pre-margin polygon vertices at the buck plane).
    const joints = new Set<string>()
    if (shape === 'rect') {
      const jkey = (plane: number, x: number, y: number) =>
        `${plane}:${Math.round(x * 2)}:${Math.round(y * 2)}`
      for (const m of closureFraming) {
        joints.add(jkey(m.side, m.a[0], m.a[1]))
        joints.add(jkey(m.side, m.b[0], m.b[1]))
      }
      if (fits) {
        joints.add(jkey(9, -halfBuck, buckBottomRel))
        joints.add(jkey(9, halfBuck, buckBottomRel))
        joints.add(jkey(9, -halfBuck, buckTopRel))
        joints.add(jkey(9, halfBuck, buckTopRel))
      }
    } else {
      const jkey3 = (u: number, t: number, h: number) =>
        `${Math.round(u * 2)}:${Math.round(t * 2)}:${Math.round(h * 2)}`
      for (const m of closureFraming) {
        joints.add(jkey3(m.ua ?? framePlaneDist, m.a[0], m.a[1]))
        joints.add(jkey3(m.ub ?? framePlaneDist, m.b[0], m.b[1]))
      }
      if (fits) {
        for (const [t, hRel] of preMarginPoly) joints.add(jkey3(framePlaneDist, t, hRel))
      }
    }

    perDoor.set(spec.id, {
      ...spec,
      shape,
      outline: preMarginPoly,
      buckMembers,
      jambLength,
      headerLength,
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
      closureTunnel,
    })

    // A riser-conflicted or too-flat-arch portal cuts nothing.
    const frame = buildCutFrame(g, z0)
    if (frame) frames.push(frame)
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
  const shape: OpeningShapeKind = spec.shape ?? 'rect'
  const effH = effectiveHeight(shape, spec.width, spec.height)

  // A placement that doesn't fit is placement-dependent once a sill axis is
  // in play — never let the search prefer it.
  if (!info.fits) {
    return {
      trimmed: info.trimmedStrutCount,
      removed: info.removedStrutCount,
      hubsRemoved: info.removedHubCount,
      distinctTrims: 0,
      shortPieces: 0,
      centerOffset: spec.width / 2,
      score: Number.POSITIVE_INFINITY,
    }
  }

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
    centerOffset: spec.width / 2,
    score: 0,
  }

  // How far the door's center plane is from the nearest hub or strut
  // midpoint in the zone above/around the opening.
  const az = (spec.azimuthDeg * Math.PI) / 180
  const ux = Math.cos(az)
  const uy = Math.sin(az)
  const z0 = model.cutZ * radius
  // Zone heights are shell-relative: shift a floor-referenced sill down by the riser.
  const sillZone = Math.max(0, (spec.sillHeight ?? 0) - (opts.riserHeight ?? 0))

  const zeroCut =
    (shape === 'circle' || shape === 'triangle') &&
    stats.trimmed + stats.removed + stats.hubsRemoved === 0

  if (zeroCut) {
    // No struts touched: sort zero-cut spots by pattern-centeredness instead
    // — distance from the shape's true center to the nearest hub or panel
    // (face) centroid in the zone.
    const hCenter = sillZone + effH / 2
    const inZoneCenter = (x: number, y: number, z: number) => {
      const u = ux * x + uy * y
      const t = -uy * x + ux * y
      const h = z - z0
      return u > radius * 0.4 &&
        h >= sillZone - effH * 0.25 &&
        h <= sillZone + effH * 1.25 &&
        Math.abs(t) <= spec.width
        ? Math.hypot(t, h - hCenter)
        : Infinity
    }
    let centerOffset = spec.width / 2
    for (const v of model.vertices) {
      centerOffset = Math.min(
        centerOffset,
        inZoneCenter(v.position[0] * radius, v.position[1] * radius, v.position[2] * radius),
      )
    }
    for (const f of model.faces) {
      const c = f.vertexIds.reduce<[number, number, number]>(
        (s, vi) => {
          const p = model.vertices[vi].position
          return [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3]
        },
        [0, 0, 0],
      )
      centerOffset = Math.min(
        centerOffset,
        inZoneCenter(c[0] * radius, c[1] * radius, c[2] * radius),
      )
    }
    stats.centerOffset = centerOffset
    stats.score = 0.5 * (centerOffset / (spec.width / 2))
    return stats
  }

  // rect (byte-for-byte the legacy formula, since effH === spec.height for
  // rect) / arch (zone raised to sit over the arch's rounded crown) /
  // circle-or-triangle-with-cuts (rect formula + a flat penalty so a clean
  // zero-cut spot always outranks one that still touches structure).
  const zoneLow = shape === 'arch' ? sillZone + 0.6 * effH : sillZone - effH * 0.25
  const zoneHigh = shape === 'arch' ? sillZone + 1.25 * effH : sillZone + effH * 1.25
  const inZone = (x: number, y: number, z: number) => {
    const u = ux * x + uy * y
    const t = -uy * x + ux * y
    const h = z - z0
    return u > radius * 0.4 && h >= zoneLow && h <= zoneHigh && Math.abs(t) <= spec.width
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

  stats.centerOffset = centerOffset
  stats.score =
    stats.hubsRemoved * 10 +
    stats.trimmed * 3 +
    stats.distinctTrims * 2 +
    stats.shortPieces * 2 +
    stats.removed * 0.25 +
    (centerOffset / (spec.width / 2)) * 5
  if (shape === 'circle' || shape === 'triangle') stats.score += 8
  return stats
}

/** Fixed coarse azimuth step, degrees — a fine grid over the full ±36°
 * default window is wasteful; the coarse pass finds the right neighborhood,
 * the fine pass (below) refines it. */
const COARSE_STEP_DEG = 2
/** Fixed fine-pass half-width, degrees — independent of the configured
 * search half-width; the fine pass only polishes the coarse winner. */
const FINE_HALF_WIDTH_DEG = 2

/**
 * Find the bearing (and, for windows with a sill search band, the sill
 * height) near the door's current position where the doorway meets the
 * frame most cleanly. A coarse 2° grid locates the right neighborhood, then
 * a fine grid at the caller's step polishes it — a flat 0.25° sweep over
 * ±36° (and, for windows, a matching band of sill heights) is too slow to
 * run on every placement. Ties resolve to the position closest to where the
 * user put the door.
 */
export function optimizeDoorPlacement(
  model: DomeModel,
  spec: DoorSpec,
  radius: number,
  opts: PlacementOptions,
): DoorPlacementResult {
  const halfWidth = opts.searchHalfWidthDeg ?? 36
  const fineStepAz = opts.stepDeg ?? 0.25
  const shape: OpeningShapeKind = spec.shape ?? 'rect'
  const originalAz = spec.azimuthDeg
  const originalSill = spec.sillHeight ?? 0
  const band = opts.sillSearchHalfWidth ?? 0
  const useSillAxis = band > 0 && originalSill > 0
  const sillFloor = Math.max(1e-6, (opts.riserHeight ?? 0) + (spec.margin ?? 0) + 0.001)
  const coarseStepSill = band / 12
  const fineStepSill = band / 50

  const before = placementStats(model, spec, radius, opts)

  const rBase = Math.sqrt(Math.max(0, 1 - model.cutZ * model.cutZ)) * radius
  const clearanceDeg = (otherWidth: number) =>
    (Math.asin(Math.min(1, (spec.width / 2 + otherWidth / 2) / rBase)) * 180) / Math.PI + 5
  const myMargin = spec.margin ?? 0
  const otherBands = (opts.otherDoors ?? []).map((d) => {
    const dMargin = d.margin ?? 0
    const dBottom = d.sillHeight ?? 0
    const dTop = dBottom + effectiveHeight(d.shape ?? 'rect', d.width, d.height)
    return { az: d.azimuthDeg, width: d.width, lo: dBottom - dMargin, hi: dTop + dMargin }
  })
  // Angular overlap (existing clearanceDeg + its 5° pad) AND vertical band
  // overlap [myBottom − margin, myTop + margin] vs the other opening's own
  // margined band. Doors start at 0 (no sillHeight set), so this naturally
  // reduces to the door-only angular check the legacy sweep used.
  const blocked = (az: number, sill: number): boolean => {
    const lo = sill - myMargin
    const hi = sill + effectiveHeight(shape, spec.width, spec.height) + myMargin
    return otherBands.some((d) => {
      let delta = Math.abs(az - d.az) % 360
      if (delta > 180) delta = 360 - delta
      return delta < clearanceDeg(d.width) && lo < d.hi && d.lo < hi
    })
  }

  const azWrap = (az: number) => (((az % 360) + 360) % 360)
  // Normalized squared distance from the user's original placement — the
  // tie-break when two candidates score identically.
  const metricOf = (az: number, sill: number): number => {
    let dAz = (az - originalAz) % 360
    if (dAz > 180) dAz -= 360
    if (dAz < -180) dAz += 360
    const azTerm = (dAz / halfWidth) ** 2
    const sillTerm = useSillAxis ? ((sill - originalSill) / band) ** 2 : 0
    return azTerm + sillTerm
  }

  interface Candidate {
    az: number
    sill: number
    stats: PlacementStats
    metric: number
  }
  let best: Candidate = { az: originalAz, sill: originalSill, stats: before, metric: 0 }
  let evaluated = 1

  const consider = (az: number, sill: number) => {
    if (useSillAxis && sill < sillFloor) return
    if (blocked(az, sill)) return
    const candidateSpec = useSillAxis ? { ...spec, azimuthDeg: az, sillHeight: sill } : { ...spec, azimuthDeg: az }
    const stats = placementStats(model, candidateSpec, radius, opts)
    evaluated++
    const metric = metricOf(az, sill)
    if (
      stats.score < best.stats.score - 1e-9 ||
      (Math.abs(stats.score - best.stats.score) <= 1e-9 && metric < best.metric)
    ) {
      best = { az, sill, stats, metric }
    }
  }

  // ---- Coarse pass: 2° azimuth grid over ±halfWidth, crossed with a
  // band/12 sill grid over ±band for windows with a sill search band. ----
  const nAzCoarse = Math.round(halfWidth / COARSE_STEP_DEG)
  const sillCoarseOffsets = useSillAxis
    ? Array.from({ length: 25 }, (_, k) => (k - 12) * coarseStepSill)
    : [0]
  for (let i = -nAzCoarse; i <= nAzCoarse; i++) {
    const az = azWrap(originalAz + i * COARSE_STEP_DEG)
    for (const sillOffset of sillCoarseOffsets) {
      if (i === 0 && sillOffset === 0) continue
      consider(az, originalSill + sillOffset)
    }
  }
  const coarseBestAz = best.az
  const coarseBestSill = best.sill

  // ---- Fine pass: stepDeg azimuth grid over ±2° and band/50 sill grid over
  // ±band/12, centered on the coarse winner. ----
  const nAzFine = Math.round(FINE_HALF_WIDTH_DEG / fineStepAz)
  const nSillFine = useSillAxis ? Math.ceil(coarseStepSill / fineStepSill) : 0
  const sillFineOffsets = useSillAxis
    ? Array.from({ length: nSillFine * 2 + 1 }, (_, k) => (k - nSillFine) * fineStepSill)
    : [0]
  for (let i = -nAzFine; i <= nAzFine; i++) {
    const az = azWrap(coarseBestAz + i * fineStepAz)
    for (const sillOffset of sillFineOffsets) {
      if (i === 0 && sillOffset === 0) continue
      consider(az, coarseBestSill + sillOffset)
    }
  }

  const zeroCutReason = best.stats.trimmed + best.stats.removed === 0 && (shape === 'circle' || shape === 'triangle')
  const reason = zeroCutReason
    ? 'fits inside one panel — 0 struts cut'
    : best.stats.centerOffset <= spec.width * 0.1
      ? 'centered on the frame pattern'
      : `cleanest available — ${best.stats.trimmed} trims`

  const result: DoorPlacementResult = {
    fromAzimuthDeg: originalAz,
    azimuthDeg: Math.round(best.az * 4) / 4,
    before,
    after: best.stats,
    improved: best.stats.score < before.score - 1e-9,
    evaluated,
    reason,
  }
  if (useSillAxis) {
    result.fromSillHeight = originalSill
    // Round to the fine sill-step grid, anchored at the floor so rounding
    // can never push the result back under it.
    result.sillHeight = Math.round((best.sill - sillFloor) / fineStepSill) * fineStepSill + sillFloor
  }
  return result
}
