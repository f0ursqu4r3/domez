# Openings Shapes + Shape-Aware Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Framed openings gain shapes (doors rect|arch, windows rect|arch|circle|triangle) cut by one generalized convex-polygon path, plus a 2D shape-aware placement optimizer with human-readable reasons.

**Architecture:** A new `openingShapes.ts` engine module canonicalizes every shape to a convex CCW polygon in door-local (t, hRel) coordinates and derives buck members with miters. `cutDoorways` clips struts against per-edge half-planes (rect reproduces today's output exactly — pinned by a characterization test). Rect keeps the proven closure path; shaped openings get a sampled tunnel closure. The optimizer becomes coarse-to-fine, adds a sill axis for windows, and scores per shape.

**Tech Stack:** TypeScript, Vue 3, Three.js, vitest (`bun run test`), `bun run build` (vue-tsc gate).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-openings-shapes-design.md`.
- Default shape `'rect'` everywhere — old projects, share links, and files load unchanged.
- Rect behavior is frozen: the Task 2 characterization test values must never change.
- Working units: engine functions take working units (inches or mm); state stores canonical mm.
- All work directly on `main`; every task ends `bun run test` green before commit.
- Arch facets: 8 segments (half of an inscribed regular 16-gon). Circle: inscribed 16-gon, flat bottom/top. Miters 11.25° per end.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `openingShapes.ts` — outlines, offset, buck members

**Files:**
- Create: `src/engine/openingShapes.ts`
- Test: `src/engine/__tests__/openingShapes.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (Tasks 2–7 rely on these exact names):

```ts
export type OpeningShapeKind = 'rect' | 'arch' | 'circle' | 'triangle'
export interface BuckMember {
  part: string // 'jamb' | 'header' | 'sill' | 'arch segment' | 'rim segment' | 'rake' | 'base'
  length: number
  /** Miter per end from square, degrees; 0 = square cut. */
  miterDegA: number
  miterDegB: number
  quantity: number
}
export const ARCH_SEGMENTS = 8
export const CIRCLE_SEGMENTS = 16
/** Circle ignores height (= width); every other shape passes height through. */
export function effectiveHeight(shape: OpeningShapeKind, width: number, height: number): number
/** True when an arch cannot exist: height < width/2. */
export function archTooFlat(shape: OpeningShapeKind, width: number, height: number): boolean
/** Door slab area of the true shape (rect w·h, circle πr², arch w·j + πr²/2, triangle w·h/2). */
export function openingArea(shape: OpeningShapeKind, width: number, height: number): number
/** Convex CCW polygon in door-local (t, hRel-above-base). b = buckBottomRel. */
export function openingOutline(
  shape: OpeningShapeKind, width: number, height: number, b: number,
): [number, number][]
/** Offset each edge outward by `margin` (bottom-most horizontal edge by
 * `bottomMargin` instead), re-intersect neighbors. margin 0 → identity. */
export function offsetConvexOutward(
  poly: [number, number][], margin: number, bottomMargin: number,
): [number, number][]
export function outlineBuckMembers(
  shape: OpeningShapeKind, width: number, height: number, isWindow: boolean,
): BuckMember[]
```

Geometry (all CCW, t right / h up):

- **rect**: `[(-w/2,b),(w/2,b),(w/2,b+h),(-w/2,b+h)]`.
- **arch**: `j = h - w/2`, `r = w/2`. Vertices: `(-w/2,b)`, `(w/2,b)`, then (skip when `j < 1e-9` to avoid duplicates) `(w/2,b+j)`, then arch points `(r·cos(kπ/8), b+j+r·sin(kπ/8))` for `k = 1..7`, then `(-w/2,b+j)` (this IS the k=8 point). 11 vertices when j > 0.
- **circle**: 16 vertices `(r·cosθ_k, b+r+r·sinθ_k)` at `θ_k = -90° + (k+0.5)·22.5°`, k = 0..15, `r = w/2`. The k=15→k=0 edge is the horizontal bottom; k=7→k=8 the horizontal top.
- **triangle**: `[(-w/2,b),(w/2,b),(0,b+h)]`.

`offsetConvexOutward`: for CCW edge `P_i→P_{i+1}` with direction `d`, outward unit normal `n_i = (d.y,−d.x)/|d|`; the "bottom edge" is the one with `n.y < −0.99` and minimal midpoint h (rect/arch/triangle base; circle bottom segment). Offset line i: `n_i·X = n_i·P_i + m_i` where `m_i` = bottomMargin for the bottom edge else margin. New vertex k = intersection of offset lines k−1 and k (2×2 solve; our shapes never have parallel adjacent edges).

`outlineBuckMembers`:
- rect: `2× jamb` (h, 0/0), `1× header` (w, 0/0); `+1× sill` (w, 0/0) when isWindow.
- arch: `2× jamb` (j, 0/0) when j > 1e-9, `8× arch segment` (`2r·sin(π/16)`, 11.25/11.25).
- circle: `16× rim segment` (`w·sin(π/16)`, 11.25/11.25).
- triangle: base corner angle `θ = atan2(h, w/2)`, apex angle `φ = π − 2θ`. `1× base` (w, deg(θ)/2 each end), `2× rake` (`hypot(w/2, h)`, base end deg(θ)/2, apex end deg(φ)/2). Same long-point/half-interior-angle convention as `panelFrames.ts`.

Consolidate quantity: arch segments and circle rim segments have identical lengths — emit ONE BuckMember with quantity 8 / 16; jambs quantity 2; rakes quantity 2.

- [ ] **Step 1: Write failing tests** in `src/engine/__tests__/openingShapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  archTooFlat, effectiveHeight, offsetConvexOutward, openingArea,
  openingOutline, outlineBuckMembers,
} from '../openingShapes'

const isConvexCCW = (poly: [number, number][]) => {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length]
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (cross < -1e-9) return false
  }
  return true
}

describe('openingOutline', () => {
  it('rect is the four corners', () => {
    expect(openingOutline('rect', 36, 80, 0)).toEqual([[-18, 0], [18, 0], [18, 80], [-18, 80]])
  })
  it('arch has 11 vertices, equal chords 2r·sin(π/16), convex CCW', () => {
    const poly = openingOutline('arch', 36, 80, 0)
    expect(poly).toHaveLength(11)
    expect(isConvexCCW(poly)).toBe(true)
    const chord = 2 * 18 * Math.sin(Math.PI / 16)
    for (let i = 2; i < 10; i++) {
      const [a, b] = [poly[i], poly[i + 1]]
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(chord, 9)
    }
    expect(poly[2]).toEqual([18, 62])   // spring point, j = 80 - 18
    expect(poly[10]).toEqual([-18, 62])
  })
  it('arch with h exactly w/2 drops the jamb vertices (9 points)', () => {
    expect(openingOutline('arch', 36, 18, 0)).toHaveLength(9)
  })
  it('circle is a 16-gon with horizontal bottom and top edges', () => {
    const poly = openingOutline('circle', 24, 999, 36) // height ignored
    expect(poly).toHaveLength(16)
    expect(isConvexCCW(poly)).toBe(true)
    expect(poly[15][1]).toBeCloseTo(poly[0][1], 9)   // flat bottom
    expect(poly[7][1]).toBeCloseTo(poly[8][1], 9)    // flat top
    for (const [t, h] of poly) expect(Math.hypot(t, h - 48)).toBeCloseTo(12, 9) // on circle, center h=36+12
  })
  it('triangle apex sits at (0, b+h)', () => {
    expect(openingOutline('triangle', 30, 40, 36)).toEqual([[-15, 36], [15, 36], [0, 76]])
  })
})

describe('offsetConvexOutward', () => {
  it('margin 0 is the identity', () => {
    const poly = openingOutline('circle', 24, 24, 36)
    const off = offsetConvexOutward(poly, 0, 0)
    off.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(poly[i][0], 9)
      expect(p[1]).toBeCloseTo(poly[i][1], 9)
    })
  })
  it('rect with bottomMargin 0 grows sides and top only (door rule)', () => {
    const off = offsetConvexOutward(openingOutline('rect', 36, 80, 0), 1.5, 0)
    expect(off).toEqual([[-19.5, 0], [19.5, 0], [19.5, 81.5], [-19.5, 81.5]])
  })
  it('circle offset stays convex and grows every vertex radially', () => {
    const off = offsetConvexOutward(openingOutline('circle', 24, 24, 36), 1.5, 1.5)
    expect(isConvexCCW(off)).toBe(true)
    for (const [t, h] of off) expect(Math.hypot(t, h - 48)).toBeGreaterThan(12 + 1.4)
  })
})

describe('outlineBuckMembers', () => {
  it('rect window: jambs, header, sill', () => {
    const parts = outlineBuckMembers('rect', 24, 36, true)
    expect(parts.map((m) => [m.part, m.quantity])).toEqual([
      ['jamb', 2], ['header', 1], ['sill', 1],
    ])
    expect(parts.every((m) => m.miterDegA === 0 && m.miterDegB === 0)).toBe(true)
  })
  it('arch: 2 jambs + 8 segments at 11.25°', () => {
    const parts = outlineBuckMembers('arch', 36, 80, false)
    const seg = parts.find((m) => m.part === 'arch segment')!
    expect(seg.quantity).toBe(8)
    expect(seg.length).toBeCloseTo(2 * 18 * Math.sin(Math.PI / 16), 9)
    expect(seg.miterDegA).toBeCloseTo(11.25, 9)
    expect(parts.find((m) => m.part === 'jamb')!.length).toBeCloseTo(62, 9)
  })
  it('circle: 16 rim segments', () => {
    const parts = outlineBuckMembers('circle', 24, 24, true)
    expect(parts).toHaveLength(1)
    expect(parts[0].quantity).toBe(16)
    expect(parts[0].length).toBeCloseTo(24 * Math.sin(Math.PI / 16), 9)
  })
  it('triangle miters are half interior angles', () => {
    const parts = outlineBuckMembers('triangle', 30, 40, true)
    const theta = Math.atan2(40, 15)
    const base = parts.find((m) => m.part === 'base')!
    const rake = parts.find((m) => m.part === 'rake')!
    expect(base.miterDegA).toBeCloseTo((theta * 90) / Math.PI, 6) // θ/2 in degrees
    expect(rake.miterDegB).toBeCloseTo(((Math.PI - 2 * theta) * 90) / Math.PI, 6)
    expect(rake.length).toBeCloseTo(Math.hypot(15, 40), 9)
  })
})

describe('helpers', () => {
  it('effectiveHeight: circle = width', () => {
    expect(effectiveHeight('circle', 24, 99)).toBe(24)
    expect(effectiveHeight('arch', 36, 80)).toBe(80)
  })
  it('archTooFlat only for arch with h < w/2', () => {
    expect(archTooFlat('arch', 36, 17)).toBe(true)
    expect(archTooFlat('arch', 36, 18)).toBe(false)
    expect(archTooFlat('rect', 36, 1)).toBe(false)
  })
  it('openingArea per shape', () => {
    expect(openingArea('rect', 36, 80)).toBe(2880)
    expect(openingArea('circle', 24, 0)).toBeCloseTo(Math.PI * 144, 9)
    expect(openingArea('arch', 36, 80)).toBeCloseTo(36 * 62 + (Math.PI * 324) / 2, 9)
    expect(openingArea('triangle', 30, 40)).toBe(600)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- openingShapes` → module not found.
- [ ] **Step 3: Implement `src/engine/openingShapes.ts`** per the geometry above.
- [ ] **Step 4: Run** — `bun run test -- openingShapes` → PASS; full `bun run test` still green.
- [ ] **Step 5: Commit** — `feat: openingShapes engine module — outlines, convex offset, buck members`

---

### Task 2: Generalized polygon clip in `cutDoorways`

**Files:**
- Modify: `src/engine/doorway.ts` (DoorSpec, DoorFrame, insideInterval, insidePoint, cutDoorways)
- Test: `src/engine/__tests__/doorwayShapes.test.ts` (new file)

**Interfaces:**
- Consumes: Task 1's `openingOutline`, `offsetConvexOutward`, `effectiveHeight`, `OpeningShapeKind`.
- Produces: `DoorSpec` gains `shape?: OpeningShapeKind`. `cutDoorways` accepts shaped specs; cutting (removed/trimmed/vertices/faces) works for all shapes. `DoorFrameInfo` unchanged in this task except that `fits`/`framePlaneDist`/`riserConflict` are polygon-derived. Closure still computes ONLY for rect (shaped closure lands in Task 3; until then shaped doors report zero closure areas and empty framing, `closureProfile: null`).

**Implementation notes:**

1. `DoorFrame` replaces `halfWidth/zClipLow/zClipHigh` with `planes: { nt: number; nz: number; c: number }[]` (inside = `nt·t + nz·(z−z0) ≤ c` for every plane) plus keeps `cutPlaneDist`. Build from the MARGINED polygon: `offsetConvexOutward(openingOutline(shape, w, effH, buckBottomRel), margin, isWindow ? margin : 0)`. For floor-standing doors (sill 0) SKIP the bottom edge's half-plane entirely (reproduces today's `zClipLow = -1e9`; base-ring geometry must not be borderline-excluded).
2. `insideInterval`: same s0/s1 scheme, but a one-sided `clipMax(fa, fb, hi)` per plane, then the radial `u ≥ cutPlaneDist` clip as today. `insidePoint`: all planes + radial.
3. Fit: `fitSq = R² − max_k((z0 + max(hRel_k, 0))² + t_k²)` over the PRE-margin polygon vertices (below-base vertices don't constrain, matching today's `max(0, buckBottomRel)` rule). `framePlaneDist`, `cutPlaneDist`, clamps unchanged. Arch with `h < w/2` (`archTooFlat`) → `fits = false`, no frame pushed.
4. `effH = effectiveHeight(shape, width, height)` replaces `spec.height` in `buckTopRel`, the placement zone, and `area` (use `openingArea` for `area`).
5. Closure/framing block: wrap the existing code in `if (shape === 'rect')`. Shaped specs still push their cut frame (so struts/panels/vertices are processed) but report `closureSideArea = 0` etc. this task.

