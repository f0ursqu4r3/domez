# Framed Panels ("Double Wall") — Design Spec

**Date:** 2026-08-10
**Status:** Approved for planning

## Summary

A fifth joint method, available in all three structure families: each face
(triangle / rhombus / hex / pent) is built as an independent framed panel —
dimensional lumber on edge around the perimeter, corners mitered in-plane,
mating edges beveled at half the seam dihedral — and panels bolt together
edge-to-edge. Every interior seam carries doubled lumber ("double wall");
no hub hardware exists. Outputs: per-type frame schedule, printable jig
drawings, frames CSV, seam-bolt BOM, and true-size 3D rendering with
visible doubled seams.

## Decisions (from brainstorming)

1. Method confirmed: classic panelized construction (jig-built panels,
   beveled mating edges, bolted seams).
2. Placement: 5th `JOINT_METHODS` entry `framed-panel`, label
   "Framed panels (double wall)" — flows through the existing jointId
   gates like `mitered` did.
3. v1 scope: schedule + jig drawing SVG + 3D + CSV + BOM. Openings mean
   "omit the affected panels and frame the opening on site" (disclosed);
   partial door panels are a possible follow-up.

## Geometry (engine: `src/engine/panelFrames.ts`)

Units: working units (radius-scaled), angles in degrees.

- **Panel unit** = the pairing group: geodesic → each face; zome → each
  rhombus (`model.rhombi`); goldberg → each polygon (`model.polys`).
  Leveled-zome fill triangles and clipped goldberg partials are panels too
  (their pairing entries or bare faces).
- **Panel plane**: triangle exact; rhombus planar by construction;
  goldberg polygons flattened by projecting outline vertices onto their
  Newell (area-weighted) best-fit plane. Near-planarity is disclosed, not
  solved.
- **Outline**: the panel's perimeter vertices in order (world → plane 2D).
- **Member spec, one per outline edge**:
  - `longPointLength` — the panel edge length (chord × radius). Members
    are cut long-point-to-long-point; miters land the long points exactly
    on the polygon corners.
  - `miterStartDeg` / `miterEndDeg` — half the outline's interior corner
    angle at each end of the member (in-plane miter).
  - `bevelDeg` — rip angle from square on the outer (mating) face:
    - interior edge (2 adjacent panels): `(180 − dihedralDeg) / 2` using
      the classifier's per-edge dihedral;
    - leveled-base boundary edge: floor bevel `90 − α` where α = angle
      between the panel plane and horizontal
      (`α = degrees(acos(|n̂·ẑ|))`) — the sill member's outer face sits
      flat on the foundation;
    - natural-base boundary edge: 0 (square), disclosed.
- **Frame types** `F1, F2, …` (descending count, then area): panels
  grouped by the canonical form of their cyclic member sequence
  `(longPointLength, bevelDeg, cornerAngleDeg)` rounded to 0.1 — minimal
  string over all rotations and reflections. Members within a type are
  labeled `F1-a, F1-b, …` in canonical order (equal specs collapse into
  one row with a count).
- **Counts**: interior edges contribute 2 members (one per adjacent
  panel); boundary edges 1. Faces removed by the doorway cut are omitted
  entirely (their seams too).
- **Seams**: kept interior edges. Per seam: length, bolt count =
  `max(2, ceil(length / spacing))`, spacing 16″ imperial / 400 mm metric.

```ts
export interface FrameMemberSpec {
  label: string            // 'F1-a'
  count: number            // members of this exact spec across the type
  longPointLength: number  // working units
  miterStartDeg: number
  miterEndDeg: number
  bevelDeg: number
  boundary: boolean        // base-edge member (floor bevel / square)
}
export interface FrameType {
  label: string            // 'F1'
  panelCount: number
  sides: number
  members: FrameMemberSpec[]   // deduped; Σ(count) = sides
  outline: [number, number][]  // representative 2D outline, working units
  cornerAnglesDeg: number[]
}
export interface PanelFramePlan {
  types: FrameType[]
  totalPanels: number
  totalMembers: number
  seamCount: number
  totalSeamLength: number
  boltCount: number
  omittedPanels: number    // doorway-removed faces
}
export function buildPanelFrames(
  model: DomeModel,
  radius: number,
  units: UnitSystem,
  doorway: DoorwayCut,
): PanelFramePlan
```

