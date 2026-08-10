# Openings — Shapes + Shape-Aware Placement Design Spec

**Date:** 2026-08-10
**Status:** Approved for planning

## Summary

Framed openings gain shapes: doors rect | arch, windows rect | arch |
circle | triangle. Every shape canonicalizes to one convex polygon in
buck-plane coordinates and one generalized cutting path. The placement
optimizer becomes 2D for windows (bearing × sill) with shape-aware
scoring and a human-readable reason.

## Decisions (from brainstorming)

1. Shapes: rect + arch + circle + triangle (hex/pentagon declined).
2. Window search: 2D bearing + sill, coarse-to-fine.
3. Scoring: shape-aware goals (zero-cut bonus for circle/triangle, apex
   centering for arch, existing score for rect) with per-result reason.
4. Optimizer stays per-opening; keep-outs extend to windows.

## Shape model (`src/engine/doorway.ts`)

`DoorSpec` gains `shape?: OpeningShapeKind` where
`OpeningShapeKind = 'rect' | 'arch' | 'circle' | 'triangle'`; default
`'rect'` (old projects and share links load unchanged). Doors allow
rect | arch; windows allow all four.

Each shape produces a convex polygon in door-local coordinates
(t tangential, hRel height above the BASE plane), CCW order. Let
`b = buckBottomRel` (floor-referenced bottom minus riser, as today):

- **rect** — `(±w/2, b)`, `(±w/2, b+h)`.
- **arch** — jamb height `j = h − w/2` (requires `h ≥ w/2`; when the
  user sets `h < w/2`, `fits = false` with a card warning). Two bottom
  corners `(±w/2, b)`, spring points `(±w/2, b+j)`, then the top half of
  a regular 16-gon INSCRIBED in the semicircle of radius `w/2` centered
  at `(0, b+j)` — 8 chord segments, 7 intermediate vertices, chord
  length `2·(w/2)·sin(π/16)`.
- **circle** — `height` ignored (state keeps `heightMm` synced to
  `widthMm`); regular 16-gon inscribed in the circle of diameter `w`
  centered at `(0, b + w/2)`, oriented flat-bottom/flat-top (vertices at
  angles `−90° + (k + 0.5)·22.5°`), so the sill and header segments are
  horizontal.
- **triangle** — isosceles point-up: `(±w/2, b)`, `(0, b+h)`.

Inscribed facets mean the flats cut inside the ideal curve by the
sagitta `r(1 − cos(π/16)) ≈ 0.019r` — under the usual 1/2″ shim space
for any door-sized opening. The guide copy notes it (curved units need
that much extra margin if the fit is tight).

## Cutting (generalized clip)

`insideInterval` / `insidePoint` replace the tangential + vertical slab
pair with sequential half-plane clips against the convex polygon's
edges: each edge contributes `n_t·t + n_z·(z − z0) ≤ c` (outward normal
n, same `clip()` mechanics with lo = −∞). The radial clip
(`u ≥ cutPlaneDist`) is unchanged. For a rect the half-planes are
exactly today's four bounds — a regression test pins identical
`cutDoorways` output (removed/trimmed/hub counts, trimmed lengths,
closure areas) on the 3V 1/2 leveled reference dome.