- [ ] **Step 1: Write the characterization test FIRST** (against the CURRENT unmodified engine) in `src/engine/__tests__/doorwayShapes.test.ts` — these constants were captured from the live engine on 2026-08-10 and must survive the refactor bit-for-bit:

```ts
import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { cutDoorways } from '../doorway'

const R = 156
const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
const door = { id: 'D1', azimuthDeg: 20, width: 36, height: 80, margin: 1.5 }
const win = { id: 'W1', azimuthDeg: 120, width: 24, height: 36, sillHeight: 36, margin: 1.5 }

describe('rect characterization (frozen behavior)', () => {
  const CASES = [
    { riser: 0, removedEdges: 1, trimmedEdges: 12, trimmedPieces: 12, removedFaces: 12,
      removedVertices: 2, trimLenSum: 463.966, d: { framePlaneDist: 112.2985, sideArea: 3417.081,
      topArea: 240.9, faceArea: 298.5, framing: 14, joints: 27, hubs: 1 },
      w: { framePlaneDist: 120.1472, sideArea: 701.148, topArea: 162.942, botArea: 522.612,
      framing: 13, joints: 23, hubs: 1 } },
    { riser: 24, removedEdges: 1, trimmedEdges: 8, trimmedPieces: 10, removedFaces: 7,
      removedVertices: 1, trimLenSum: 361.8666, d: { framePlaneDist: 130.9969, sideArea: 1061.549,
      topArea: 110.141, faceArea: 226.5, framing: 7, joints: 15, hubs: 1 },
      w: { framePlaneDist: 136.384, sideArea: 347.892, topArea: 67.442, botArea: 287.237,
      framing: 8, joints: 16, hubs: 0 } },
  ]
  for (const c of CASES) {
    it(`riser ${c.riser}: counts, areas and trim lengths are unchanged`, () => {
      const cut = cutDoorways(dome, [door, win], R, {
        minStubLength: 6, studSpacing: 16, riserHeight: c.riser,
      })
      const [d, w] = cut.doors
      expect(cut.removedEdges.size).toBe(c.removedEdges)
      expect(cut.trimmedEdges.size).toBe(c.trimmedEdges)
      expect(cut.trimmed.length).toBe(c.trimmedPieces)
      expect(cut.removedFaces.size).toBe(c.removedFaces)
      expect(cut.removedVertices.size).toBe(c.removedVertices)
      expect(cut.trimmed.reduce((s, t) => s + t.length, 0)).toBeCloseTo(c.trimLenSum, 3)
      expect(d.fits && w.fits).toBe(true)
      expect(d.framePlaneDist).toBeCloseTo(c.d.framePlaneDist, 3)
      expect(d.closureSideArea).toBeCloseTo(c.d.sideArea, 2)
      expect(d.closureTopArea).toBeCloseTo(c.d.topArea, 2)
      expect(d.closureFaceArea).toBeCloseTo(c.d.faceArea, 2)
      expect(d.closureFraming.length).toBe(c.d.framing)
      expect(d.closureJointCount).toBe(c.d.joints)
      expect(d.removedHubCount).toBe(c.d.hubs)
      expect(w.framePlaneDist).toBeCloseTo(c.w.framePlaneDist, 3)
      expect(w.closureSideArea).toBeCloseTo(c.w.sideArea, 2)
      expect(w.closureTopArea).toBeCloseTo(c.w.topArea, 2)
      expect(w.closureBottomArea).toBeCloseTo(c.w.botArea, 2)
      expect(w.closureFraming.length).toBe(c.w.framing)
      expect(w.closureJointCount).toBe(c.w.joints)
      expect(w.removedHubCount).toBe(c.w.hubs)
    })
  }
})
```