## Integration

- **`JOINT_METHODS`** gains
  `{ id: 'framed-panel', label: 'Framed panels (double wall)', defaultEndOffset: 0, note: 'Each panel is built independently on a jig and bolted to its neighbors — doubled lumber at every seam, no hub hardware. End offset does not apply.' }`.
  Persistence/restore membership checks are already generic.
- **Cut list / packing / optimizer**: when `jointId === 'framed-panel'`,
  `buildCutList` emits one row per distinct member spec (label `F1-a`,
  quantity, exact + rounded long-point length, `axialAngleDeg: NaN`) in
  place of strut rows; packing, the optimizer, and board diagrams consume
  them unchanged. Riser rows unaffected.
- **Parts tab**: when framed-panel is active, the Struts section renders a
  frames table instead (member, qty, long-point length, miters, bevel,
  per-type headers with panel counts); the Hubs section shows a note that
  no hubs exist in this construction.
- **Costs/BOM** (`buildBom` branch): seam bolts + nuts + 2 washers each
  (from `boltCount`); panel screws, framing screws (closures + riser), and
  anchors unchanged; no hub hardware, no glue line.
- **Exports**:
  - `framesCsv(plan, units)` — one row per member spec per type: type,
    member, qty, long-point length, miter start/end, bevel, boundary.
  - `frameJigsSvg(plan, units, title)` — one page per frame type
    (paper.ts): dimensioned outline, member labels, long-point lengths,
    corner miter angles, edge bevels, "build N" count, seam-bolt note.
  - ExportPanel: when framed-panel, hide Cut templates / Hub labels /
    Miter CSV; add "Panel jig drawings SVG" and "Frames CSV". Assembly
    guide stays (panel placement follows the same courses; one disclosed
    line in the guide cover when framed-panel).
- **3D true-size rendering** (`three-builders.ts`): when
  `jointMode && jointId === 'framed-panel'`: skip struts/hubs; per panel,
  per outline edge, one member solid built with the existing `clipSolid`
  convex clipper — a box along the edge (cross-section: section thickness
  in-plane inward × section depth along −normal inward), extended past the
  corners, clipped by (a) the two corner-bisector planes in the panel
  plane, (b) for interior edges the seam plane between the two panel
  planes (member kept on its panel's side — this is what renders the
  doubled seam), (c) for leveled boundary edges the foundation plane.
  Members register in `strutFaceMaps` under their edgeId so selection
  still works. Panels (skin) render as in assembly mode.
- **Loads view**: solver untouched — edges as single members
  (conservative; the pin-joint disclaimer covers the idealization).

## Honest caveats (surfaced in UI copy)

- Openings: affected panels are omitted; frame the opening on site — the
  strut-trim/door-buck math does not apply to panel frames.
- Goldberg panels are near-planar; jigs assume the flattened outline.
- Natural-base boundary members are cut square; scribe to grade on site.

## Testing (vitest, engine-level)

- 3V 1/2 geodesic: totalMembers = 2×interior + boundary edges; 1V check:
  every triangle is equilateral, so EVERY member's miters are 30° (60°/2)
  regardless of how base-context splits the types.
- Bevels: for a known 3V edge, bevel = (180 − dihedralDeg)/2 within 1e-6;
  leveled base sill bevel matches 90 − α from the base panel's plane.
- Zome Z8: frame types have 4 sides; goldberg 2V: 5- and 6-sided types
  (+ partials on leveled).
- Doorway: removed faces reduce panelCount and seams; omittedPanels > 0.
- Grouping: same-shape panels in different dihedral contexts split into
  distinct types (construct case or assert type count ≥ paint-group count).
- Cut list: framed-panel rows replace strut rows; packing still packs.
- CSV row count = Σ distinct member specs + header; jig SVG has one
  `data-frame-page` per type and `data-bevel` per edge.

## Out of scope

- Partial panels at doorways (site-framed, disclosed), panel skin
  attachment engineering, gasket/sealant details, loads model of doubled
  members, vertex "cone" trims where >2 panels meet a corner (the small
  corner clash at panel points is a known build detail — jigs cut members
  back at the miter; disclosed in the jig drawing note).
