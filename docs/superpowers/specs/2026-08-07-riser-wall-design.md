# Riser Wall — Design Spec

**Date:** 2026-08-07
**Status:** Approved for planning

## Summary

Add a configurable stud-framed riser (knee) wall under the dome's base ring: a
vertical wall of height `h` that lifts the whole dome, adding perimeter
headroom. The wall is fully taken off — plates, studs, sheathing — in the cut
list, board packing, and panel sheet plan. Doors cut through the riser to the
foundation; windows remain a shell-only feature and must clear the riser top.

## Decisions (from brainstorming)

1. Scope: riser wall only. Class II subdivision and apex cupola are separate
   future specs.
2. Construction: stud-framed segments (one flat wall panel per base-ring
   edge), not post-and-beam, not geometry-only.
3. Doors cut through the riser down to the foundation, with king/trimmer
   studs and full-height jambs. Door height is measured from the floor.
4. Windows clamp to the shell: a sill below the riser top is a validation
   warning, not a riser opening. No riser-band or straddling windows in v1.

## Parameter & constraint

- New canonical state: `riserHeightMm: number` (0 = disabled, default 0).
  - UI: "Riser wall" height input in the Parameters panel, small units
    (in / mm), same display-rounding conventions as end offset.
  - Persisted in the localStorage slice, exported/imported in project JSON
    (`settings.riserHeightMm`), cleared by reset-to-defaults.
- **Requires leveled base.** With `baseMode: 'natural'` the base ring is not
  planar; wall segments would need sloped top plates and trapezoid sheathing.
  The riser input is disabled with a hint ("level the base to add a riser
  wall") and the engine treats riser as off when the base is natural.

## Engine: `src/engine/riser.ts`

Pure function, same style as `doorway.ts` / `panels.ts`:

```
buildRiser(model, radius, opts: {
  heightMm; strutSection; studSpacing; doorSpecs; units-agnostic (mm in, working units out as elsewhere)
}) => RiserModel | null   // null when disabled/inapplicable
```

Geometry:

- The ordered base-ring polygon comes from the model's boundary hubs at the
  cut plane (leveled base ⇒ planar ring). Each ring edge becomes one
  rectangular wall segment spanning from the base plane (z = cutZ·r) down to
  the foundation plane (z = cutZ·r − h).
- Per segment framing:
  - 1× bottom plate and 1× top plate, each the segment chord length. The top
    plate carries the base strut above it.
  - Studs at the existing stud spacing (16″ imperial / 400 mm metric),
    measured o.c. from the segment start, with sliver folding identical to
    closure framing (no stud bay shorter than the sliver threshold; fold into
    the neighbor).
  - One corner stud per base hub, shared between adjacent segments (emitted
    once, not once per segment).
- Output mirrors the closure-framing shape so downstream code is uniform:
  - `RiserMember { part: 'riser top plate' | 'riser bottom plate' |
    'riser stud' | 'riser king stud' | 'riser trimmer'; length; quantity;
    a: [x,y,z]; b: [x,y,z] }` (world endpoints for rendering).
  - Joint nodes (deduped member endpoints) for joint spheres and the joint
    count.
  - Per-segment sheathing rectangles `{ width, height, area, openings[] }`.
  - Totals: perimeter, gross/net sheathing area, member and joint counts.

## Door interaction

- Door height semantics change when a riser is active: `heightMm` is the
  clear opening height **from the floor** (foundation plane).
- Shell cut: the doorway engine receives an effective shell height of
  `H − h` above the base plane (the existing zClip band math, shifted).
  If `H ≤ h` the door does not reach the shell: surface the existing
  "doesn't fit" warning on the door card (fix: taller door or shorter riser).
- Buck: jambs run full height `H` (through the riser to the foundation);
  header unchanged. Jamb lengths in the cut list reflect the riser.
- Riser framing at the door: segments intersected by the door span
  (width + margin at the door azimuth) get:
  - bottom plate interrupted (two pieces, or one/zero at segment ends),
  - king + trimmer studs at each side of the opening,
  - regular studs omitted inside the opening,
  - a sheathing cutout for the opening area.
- A door span may cross a base hub (two adjacent segments); framing is
  computed per segment against the door's interval on that segment.

## Window interaction

- Sill is measured from the floor. Shell math uses `sill − h`.
- Validation: `sill < h + margin` ⇒ warning on the window card ("window dips
  into the riser — raise the sill above <min>"), and the window is excluded
  from cutting (same treatment as the existing not-fitting state).

## Cut list, packing, panels

- Riser members enter `buildCutList` as `kind: 'frame'` rows grouped by
  part + rounded length, with notes via the existing framing-note map
  (e.g. "riser stud"). Board packing (FFD) picks them up automatically
  because packing consumes the cut list.
- Sheathing joins the panel sheet plan as riser groups (`R1…`, one group per
  distinct segment width class), rectangles nested on the configured sheet
  size, honoring the inside/outside/both skin setting (both ⇒ double area)
  and subtracting door-opening cutouts. Oversized pieces follow the existing
  "seamed" convention.

## 3D view & UI

- Rendering (three-builders): sheathing quads per segment (skin offsets per
  `panelPlacement`), framing bars from member `a/b` endpoints, joint
  spheres — the closure visual language. Door bucks extend down through the
  wall.
- Floor: the ground grid moves to the foundation plane
  (`cutZ·r − h`). Header height chip includes the riser. Camera logic is
  unchanged (radius scaling already compensates).
- Parameters panel: "Riser wall" field, disabled + hint under natural base.
- Openings panel: door/window cards show the warnings described above.

## Exports

- CSV cut list and boards CSV: riser rows flow through automatically.
- Panels CSV: riser sheathing groups included.
- Project JSON: `riserHeightMm` round-trips.
- OBJ/GLTF: riser sheathing + framing included in the exported geometry.

## Testing

Unit tests in the engine suite:

1. Segment count equals base-ring edge count; disabled when height = 0 or
   base is natural.
2. Plate takeoff ≈ 2× ring perimeter; stud count matches spacing with sliver
   folding (no bay under threshold).
3. Corner studs emitted once per hub.
4. Door: bottom plate interrupted, king/trimmer studs present, no studs
   inside the opening, jamb length includes riser height, `H ≤ h` flagged
   unfit.
5. Door spanning a hub corner frames correctly on both segments.
6. Window: sill below riser top warns and is excluded from cutting; sill
   above behaves exactly as today with the `sill − h` shift.
7. Sheathing: net area = perimeter × h − door openings; both-skins doubles.
8. Cut list contains riser rows; packing consumes them.
9. Persistence and project JSON round-trip `riserHeightMm`.

## Out of scope (deliberate)

- Riser-band or straddling windows.
- Sloped-top walls under natural (non-planar) bases.
- Foundation anchoring hardware / hardware BOM.
- Per-segment height variation.