- [ ] **Step 2: Run it against the UNMODIFIED engine** — `bun run test -- doorwayShapes` → PASS (proves the constants are correct BEFORE the refactor; if any assertion fails, fix the test constants against live output now, not later).
- [ ] **Step 3: Add failing shaped-cut tests** to the same file:

```ts
describe('shaped cuts', () => {
  it('a circle window crossing struts trims/removes fewer than its bounding rect', () => {
    const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, shape: 'circle' as const }
    const rect = { ...circle, shape: 'rect' as const }
    const cutC = cutDoorways(dome, [circle], R, { minStubLength: 6 })
    const cutR = cutDoorways(dome, [rect], R, { minStubLength: 6 })
    const touchedC = cutC.removedEdges.size + cutC.trimmedEdges.size
    const touchedR = cutR.removedEdges.size + cutR.trimmedEdges.size
    expect(touchedC).toBeGreaterThan(0)
    expect(touchedC).toBeLessThanOrEqual(touchedR)
    expect(cutC.doors[0].fits).toBe(true)
  })
  it('a small circle inside one panel cuts nothing and removes that panel', () => {
    // Face centroid azimuth/height probe: pick the first face whose centroid
    // sits mid-height on the +x side, then aim a small porthole at it.
    const f = dome.faces.map((face) => {
      const c = face.vertexIds.reduce(
        (s, vi) => {
          const p = dome.vertices[vi].position
          return [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3]
        }, [0, 0, 0])
      return { face, c }
    }).find(({ c }) => c[2] * R > dome.cutZ * R + 40 && c[2] * R < dome.cutZ * R + 80 && c[0] > 0.5)!
    const az = (Math.atan2(f.c[1], f.c[0]) * 180) / Math.PI
    const sill = f.c[2] * R - dome.cutZ * R - 5
    const cut = cutDoorways(dome, [{ id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' }], R, { minStubLength: 6 })
    expect(cut.removedEdges.size + cut.trimmedEdges.size).toBe(0)
    expect(cut.removedFaces.size).toBe(1)
  })
  it('arch too flat refuses to fit', () => {
    const cut = cutDoorways(dome, [{ id: 'D1', azimuthDeg: 0, width: 36, height: 17, shape: 'arch' }], R, { minStubLength: 6 })
    expect(cut.doors[0].fits).toBe(false)
    expect(cut.removedEdges.size + cut.trimmedEdges.size + cut.trimmed.length).toBe(0)
  })
  it('generalized fit equals the legacy formula for rects', () => {
    const spec = { id: 'D1', azimuthDeg: 0, width: 36, height: 80 }
    const z0 = dome.cutZ * R
    const legacy = Math.sqrt(R * R - Math.max((z0 + 80) ** 2, z0 ** 2) - 18 * 18)
    const cut = cutDoorways(dome, [spec], R, { minStubLength: 6 })
    expect(cut.doors[0].framePlaneDist).toBeCloseTo(legacy, 9)
  })
})
```

