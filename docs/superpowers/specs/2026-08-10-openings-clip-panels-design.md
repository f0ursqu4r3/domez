# Openings Clip Panels — Design Spec

**Date:** 2026-08-10
**Status:** Approved for planning

## Summary

Openings stop deleting whole panels. A panel crossed by an opening
envelope survives as a CLIPPED panel — its true remaining shape — for
skin takeoff, rendering, framed-panel frames, jigs, and packing. Only
panels fully inside the envelope are removed. In framed-panel mode the
orphan centerline "trimmed stick" rendering and its † cut-list rows are
replaced by the clipped panels' own members — this also fixes the
misaligned floor-strut artifact (a base-ring stub of a deleted panel
rendered with the wrong offset/roll next to in-plane doubled members).

## Root cause being fixed (user report, Z10 55° 5-row arch door)

- `cutDoorways` removes any face the envelope touches; panel layers
  then drop any unit that lost ANY face. An arch door with margin 12″
  removed 5 faces → 3 rhombus panels (2 only partially inside).
- The deleted panels' surviving edge remnants still rendered as generic
  centerline sticks in framed-panel mode → "misaligned floor strut."

## Decisions (from brainstorming)

1. Clipping applies to ALL panel surfaces (skin takeoff, surface view,
   framed-panel frames). Hub/pipe/timber/mitered STRUT trimming is
   unchanged.
2. A clipped framed panel gets a member along the cut edge — every
   clipped frame is closed. Clipped panels are one-off site-fit types.
3. Framed-panel mode renders members only from panel outlines; generic
   trimmed sticks are suppressed there (kept for hub-style modes), and
   framed-mode cut lists drop the † stick rows.

## Clipping core (`src/engine/panelClip.ts`, new)

### Panel units

`panelUnits(model): { ring: number[]; faceIds: number[] }[]` — the
polys → rhombi + leveled fill → faces derivation currently duplicated
in `three-builders.ts` (which carries a "keep in sync by hand" warning)
moves into the engine; three-builders imports it. All units are convex.

### Opening prisms

`doorway.ts` exports the cut regions it already builds internally:

```ts
export interface OpeningPrism {
  doorId: string
  ux: number; uy: number; z0: number
  /** Inside = every nt·t + nz·(z − z0) ≤ c AND u ≥ cutPlaneDist. */
  planes: { nt: number; nz: number; c: number }[]
  cutPlaneDist: number
}
export function openingPrisms(model, doors, radius, opts): OpeningPrism[]
```

Same construction as the strut clip (margined polygon, skipped bottom
half-plane for floor doors, riser-conflicted doors yield no prism) —
factored, not duplicated.

### Clip

Every prism constraint is linear in world coordinates, so on a panel's
plane it is a 2D half-plane; the prism ∩ plane is one convex region.
Subtraction uses the convex-difference decomposition — fragments
`F_i = panel ∩ H̄_i ∩ H_0 ∩ … ∩ H_{i−1}` over the region's half-planes —
which needs only Sutherland–Hodgman convex clips and yields disjoint
convex fragments. Multiple openings subtract sequentially (fragments
stay convex). Degenerate slivers (area < 1e-6·panel area) are dropped.

```ts
export interface ClippedPanel {
  unitIndex: number
  ring: number[]
  faceIds: number[]
  status: 'whole' | 'clipped' | 'removed'
  /** Disjoint convex fragments, world scale (working units), CCW seen
   * from outside. Empty for 'removed'; the original ring for 'whole'. */
  fragments: Vec3[][]
  /** Boundary loops: outer CCW / holes CW (signed area vs the panel
   * normal). Derived from fragment edges — internal shared edges cancel
   * (rounded-key dedup), the rest chain into closed loops. */
  loops: { pts: Vec3[]; cut: boolean[] }[]
  /** cut[i] true = edge i lies on a prism plane (opening interface);
   * false = it survives from the original outline. */
  area: number
}
export function clipPanels(model, radius, prisms): ClippedPanel[]
```

Status: `removed` when every ring vertex is inside some single prism
(convex ⊆ convex test) or surviving area < 1e-6·panel area; `whole`
when no prism region overlaps (fragment area ≈ panel area and no cut
edges); else `clipped`. Handles the three survival shapes: corner nick
(one loop), full crossing (two disjoint loops), opening fully interior
(outer loop + hole loop — e.g. a porthole inside one zome rhombus).

## Integration

### Skin takeoff (`useDomeProject.ts` panelPlan)

