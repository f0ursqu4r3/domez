# Joint-Accurate Rendering — Design Spec

**Date:** 2026-08-07
**Status:** Approved for planning

## Summary

When **True size** is on, the viewer stops drawing schematic sphere hubs and
full-chord struts and instead renders the joint the way the selected joint
method actually builds it. Scope is rendering (plus one small engine helper);
the mitered/hubless joint method (real CSG + new cut-list math) is a
deliberate follow-up, out of scope here.

## Decisions (from discussion)

1. Keyed to the existing **Joint method** setting; active only when
   `trueSize` is on. Schematic mode (spheres, full-chord struts) unchanged.
2. Three joint visualizations ship: hub connector, timber + plate,
   flattened pipe (the hubless stack). Mitered hubless deferred.
3. Works in both structure modes (geodesic and zome) — the hub axis comes
   from adjacent-face normals, not from assuming vertices lie on a sphere.

## Engine helper: `hubAxes`

`src/engine/hubs.ts`:

```ts
/** Outward hub axis per vertex: the normalized sum of adjacent face
 * normals (area-weighted via raw cross products). Falls back to the
 * normalized position when a vertex has no faces. Unit vectors. */
export function hubAxes(model: DomeModel): Vec3[]
```

- Geodesic: axis ≈ normalized vertex position (test: dot > 0.99).
- Zome apex: axis ≈ +z. Boundary vertices get a sensible outward-leaning
  axis automatically (their face fan is one-sided; that is correct — the
  plate/hub sits on the shell, not on the missing half).

## Rendering (`three-builders.ts`)

`BuildOptions` gains `jointId?: JointMethodId` and `endOffset?: number`
(working units). Joint-accurate rendering activates when `strutSection` is
set (True size on) — `jointId` selects the visualization; missing jointId
falls back to today's spheres.

Shared per-vertex data: hub axis (from `hubAxes`), incident strut unit
directions and the strut section. Removed vertices (doorways) are skipped as
today. Exploded mode offsets joint geometry with the same vector as the hub
used previously. Trimmed struts, door bucks, closure and riser framing keep
their current square-cut rendering — joints apply at dome hubs only.

### Hub connector (`jointId: 'hub'`)

- Struts drawn at cut length: each end pulled back `endOffset` along the
  strut axis (both schematic ends of the same box/cylinder placement math —
  just shorter and re-centered).
- Hub geometry per vertex: a core cylinder along the hub axis (radius
  1.4 × strut half-width, height 2.4 × strut width) plus one spoke stub per
  incident strut: a cylinder (round section: radius 0.62 × OD; rect: a box
  of the strut's width/depth × 1.15) reaching from the core out exactly
  `endOffset`, aimed down the strut direction. Steel material (existing hub
  color 0xd8dee9).

### Timber + plate (`jointId: 'timber-plate'`)

- Struts drawn at cut length (pull back `endOffset` per end).
- Rect sections get the **axial bevel**: a custom 8-vertex hexahedron per
  strut whose end faces are cut perpendicular to the hub axis at each end
  (the cut-list axial angle made visible). Round sections stay square-cut.
- A thin plate per vertex: regular n-gon disc (n = valence, radius =
  1.9 × endOffset, thickness 0.25″ / 6 mm converted to working units via the
  section units), centered on the vertex, face normal = hub axis, sitting on
  the OUTER side (offset +thickness/2 along the axis from the strut top
  face: axis offset = strut depth / 2).

### Flattened pipe (`jointId: 'flattened-pipe'`)

- endOffset is typically 0 (hole-to-hole = chord): tube bodies end
  1.5 × OD short of the vertex; from there a flat tab (width 1.57 × OD,
  thickness 0.15 × OD) continues to 0.35 × OD PAST the vertex (the drilled
  overlap).
- Tabs stack: tab i of the vertex is offset outward along the hub axis by
  `(i − (valence−1)/2) × thickness` so the stack reads as layered plates.
- One bolt: cylinder along the hub axis, radius 0.19 × OD, length
  valence × tabThickness + 1.2 × OD, with washer-ish end caps (radius
  0.45 × OD, thin cylinders).

### Picking

The existing instanced hub-pick spheres stay (they carry the pick maps) but
shrink to 0.55 × their schematic radius in joint-accurate mode so they hide
inside the joint geometry while remaining raycastable. Selection highlight:
the pick sphere turns white as today (visible enough through gaps; accepted).

## Wiring

`useDomeProject` already exposes `jointMethod` and `workingEndOffset`;
`DomeViewer` and the GLTF exporter pass `jointId: state.jointId` and
`endOffset: workingEndOffset.value` into `buildDomeGroup` (always — the
builder gates on `strutSection`). Rebuild watcher adds `state.jointId` and
`workingEndOffset`.

## Testing

- Engine: `hubAxes` unit tests (unit length; geodesic axis ≈ position;
  zome apex ≈ +z; every vertex covered).
- Rendering: verified live in the browser across all three joint methods ×
  geodesic/zome, exploded mode, and a doorway (removed hubs stay removed).
  No vitest coverage of three.js output (consistent with the codebase).

## Out of scope (deliberate)

- Mitered/hubless joint method (new cut-list math + CSG ends) — follow-up.
- Bolt/hardware counts in the BOM.
- Per-hub fabrication drawings.