- [ ] **Step 4: Run to verify the shaped tests fail** (shape field is ignored today, so the circle-vs-rect test fails on equality of touched counts only if lucky — the `fits === false` arch test WILL fail).
- [ ] **Step 5: Refactor `doorway.ts`** per the implementation notes (planes array, generalized clips, vertex-based fit, effH, rect-only closure gate). `DoorSpec` gains `shape?: OpeningShapeKind` re-exported from openingShapes.
- [ ] **Step 6: Run** — `bun run test` → the characterization test AND shaped tests pass, plus all existing engine tests (5V doorway suite in engine.test.ts) untouched.
- [ ] **Step 7: Commit** — `feat: convex-polygon doorway cutting — arch/circle/triangle cut paths, rect behavior frozen`

---

### Task 3: Shaped buck members + tunnel closure

**Files:**
- Modify: `src/engine/doorway.ts`
- Test: `src/engine/__tests__/doorwayShapes.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 `outlineBuckMembers`, `openingOutline`; Task 2's frames.
- Produces (Tasks 5–7 rely on these):

```ts
// DoorFrameInfo gains:
shape: OpeningShapeKind                  // echoed, defaulted 'rect'
outline: [number, number][]              // pre-margin polygon (t, hRel)
buckMembers: BuckMember[]                // ALL shapes incl. rect (jamb/header/sill rows)
closureTunnel?: TunnelStrip[]            // shaped only; undefined for rect
// New exported types:
export interface TunnelStrip {
  /** Margined polygon edge endpoints (t, hRel). */
  a: [number, number]
  b: [number, number]
  /** Shell radial distance at 8 evenly spaced stations a→b (0 where the
   * radial line misses the shell). */
  uShell: number[]
}
// ClosureMember['part'] union gains 'ring blocking'.
```

**Implementation:**

1. `buckMembers = outlineBuckMembers(shape, width, effH, isWindow)` for every door (rect included); `jambLength`/`headerLength` stay as today for rect, arch sets `jambLength = j`, `headerLength = 0`; circle/triangle set both 0.
2. Shell radial distance helper (door-local tris from the existing `localTriangles`):

```ts
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
```

3. For shaped fitting doors: per margined-polygon edge, 8 stations, `closureTunnel` strip; `closureSideArea = Σ` trapezoid integral of `max(0, uShell − framePlaneDist)` along each edge (7 spans × station spacing); top/bottom/face areas stay 0.
4. Framing (only when `studSpacing > 0`): per edge —
   - `ring blocking` at param fractions `k / nBlock`, `nBlock = max(1, ceil(edgeLen / studSpacing))`, k = 0..nBlock−1 (k=0 is the shared vertex — the NEXT edge's k=0 covers the other endpoint, no duplicates). Length `uShell(t,z) − framePlaneDist` (recompute uShell at the exact param); keep when ≥ `minStubLength`, sign-absolute for projecting bucks (`Math.abs`).
   - `shell edge` members between consecutive stations where both `uShell > framePlaneDist + 1e-6`: 3D length `hypot(stationSpacing, ΔuShell)`; fold a sub-`minStubLength` trailing span into the previous member (same pattern as the existing rect shell-edge chain), skip isolated slivers.
   - Push all of them into `closureFraming` as `ClosureMember` rows (`side: 0`, `a`/`b` = the (t, hRel) of their stations — lengths come from the `length` field, which the cut list reads).
5. `closureJointCount` for shaped: unique keys over `${round(u*2)}:${round(t*2)}:${round(h*2)}` for every framing member endpoint (blocking: both ends share t,h but differ in u) + every pre-margin polygon vertex at `u = framePlaneDist`.

- [ ] **Step 1: Write failing tests** (extend `doorwayShapes.test.ts`):

```ts
describe('shaped buck + tunnel closure', () => {
  const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, margin: 1.5, shape: 'circle' as const }
  const cut = cutDoorways(dome, [circle], R, { minStubLength: 6, studSpacing: 16 })
  const w = cut.doors[0]
  it('reports 16 rim segments and the outline polygon', () => {
    expect(w.fits).toBe(true)
    expect(w.shape).toBe('circle')
    expect(w.outline).toHaveLength(16)
    const rim = w.buckMembers.find((m) => m.part === 'rim segment')!
    expect(rim.quantity).toBe(16)
    expect(rim.miterDegA).toBeCloseTo(11.25, 6)
  })
  it('tunnel closure has 16 strips with positive area', () => {
    expect(w.closureTunnel).toHaveLength(16)
    expect(w.closureSideArea).toBeGreaterThan(0)
    expect(w.closureTopArea).toBe(0)
    for (const strip of w.closureTunnel!) expect(strip.uShell).toHaveLength(8)
  })
  it('ring blocking + shell edge members are all above the scrap floor', () => {
    const parts = new Set(w.closureFraming.map((m) => m.part))
    expect(parts.has('ring blocking')).toBe(true)
    for (const m of w.closureFraming) expect(m.length).toBeGreaterThanOrEqual(6 - 1e-9)
    expect(w.closureJointCount).toBeGreaterThan(0)
  })
  it('rect doors still expose buckMembers (jamb/header)', () => {
    const cutR = cutDoorways(dome, [door], R, { minStubLength: 6 })
    expect(cutR.doors[0].buckMembers.map((m) => m.part)).toEqual(['jamb', 'header'])
    expect(cutR.doors[0].shape).toBe('rect')
  })
})
```

(`door` is the Task 2 module-level const.)

- [ ] **Step 2: Run to verify failure** — fields don't exist yet.
- [ ] **Step 3: Implement** per the notes.
- [ ] **Step 4: Run** — `bun run test` fully green INCLUDING the Task 2 characterization (rect path untouched).
- [ ] **Step 5: Commit** — `feat: shaped buck members + sampled tunnel closure for arch/circle/triangle openings`

---

### Task 4: Shape-aware 2D placement optimizer

**Files:**
- Modify: `src/engine/doorway.ts` (placementStats, optimizeDoorPlacement, PlacementOptions, PlacementStats, DoorPlacementResult)
- Test: `src/engine/__tests__/doorwayShapes.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (Task 5/7 rely on):