Whole panels follow today's path (triangles / whole rhombi / polys).
Clipped panels contribute their true `area` and enter sheet packing as
their outer-loop bounding rectangle (conservative material), labeled
site-fit. Removed panels contribute nothing. The current
"exclude removedFaces / dead rhombi" logic is replaced by clip status.

### Framed panels (`panelFrames.ts`)

`buildPanelFrames` consumes clip results:

- `whole` panels: signature grouping exactly as today (F1, F2, …).
- `clipped` panels: one-off types labeled X1, X2, … with
  `siteFit: true`; one member per loop edge (holes included — the buck
  rim), long-point length = edge length, miters = half the interior
  angle at each loop corner (existing corner convention); members on
  `cut` edges carry a "cut edge — fits the opening closure" note.
- Seams/bolts: an original shared edge contributes seam length equal to
  the overlap of the two sides' surviving intervals along that edge
  (parameterize the edge 0..1; each side's surviving sub-intervals come
  from its loops' non-cut edges lying on that model edge). Bolt count
  from the overlap length as today; an edge with no overlap is no seam.

### Rendering (`three-builders.ts`)

- Framed mode: member solids render per kept panel loop edge (whole
  panels unchanged; clipped panels from their loops, in-plane like
  today — cut-edge members use the panel color default since they have
  no model edge id). The `struts-trimmed` mesh is NOT built in framed
  mode. `panelUnits` import replaces the local duplicate.
- Surface / skin rendering: faces of `whole` panels render as today;
  `clipped` panels render their fragments (fan-triangulated); `removed`
  render nothing. The hole in the skin equals the opening envelope.

### Cut list (`cutlist.ts`)

Framed mode (`jointId === 'framed-panel'` with a framePlan): skip the
trimmed-piece rows (the † block); clipped panels' members arrive via
the framePlan rows like every other frame type, site-fit noted. Other
joint methods unchanged (sticks are real parts there).

### Jigs and patterns

- Frames jig SVG: X-types render through the existing per-type path
  (outline + holes polygons, member annotations from the type's
  members; `edgeMemberIdx` provenance extends to loop edges).
- Assembly-guide panel patterns: clipped skin pieces are one-off
  patterns drawn from outer loop + holes with a site-fit caption.

### Unchanged

Loads, floor plan, share codec (no new state), riser, hub/pipe/
timber/mitered strut trimming and their cut lists, closure tunnels and
bucks. `cutDoorways` keeps producing `removedFaces`/`trimmed` — hub
modes still consume them; the panel layer just stops using
`removedFaces` for whole-unit deletion.

## Testing (vitest)

- Golden repro (Z10 sides 10, 55°, 5 rows, leveled, R for ⌀26 ft, arch
  door 36×80 depth 18 margin 12 @ 288°): 3 units clipped, 0 whole
  units dropped; every prior † stick length is
  covered by some clipped-loop cut-edge geometry; conservation —
  Σ clipped areas + Σ whole areas = Σ original areas − (area inside the
  prism), within 1%.
- Loop invariants on every clipped panel: loops closed (first = last
  neighbor chain), no internal edges remain, outer loop CCW / holes CW,
  fragment areas sum to loop-signed-area sum (1e-6 rel).
- Porthole-in-rhombus: small circle window centered inside one Z8 or
  Z10 rhombus → that panel `clipped` with 2 loops (outer 4 original
  edges uncut, inner 16 cut edges), frame type gains 16 hole-rim
  members.
- Split case: narrow tall rect door crossing the middle of a big
  rhombus → 2 disjoint loops, both closed.
- Framed cut list: no `kind === 'trimmed'` rows when framePlan active;
  X-type rows present with site-fit note. Hub-mode cut list unchanged
  byte-for-byte on the golden repro (same model, jointId 'hub').
- Seam overlap: two adjacent clipped panels sharing a partially
  surviving edge → seam length equals the surviving overlap, bolts
  recomputed; a fully-cut shared edge yields no seam.
- panelUnits extraction: three-builders and engine agree (unit test on
  the derivation for a zome with leveled fill + a goldberg model).

## Out of scope

- Clipping strut-based (hub/pipe/timber/mitered) skin sheet OPTIMIZATION
  beyond bounding-rect packing for clipped pieces.
- Re-optimizing opening placement to minimize clipped panels (the
  optimizer's zero-cut goals already reward panel-interior placements).
- Curved/exact circular cut edges on jigs (facets only, as everywhere).
