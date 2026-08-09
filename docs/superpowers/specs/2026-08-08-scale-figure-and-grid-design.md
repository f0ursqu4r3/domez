# Scale Figure + Real-Unit Floor Grid — Design Spec

**Date:** 2026-08-08
**Status:** Approved for planning

## Summary

Two scale cues for the 3D view: a flat billboard person silhouette at
standard height standing beside the dome, and floor-grid rings snapped to
clean physical distances instead of radius-relative spacing.

## Decisions (from brainstorming)

1. Person = flat billboard silhouette card, Y-axis-only rotation to face
   the camera (never tilts).
2. Fixed standard height: 69 in imperial / 1750 mm metric.
3. Toggle in the ViewModeBar next to True size; state persisted with the
   other view prefs. Default ON.
4. Grid stays polar; ring spacing snaps to a clean real-unit step.

## Scale figure: `src/lib/figure.ts`

```ts
/** Flat person silhouette, 1.0 units tall, feet at y=0, facing +z. */
export function buildFigure(heightWorld: number): THREE.Group
```

- Silhouette from a hand-authored polygon outline (head, shoulders, arms
  at sides, legs) via `THREE.Shape` → `ShapeGeometry` — resolution-
  independent, no textures. One `MeshBasicMaterial`, color `0x64748b`,
  `side: THREE.DoubleSide`, `fog: true` left default.
- The group is scaled so total height = `heightWorld`; origin at the feet
  so it stands on any y plane.
- Named `scale-figure` (`group.name`) so the viewer can find it for
  billboarding; excluded from raycast picking (viewer raycasts against
  `domeGroup` only — verify no change needed).

## Viewer integration: `DomeViewer.vue`

- Height: `state.units === 'imperial' ? 69 : 1750` (working units are
  inches/mm — the scene is already in working units).
- Position: `x = max(model.unitBaseRadius, 0.9) * radius * 1.1 +
  shoulder margin`, `z = 0`, feet on the foundation plane — the same y
  the grid uses (`cutZ * r − riser`). Rebuilt in `rebuildGround()`
  (radius/unit/riser changes already trigger it); visibility follows
  `state.showFigure`.
- Billboard: in the render loop, `figure.rotation.y =
  Math.atan2(camera.position.x − figure.position.x, camera.position.z −
  figure.position.z)` — Y-only, no tilt.

## State & UI

- `state.showFigure: boolean`, default `true`; persisted exactly like
  `trueSize` (same persistedSlice/restore path). Not part of exported
  ProjectSettings JSON unless trueSize already is — mirror trueSize's
  treatment precisely.
- ViewModeBar: a "Figure" toggle button styled/placed like the True size
  toggle, bound to `state.showFigure`.

## Floor grid: `src/lib/scale.ts`

```ts
export interface GridSpec {
  /** Ring spacing, working units. */
  step: number
  /** Outer radius, a whole multiple of step. */
  radius: number
  rings: number
}
/** Smallest clean step keeping rings ≤ 16, radius ≥ domeRadius × 1.6. */
export function gridSpec(radius: number, units: UnitSystem): GridSpec
```

- Candidate steps: imperial 12/24/60/120 in (1/2/5/10 ft); metric
  500/1000/2000/5000 mm (0.5/1/2/5 m).
- Pick the smallest step where `ceil((radius × 1.6) / step) ≤ 16`; if
  even the largest step exceeds 16 rings, use the largest step anyway.
- `spec.radius = rings × step` (round the target up to a whole step).
- `rebuildGround()` uses `new THREE.PolarGridHelper(spec.radius, 12,
  spec.rings, 48, 0x2a3648, 0x1a2230)` — sector count and colors
  unchanged.

## Testing

- vitest for `gridSpec`: 26 ft dome imperial → step 60 in (5 ft), rings
  ≤ 16, radius = rings × step ≥ 1.6 × dome radius; tiny dome (3 ft) →
  step 12 in; huge dome (120 ft) → step 120 in with rings ≤ 16 or capped
  at largest step; metric equivalents (8 m dome → 1 m step).
- Live browser verification: figure stands beside the dome at believable
  scale, billboards while orbiting (screenshots from two angles), toggle
  hides/shows it, persists across reload; grid rings land on clean
  distances at several diameters/units; figure sits on the foundation
  when a riser is set; no raycast/selection regressions clicking near
  the figure.

## Out of scope

- Ring distance labels, configurable figure height, multiple figures,
  furniture/props.