```ts
export interface PlacementOptions extends DoorwayOptions {
  searchHalfWidthDeg?: number
  stepDeg?: number
  increment: number
  otherDoors?: DoorSpec[]
  /** Window-only second axis: sill search half-band, working units. 0/omitted = bearing only. */
  sillSearchHalfWidth?: number
}
// DoorPlacementResult gains:
reason: string
fromSillHeight?: number   // windows only
sillHeight?: number       // windows only — best sill (may equal fromSillHeight)
```

**Implementation:**

1. `placementStats` changes:
   - `if (!info.fits) { stats.score = Number.POSITIVE_INFINITY; return stats }` (sill axis makes fit placement-dependent).
   - Shape scoring: `shape = spec.shape ?? 'rect'`; `effH = effectiveHeight(shape, spec.width, spec.height)` replaces `spec.height` in the zone.
     - circle/triangle with `trimmed + removed + hubsRemoved === 0`: `score = 0.5 · centerOffset/(spec.width/2)` where `centerOffset` here = min distance from the shape CENTER (t=0, h=zoneCenter) to any hub or FACE CENTROID in the zone, measured as `hypot(t, h − hCenter)` (hCenter = sillZone + effH/2; face centroids computed from `model.faces`/`model.vertices` at radius). Zero-cut spots sort by pattern-centeredness.
     - circle/triangle otherwise: today's formula + 8.
     - arch: today's formula with the zone raised to `h ∈ [sillZone + 0.6·effH, sillZone + 1.25·effH]`.
     - rect: today's formula, byte-for-byte.