**Margin** becomes a convex outward offset: move each edge out by
`margin` along its normal, re-intersect adjacent edges. For
floor-standing doors (`sillHeight` 0) the bottom edge does NOT offset
(today's behavior: nothing is cut below the base). Windows offset all
edges (today's above-AND-below margin).

**Fit test** generalizes from the two rect corners to all polygon
vertices: `fitSq = R² − max_k((z0 + hRel_k)² + t_k²)` using the
pre-margin polygon (today's formula is the rect special case);
`framePlaneDist = √fitSq − extraDepth`, clamped as today. Riser
conflict uses the shape's bounding box: door top ≤ 0 → conflict;
window bottom − margin < 0 → conflict (unchanged rules, bbox-fed).

## Buck members

`DoorFrameInfo` gains:

- `shape: OpeningShapeKind` (echoed, defaulted).
- `outline: [number, number][]` — the pre-margin polygon (t, hRel), for
  rendering and tests.
- `buckMembers: BuckMember[]` where
  `BuckMember = { part: string; length: number; miterDegA: number; miterDegB: number; quantity: number }`
  (miter per end, degrees; 0 = square cut. Amended from a single
  symmetric `miterDeg`: triangle rakes carry different base and apex
  miters). This list is the
  single source for cut list / CSV / card display for ALL shapes:
  - rect door: `2× jamb` (square), `1× header` (square); rect window
    adds `1× sill`.
  - arch: `2× jamb` length j (square bottom, square top — the arch
    seats on the flat spring line), `8× arch segment` chord length,
    miter 11.25° each end.
  - circle: `16× rim segment`, miter 11.25° each end.
  - triangle: `2× rake` and `1× base` with corner half-angle miters
    (apex angle from w and h).
- `jambLength`/`headerLength` remain (rect/arch semantics; 0 for
  circle) so existing consumers keep working.

## Closure (shaped openings)

Rect keeps the existing closure path untouched (walls + top/bottom
planes, stud framing, riser interplay — proven code).

Shaped openings get a tunnel closure: for each margin-offset polygon
edge, the strip between the shell section and the buck plane.
Per (t, hRel) point the shell radial distance `uShell` comes from
intersecting the radial line with the shell triangles (existing
local-coordinate machinery). Per edge, sample 8 stations:

- strip area = trapezoid integral of `max(0, uShell − framePlaneDist)`
  along the edge → summed into `closureSideArea` (single figure; top /
  bottom / face areas stay 0 for shaped openings, and the card shows
  one "closure" number).
- framing: one `shell edge` member per station-to-station polyline
  span of the shell section, plus radial members of a new part
  `'ring blocking'` at every polygon vertex and at intervals ≤
  `studSpacing` along each edge, each spanning buck plane → shell,
  dropped under
  `minStubLength`. Members carry the same `ClosureMember` shape with
  `side: 0` and (t, hRel) endpoints in `a`/`b` for rendering.
  `ClosureMember['part']` union gains `'ring blocking'`.
- `closureProfile` stays null for shaped openings; rendering uses
  `outline` + per-edge `uShell` station data, exposed as
  `tunnel: { edge: [number, number][]; uShell: number[] }[]` on a new
  optional `DoorFrameInfo.closureTunnel` field.

## Placement optimizer

`optimizeDoorPlacement` keeps its signature; `PlacementOptions` gains
`sillSearchHalfWidth?: number` (default 300 mm working units, only used
for windows) and internals become coarse-to-fine:

- Doors: bearing-only, as today (±36°), coarse 2° then refine ±2° at
  0.25° around the best. (Same optimum as the flat sweep, ~10× fewer
  evaluations — needed because shaped cuts cost the same per call.)
- Windows: coarse grid 2° × 25 mm over ±36° × ±sillSearchHalfWidth
  (sill clamped to ≥ riser + margin and to fitting), refine ±2° ×
  ±25 mm at 0.25° × 6 mm.

Shape-aware score (replaces the single formula; rect keeps today's
exact formula):

- circle / triangle: if `trimmed + removed === 0` (fits inside one
  panel, no struts touched) → `score = centerOffset / (w/2)` (tiny;
  ties prefer pattern-centered). Else today's formula + 8 flat penalty.
  `centerOffset` for zero-cut placements measures distance from the
  shape center to the nearest PANEL CENTROID or hub (whichever is
  nearer) instead of strut midlines.
- arch: today's formula, with the centering zone raised to
  `h ∈ [sillZone + 0.6·height, sillZone + 1.25·height]` (instead of the
  full-height band) so the crown lands on a hub or strut line.
- `DoorPlacementResult` gains `reason: string` and windows gain
  `fromSillHeight` / `sillHeight` fields (unchanged = same value).
  Reasons: `"fits inside one panel — 0 struts cut"`,
  `"centered on the frame pattern"`, `"cleanest available — N trims"`.

Keep-outs: `otherDoors` renames in behavior only — an opening blocks a
candidate only when angular spans overlap (existing width-based
clearance + 5°) AND vertical bands `[bottom − margin, top + margin]`
overlap. A porthole above a door at the same bearing is legal. The
composable passes doors + windows as neighbors for both optimizers.

## State, share, persistence (`useDomeProject.ts`)

- `state.doors[i]` gains `shape?: 'rect' | 'arch'`;
  `state.framedWindows[i]` gains
  `shape?: 'rect' | 'arch' | 'circle' | 'triangle'`. Default `'rect'`.
- Share codec: emit `shape` only when ≠ `'rect'`. `loadProjectFile`
  clamps to the per-kind allowed set (unknown → `'rect'`).
- Circle sync: setting shape to circle copies `widthMm` into
  `heightMm`; width edits keep them synced while shape is circle.
- `optimizeWindowPosition` applies both `azimuthDeg` and the returned
  sill.

## UI (`FramedOpeningCard.vue`)

- Shape picker: ToggleGroup (text labels, xs) — doors Rect | Arch,
  windows Rect | Arch | Circle | Tri.
- Adaptive fields: circle shows Diameter (width) and hides Height;
  arch height label reads "Height (incl. arch)".
- Buck members line renders from `buckMembers`
  (e.g. `8× arch segment 7 3/4″ @ 11.25°`).
- Optimize result line shows `reason`, and the sill move for windows.
- Arch too-flat warning (`h < w/2`) alongside the existing fit warning.

## Rendering (`DomeViewer.vue` / three-builders)

- Buck rendering generalizes: one box member per `buckMembers` segment
  laid along the outline polygon edges in the buck plane (rect
  unchanged visually).
- Shaped closure: translucent strips from `closureTunnel` (fan/quad
  strip per edge between shell section and buck plane); rect closure
  rendering unchanged.

## Exports

- Cut list (`cutlist.ts`): buck rows route through `buckMembers` for
  all shapes — row label carries the part and miter
  (`D1 arch segment`, angle column 11.25 where the schema has one;
  otherwise in the label). CSV mirrors.
- Floor plan (`plan.ts`): door gaps unchanged; window tick label for a
  circle reads `⌀24″ @ 45° · sill 36″`.
- Assembly guide / templates: no changes this feature.

## Testing (vitest)

- Rect regression: `cutDoorways` metrics identical pre/post refactor
  (3V 1/2 leveled, radius 156, door 36×80 + window 24×36 sill 36,
  margin 1.5, riser 0 and 24).
- Outline geometry: arch = 11 vertices, chord lengths equal
  `2r·sin(π/16)`; circle 16-gon flat-bottom (two horizontal segments);
  triangle apex at `(0, b+h)`; convexity of every margin-offset
  polygon.
- Clip: circle window centered in a known 3V panel → 0 struts cut,
  1 panel removed; the same circle moved onto a strut → that edge
  trimmed/removed.
- Fit: generalized vertex fit equals the old rect formula on rect
  specs; arch with `h < w/2` → `fits = false`.
- Buck members: circle → 16 rim segments @ 11.25°; triangle miters
  match apex/base half-angles.
- Closure tunnel: strip areas > 0 for a fitting circle window crossing
  struts; every blocking member ≥ minStubLength; members chain
  (shared endpoints within tolerance).
- Optimizer: porthole placed 3″ off a panel center on 3V recovers a
  zero-cut spot (reason contains "0 struts"); window keep-out blocks an
  overlapping band but allows a porthole above a door at the same
  bearing; sill moves within the band; riser + margin floor respected.
- Share: shape round-trips; legacy payload without shape loads as
  rect; invalid shape clamps to rect.

## Out of scope

- Whole-layout ("optimize all") pass, glazing/mullion detail,
  hex/pentagon shapes, shaped panel-painted openings, arch/circle
  cuts through the riser wall band (circle/triangle windows must clear
  the riser as today; the arch door's below-base portion is
  rectangular).
