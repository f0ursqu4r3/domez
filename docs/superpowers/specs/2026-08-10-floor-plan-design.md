# Floor Plan — Plan View Mode + Printable SVG Design Spec

**Date:** 2026-08-10
**Status:** Approved for planning

## Summary

Two deliverables: a "Plan" view mode (true top-down orthographic camera,
rotation locked) and a dimensioned floor-plan SVG export — footprint
polygon with wall thickness, overall dimension line, floor area, scale
bar, azimuth reference, door gaps and window ticks, and dashed headroom
contour rings. All three structure families.

## Decisions (from brainstorming)

1. Both the view mode and the printable SVG.
2. Plan content: footprint + dimensions, doors + windows, headroom rings.
   Hub/anchor positions declined (stays out).

## Plan view mode (viewer)

- `ViewMode` union gains `'plan'` (ViewModeBar label "Plan", after Loads;
  persistence validation list updated).
- Entering plan mode: save the perspective camera position + orbit
  target; switch rendering and controls to an `OrthographicCamera`
  looking straight down (−y in three space) from well above the apex,
  frustum sized to the ground grid (`gridSpec` radius) and kept aspect-
  correct on resize; `controls.object` reassigned (OrbitControls handles
  ortho zoom via `.zoom`), `enableRotate = false`, pan + zoom live.
  Leaving plan mode restores the perspective camera, its saved
  position/target, and `enableRotate = true`.
- Screen orientation: azimuth 0° (+x world) points right; the SVG uses
  the same convention.
- The scale figure hides in plan mode (billboards are edge-on lines from
  above); the grid stays; selection/raycasting uses the active camera.
- Struts render assembly-style — `'plan'` takes the same defaults as
  `'assembly'` in three-builders (verify every `opts.mode` comparison
  site; no special-casing expected).

## Floor plan SVG (`src/engine/exports/plan.ts`)

```ts
export interface PlanOptions {
  units: UnitSystem
  radius: number          // working units
  riserHeight: number     // working units, 0 = none
  wallThickness: number   // strut depth, working units
  title: string
}
export function planSvg(model: DomeModel, doorway: DoorwayCut, opts: PlanOptions): string
```

One page (paper.ts conventions). Coordinate mapping: plan x = world x,
plan y = −world y (matches the assembly guide's top-down projection).
Content, each carrying a data attribute for tests:

- **Footprint** (`data-plan-footprint`): the ordered base-ring polygon
  (walk boundary edges — reuse/extract the `orderedBaseRing` logic from
  riser.ts; it must work for natural zigzag rims too), drawn as a double
  line offset inward by `wallThickness`, scaled to fit the page's
  drawing box with margin.
- **Dimension line** (`data-dim`): overall extent across x with extension
  ticks and `formatLength` label; floor area callout (`ft²`/`m²`, same
  math as the header chip); graphic scale bar (a bar of clean working
  lengths, e.g. 0–5–10 ft / 0–1–2 m chosen from the dome size);
  azimuth-0 reference arrow labeled `0°`.
- **Doors** (`data-door-gap`, one per non-window door in
  `doorway.doors`): break the wall line over the door's angular span at
  its azimuth; label width + azimuth (e.g. `36″ @ 45°`).
- **Windows** (`data-window-tick`, one per `doorway.doors` entry that is
  a framed window — detect via its sill field per DoorFrameInfo's actual
  shape): tick across the wall + label `width @ azimuth · sill h`.
- **Headroom rings** (`data-headroom-ring` with `data-height`): dashed
  circles where interior standing height crosses the thresholds —
  imperial 72″ and 48″; metric 2000 mm and 1200 mm.
  - Geodesic + goldberg (sphere-based): target shell z* =
    `cutZ·R − riser + h`. If `h ≤ riser` the full footprint qualifies →
    no ring, legend note "≥ h everywhere". If `z* ≥ R` (taller than the
    apex) → no ring, note "nowhere". Else ring radius `r* = √(R² − z*²)`.
  - Zome: build the rotational profile polyline — group vertices by z
    (rounded 1e-6), per level take the max horizontal radius — and
    linearly interpolate r* at z*; same edge cases. Legend notes the
    zome rings are interpolated from the panel profile.
  - Legend block lists each threshold with its outcome (ring / everywhere
    / nowhere).
- Riser note when riserHeight > 0: "Riser wall: h — headroom measured
  from the foundation."

## Export wiring

- Exporter `floorPlan` in the composable: `planSvg(model, doorway, { units, radius, riserHeight: workingRiserHeight, wallThickness: strut depth from strutSectionWorking (rect depth / round OD), title: titleOf })`,
  filename `${fileStem}-floor-plan.svg`.
- ExportPanel: "Floor plan SVG" / desc "dimensioned plan + headroom" in
  the Fabrication group, all families, all joint methods.

## Testing

- Engine (vitest): 3V 1/2 leveled imperial, radius 156, riser 0 —
  footprint present; headroom: hand-check `r* = √(156² − z*²)` for 72″
  (z* = cutZ·156 + 72) appears as a ring with data-height="72"; 48″ ring
  larger than 72″ ring (monotonic). Add a riser 24″ case: rings move
  outward (larger r*) vs riser 0. Doors: one door → exactly one
  `data-door-gap`; one framed window → one `data-window-tick` with
  'sill' in its label. Zome Z8: rings interpolate (radius between the
  bracketing level radii); tiny dome where 72″ > apex → zero 72″ rings
  and the 'nowhere' note. Natural-base 3V: footprint polygon vertex
  count = boundary vertex count (zigzag ring works).
- Viewer: live — enter Plan (top-down ortho, no rotation on drag,
  pan/zoom work), leave (orbit restored), figure hidden in plan only,
  export downloads, selection works in plan mode.

## Out of scope

- Furniture/scale objects on the plan, multi-story plans, PDF export,
  hub/anchor layout (declined), printing the plan from the view mode
  (use the SVG).