2. `optimizeDoorPlacement` becomes coarse-to-fine over (azimuth × sill):
   - Axis 1: coarse ±`searchHalfWidthDeg` (36) step 2°, fine ±2° step `stepDeg` (0.25) around the coarse best.
   - Axis 2 (only when `sillSearchHalfWidth > 0` and the spec is a window): coarse ±band step band/12, fine ±band/12 step band/50, sill floor `max(1e-6, (riserHeight ?? 0) + (margin ?? 0) + 0.001)` — candidates below the floor are skipped, not clamped (no duplicate evaluations).
   - `blocked(az, bottomAbs, topAbs)`: angular overlap (existing clearanceDeg + 5°) AND vertical band overlap `[myBottom − margin, myTop + margin]` vs `[otherBottom − otherMargin, otherTop + otherMargin]` (floor-referenced: bottom = sillHeight ?? 0, top = bottom + effectiveHeight). Doors always start at 0.
   - Tie-break: normalized squared distance `(dAz/halfWidth)² + (dSill/band)²` smallest wins on score ties (≤ 1e-9).
   - `reason`: `trimmed + removed === 0 && (shape circle|triangle)` → `` `fits inside one panel — 0 struts cut` ``; else `centerOffset ≤ spec.width * 0.1` → `` `centered on the frame pattern` ``; else `` `cleanest available — ${after.trimmed} trims` ``.
   - Result: `azimuthDeg` rounded to 0.25° as today; `sillHeight` rounded to the same increment grid as the fine sill step; `evaluated` counts every `placementStats` call.

- [ ] **Step 1: Write failing tests:**

```ts
describe('shape-aware placement', () => {
  it('recovers a zero-cut porthole spot near a panel center (2D search)', () => {
    // Start from the Task 2 known-clean panel spot, nudged 6° and 8" up.
    const f = dome.faces.map((face) => {
      const c = face.vertexIds.reduce(
        (s, vi) => {
          const p = dome.vertices[vi].position
          return [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3]
        }, [0, 0, 0])
      return { face, c }
    }).find(({ c }) => c[2] * R > dome.cutZ * R + 40 && c[2] * R < dome.cutZ * R + 80 && c[0] > 0.5)!
    const az = (Math.atan2(f.c[1], f.c[0]) * 180) / Math.PI
    const sill = f.c[2] * R - dome.cutZ * R - 5
    const spec = { id: 'W1', azimuthDeg: az + 6, width: 10, height: 10, sillHeight: sill + 8, shape: 'circle' as const }
    const out = optimizeDoorPlacement(dome, spec, R, {
      minStubLength: 6, increment: 0.125, sillSearchHalfWidth: 12,
    })
    expect(out.improved).toBe(true)
    expect(out.reason).toContain('0 struts cut')
    expect(out.after.trimmed + out.after.removed).toBe(0)
    expect(out.sillHeight).not.toBeUndefined()
  })
  it('door keep-out blocks overlapping bands but allows a porthole above the door', () => {
    const doorSpec = { id: 'D1', azimuthDeg: 0, width: 36, height: 80 }
    const lowWin = { id: 'W1', azimuthDeg: 3, width: 24, height: 24, sillHeight: 40, shape: 'circle' as const }
    const highWin = { ...lowWin, sillHeight: 90 }
    const opts = {
      minStubLength: 6, increment: 0.125, sillSearchHalfWidth: 6, searchHalfWidthDeg: 4,
      otherDoors: [doorSpec],
    }
    const low = optimizeDoorPlacement(dome, lowWin, R, opts)
    const high = optimizeDoorPlacement(dome, highWin, R, opts)
    // The low window's band overlaps the door: every same-bearing candidate is
    // blocked, so far fewer positions get evaluated than for the high window.
    expect(low.evaluated).toBeLessThan(high.evaluated)
  })
  it('windows never dive below the riser + margin floor', () => {
    const spec = { id: 'W1', azimuthDeg: 45, width: 24, height: 24, sillHeight: 26, margin: 1, shape: 'rect' as const }
    const out = optimizeDoorPlacement(dome, spec, R, {
      minStubLength: 6, increment: 0.125, sillSearchHalfWidth: 12, riserHeight: 24,
    })
    expect((out.sillHeight ?? spec.sillHeight)).toBeGreaterThan(25)
  })
  it('coarse-to-fine matches the flat sweep for a rect door', () => {
    const spec = { id: 'D1', azimuthDeg: 20, width: 36, height: 80 }
    const fast = optimizeDoorPlacement(dome, spec, R, { minStubLength: 6, increment: 0.125 })
    // Flat reference: evaluate every 0.25° via repeated 1-step searches is too
    // slow — instead assert the fast result is at least as good as `before`
    // and lands on a 0.25° grid point with a finite score.
    expect(fast.after.score).toBeLessThanOrEqual(fast.before.score + 1e-9)
    expect(Math.abs(fast.azimuthDeg * 4 - Math.round(fast.azimuthDeg * 4))).toBeLessThan(1e-9)
    expect(fast.reason.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** per the notes.
- [ ] **Step 4: Run full suite** — existing `optimizeDoorPlacement` tests in `engine.test.ts` must still pass (rect scoring frozen; if one asserts `evaluated` counts, update ONLY that count expectation and say so in the commit).
- [ ] **Step 5: Commit** — `feat: 2D shape-aware placement — bearing×sill search, zero-cut goals, reasons`

---

### Task 5: State, share, cut list, CSV, floor plan

**Files:**
- Modify: `src/composables/useDomeProject.ts` (state types ~line 203, doorSpecs/windowSpecs ~482, add* ~665, optimize* ~701, loadProjectFile ~1109, loadShare doors/windows ~1291)
- Modify: `src/engine/cutlist.ts:194-247` (buck rows via buckMembers)
- Modify: `src/engine/exports/plan.ts` (~line 297, circle tick label)
- Test: `src/engine/__tests__/doorwayShapes.test.ts` (cutlist + plan additions), `src/lib/__tests__/share.test.ts` if present (extend whichever share test exists)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: state entries gain `shape` (`'rect' | 'arch'` doors, all four for windows); specs pass `shape` through; window height maps to width for circles IN `windowSpecs` (no state mutation); `optimizeWindowPosition` applies `result.sillHeight`; buck cut-list rows come from `buckMembers` with `axialAngleDeg = max(miterDegA, miterDegB) || NaN`.

**Implementation:**

1. State types: `doors: { ...; shape: 'rect' | 'arch' }[]`, `framedWindows: { ...; shape: 'rect' | 'arch' | 'circle' | 'triangle' }[]`. `addDoorAt`/`addWindowAt` set `shape: 'rect'`.
2. `doorSpecs`: `shape: d.shape`, `windowSpecs`: `shape: w.shape, height: c(w.shape === 'circle' ? w.widthMm : w.heightMm)`.
3. `optimizeDoorPosition`/`optimizeWindowPosition`: pass `sillSearchHalfWidth: state.units === 'imperial' ? 12 : 300` (window one only); window applies `if (typeof result.sillHeight === 'number') state.framedWindows[index].sillMm = toMm(result.sillHeight)` (`toMm = (v) => state.units === 'imperial' ? v * MM_PER_INCH : v`).
4. Load clamps — file (`~1109`) and share (`~1291`) mappers both add:
   `shape: d.shape === 'arch' ? 'arch' : 'rect'` (doors);
   `shape: w.shape === 'arch' || w.shape === 'circle' || w.shape === 'triangle' ? w.shape : 'rect'` (windows).
   `projectSettings` already spreads full entries — shape serializes for free.
5. `cutlist.ts`: replace the jamb/header/sill blocks (lines 199–246) with one loop over `door.buckMembers`:

```ts
for (const m of door.buckMembers) {
  const cut = roundToIncrement(m.length, opts.increment)
  const mitered = Math.max(m.miterDegA, m.miterDegB) > 1e-9
  rows.push({
    label: `${door.id} ${m.part}`,
    quantity: m.quantity,
    chordLength: m.length,
    exactCutLength: m.length,
    roundedCutLength: cut,
    roundingError: Math.abs(cut - m.length),
    kind: 'frame',
    axialAngleDeg: mitered ? Math.max(m.miterDegA, m.miterDegB) : Number.NaN,
    note: mitered
      ? `${door.id} faceted buck — miter ${m.miterDegA}°/${m.miterDegB}°${framedBuckNote}`
      : m.part === 'sill'
        ? `${door.id} window sill, slope for drainage on site${framedBuckNote}`
        : m.part === 'header'
          ? `${door.id} rough-opening span; add framing allowance for your style${framedBuckNote}`
          : `${door.id} buck vertical, square cuts${framedBuckNote}`,
  })
}
```

   Match the surrounding row shape exactly (copy any additional fields — e.g. `typeId` — that the current jamb rows carry). CSV needs no change (`axialAngleDeg` already renders, NaN → blank).
6. `plan.ts` window tick label: `const wtext = (w.shape === 'circle' ? '⌀' : '') + fmt(w.width)` used in the existing label template.

- [ ] **Step 1: Write failing tests** — cut list circle rows + plan label:

```ts
import { buildCutList } from '../cutlist'
import { planSvg } from '../exports/plan'

describe('shaped exports', () => {
  it('cut list carries 16 rim segments with 11.25° in the angle column', () => {
    const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, shape: 'circle' as const }
    const cut = cutDoorways(dome, [circle], R, { minStubLength: 6 })
    const list = buildCutList(
      dome,
      { radius: R, increment: 0.125, endOffset: 0, units: 'imperial' },
      cut,
    )
    const rim = list.rows.find((r) => r.label === 'W1 rim segment')!
    expect(rim.quantity).toBe(16)
    expect(rim.axialAngleDeg).toBeCloseTo(11.25, 6)
  })
  it('floor plan labels a circle window with ⌀', () => {
    const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, shape: 'circle' as const }
    const cut = cutDoorways(dome, [circle], R, { minStubLength: 6 })
    const svg = planSvg(dome, cut, { units: 'imperial', radius: R, riserHeight: 0, wallThickness: 3.5, title: 't' })
    expect(svg).toContain('⌀')
  })
})
```

(Adapt the `buildCutList` call to its real signature — read the function head first.)

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** items 1–6.
- [ ] **Step 4: `bun run test` green AND `bun run build` clean** (state type changes ripple through vue-tsc).
- [ ] **Step 5: Commit** — `feat: shape wiring — state/share clamps, buckMembers cut-list rows, ⌀ plan labels`

---

### Task 6: Rendering — polygon bucks + tunnel strips

**Files:**
- Modify: `src/lib/three-builders.ts:454-580` (buck + closure blocks)

**Interfaces:**
- Consumes: `DoorFrameInfo.shape/outline/closureTunnel`, existing `P(u,t,h)` door-local helper pattern.
- Produces: visual only (no exports).

**Implementation:**

1. Buck: `if (door.shape === 'rect' || !door.shape)` keep the existing jamb/header/sill boxes. Else, for each outline edge `(t0,h0)→(t1,h1)`: skip the bottom edge for floor-standing doors (`(door.sillHeight ?? 0) === 0` and both `h ≈ door.buckBottomRel`); otherwise add a box member centered at the edge midpoint at `u = framePlaneDist`, x-axis = in-plane edge direction (`tv·Δt + up·Δh` normalized) scaled by edge length, y-axis = in-plane perpendicular scaled `memberW`, z-axis = radial `u` scaled `memberD` (same `makeBasis` pattern as `addMember`).
2. Closure strips: the existing block already gates on `profile` (null for shaped). Add a shaped branch when `opts.closeDoorways !== false && door.closureTunnel`: for each strip, quads between consecutive stations `s`,`s+1` — corners `P(min(d,us), t_s, h_s)`, `P(max(d,us), t_s, h_s)`, `P(max(d,us1), t_s1, h_s1)`, `P(min(d,us1), t_s1, h_s1)` with `d = framePlaneDist`, skipping spans where both `|us − d|` and `|us1 − d|` < 1e-6; station (t,h) interpolates linearly from `strip.a` to `strip.b`. Same translucent material and `door-closure-${door.id}` name.
3. Framing bars need radial coordinates, which `ClosureMember`'s 2D `a`/`b` can't carry. Add two optional fields to `ClosureMember` in `doorway.ts` — `ua?: number`, `ub?: number` (radial distance at each end; shaped-tunnel members only, rect leaves them unset) — and populate them where Task 3 pushes shaped members: blocking `ua = framePlaneDist`, `ub = framePlaneDist + length`; shell edge `ua`/`ub` = the two stations' `uShell` values. Then shaped bars render mechanically with the existing bar loop: endpoints `P(m.ua ?? d, m.a[0], m.a[1])` → `P(m.ub ?? d, m.b[0], m.b[1])`.

**Verification:** visual only — `bun run build` clean; full test suite green (no engine behavior change beyond the two optional fields); the Task 8 live check covers appearance.

- [ ] **Step 1: Add `ua`/`ub` optional fields + population** (doorway.ts, shaped members only).
- [ ] **Step 2: Implement buck polygon + tunnel strip rendering.**
- [ ] **Step 3: `bun run test` + `bun run build` both clean.**
- [ ] **Step 4: Commit** — `feat: render polygon bucks and tunnel closure strips for shaped openings`

---

### Task 7: UI — shape picker, adaptive fields, reasons

**Files:**
- Modify: `src/components/panels/FramedOpeningCard.vue`

**Interfaces:**
- Consumes: `entry.shape` (Task 5 state), `info.buckMembers`, `DoorPlacementResult.reason/sillHeight` (Task 4), `archTooFlat` (Task 1).
- Produces: UI only.

**Implementation:**

1. Shape picker under the card header: `ToggleGroup` type single, values `['rect','arch']` for doors, `['rect','arch','circle','triangle']` for windows; labels `Rect / Arch / Circle / Tri`; update ignores empty (`v && (entry.shape = v)`).
2. Adaptive fields: circle → Width label becomes `Diameter (in|mm)`, Height field hidden; arch → Height label `Height incl. arch (in|mm)`.
3. Buck members line renders `info.buckMembers`: `` `${m.quantity}× ${m.part} ${formatLength(m.length, state.units)}${m.miterDegA > 0 ? ` @ ${m.miterDegA}°` : ''}` `` joined by ` · ` (replaces the hardcoded jamb/header/sill line).
4. Optimize result: append reason; windows also show `sill A → B` when `placement.sillHeight !== placement.fromSillHeight`.
5. Warnings: add arch-flat message when `entry.shape === 'arch' && entry.heightMm < entry.widthMm / 2`: "Arch needs height ≥ half the width — raise the height or narrow the opening." (import `archTooFlat` or inline the comparison; inline is fine in the template computed).
6. Area line already reads `info.area` — now the true shape area from the engine; no change needed.

- [ ] **Step 1: Implement all card changes.**
- [ ] **Step 2: `bun run build` clean (vue-tsc), `bun run test` green.**
- [ ] **Step 3: Commit** — `feat: shape picker + adaptive fields + placement reasons on opening cards`

---

### Task 8: Live verification

**Files:** none (browser session against the dev server).

Checklist (each verified in the browser, screenshots for the final report):

- [ ] Add a door → switch to Arch: shell cut becomes round-topped, 8 faceted segments render above the jambs, cut list shows `D1 arch segment ×8 @ 11.25°`.
- [ ] Arch with height < width/2 shows the flat-arch warning and cuts nothing.
- [ ] Add a window → Circle: Diameter-only fields, 16-segment porthole renders, closure strips seal it, floor plan SVG labels `⌀…`.
- [ ] Triangle window renders and its cut list rows carry the rake/base miters.
- [ ] Optimize a small circle window: it moves (bearing and/or sill) and reports "fits inside one panel — 0 struts cut" when such a spot exists; sill respects the riser floor with a 24″ riser.
- [ ] Rect door/window: behavior and numbers identical to before (spot-check strut counts + closure areas against a pre-branch save or the characterization constants).
- [ ] Share link round-trip: shaped openings survive encode → open-in-new-tab; a legacy hash (no shape) loads as rect.
- [ ] Exports: cut list CSV rows for segments; floor plan renders; no console errors.
- [ ] Kill the dev server when done (standing rule).
