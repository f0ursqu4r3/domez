# Mitered Hubless Joint Method — Design Spec

**Date:** 2026-08-07
**Status:** Approved for planning (follow-up scoped in the joint-accurate rendering spec)

## Summary

A fourth joint method, **mitered** — the no-hardware build where struts run
full chord length to the vertex and each end is compound-cut against its
neighbors so the members mate like pie slices. Ships with real cut math (a
per-end angle takeoff and CSV export) and the matching true-size rendering.

## The geometry (source of truth)

At a hub with outward axis â (`hubAxes`) and incident strut unit directions
d̂ᵢ (pointing away from the vertex), sort the struts by angle around â. The
seam between adjacent struts i and j is the plane through the vertex with
normal **n̂ᵢⱼ = normalize(d̂ᵢ − d̂ⱼ)** — the perpendicular-bisector plane of
the two directions, which is where symmetric members meet. Two facts fall
out:

- The **cheek cut** on strut i against neighbor j is exactly **half the 3D
  angle between d̂ᵢ and d̂ⱼ** (the picture-frame rule: miter = half the
  corner). Left and right neighbors generally differ → compound end.
- The **tilt** of the end is the strut's climb out of the hub's tangent
  plane: `asin(|d̂ᵢ · â|)` (≈ 90° − axial angle).

Crucially these angles depend on the hub a strut lands in, not just its
type — the same B strut meets different neighbors at a 5-way vs 6-way hub.
So the takeoff is **per edge end**, not per type.

## Engine: `src/engine/miter.ts`

```ts
export interface MiterEnd {
  vertexId: number
  /** Cheek half-angles against the two neighbors around the hub axis, deg. */
  leftSeamDeg: number
  rightSeamDeg: number
  /** Strut climb out of the hub tangent plane, deg. */
  tiltDeg: number
}
/** Per edge: [end at v0, end at v1]. Valence-1 hubs get 0° seams. */
export function miterCuts(model: DomeModel): [MiterEnd, MiterEnd][]
```

Implementation: per vertex, build a tangent basis (e1, e2 ⊥ â), sort
incident non-removed edge directions by `atan2(d·e2, d·e1)`, then for each
strut its neighbors are the adjacent entries (cyclically). Seam half-angle =
`acos(clamp(d̂ᵢ·d̂ⱼ)) / 2`. Works identically for geodesics and zomes.

## Joint method + exports

- `JOINT_METHODS` gains `{ id: 'mitered', label: 'Mitered hubless',
  defaultEndOffset: 0, note: 'Struts run full chord to the vertex; each end
  compound-cut against its neighbors (see the miter CSV) — glued/screwed
  seams, no hardware.' }`. `JointMethodId` widens with `'mitered'`.
  Everything downstream (state validation, persistence, JSON) accepts it
  automatically because it validates against `JOINT_METHODS`.
- New export `miterCsv(model, units)` in `src/engine/exports/csv.ts`: one
  row per strut END — Edge, Type, Hub vertex, Hub type, Left seam °, Right
  seam °, Tilt °, Cut length. `ExportPanel` shows a "Miter cuts (CSV)"
  button only when `state.jointId === 'mitered'`.
- Cut list itself is unchanged (mitered means endOffset 0 → cut length =
  chord; the per-end angles live in the miter CSV, since they are per-end,
  not per-type).

## Rendering (`three-builders.ts`)

In joint-accurate mode with `jointId === 'mitered'` and a rect section:

- Struts render full chord (no pullback) as merged custom geometry (the
  timber-plate hexahedron path generalized): each end's 4 cross-section
  corners are cut back along the strut axis to the **nearer of the two seam
  planes** (per-corner ray/plane intersection, clamped to ±3× width). The
  end quad renders as two triangles whose shared diagonal falls near the
  seam ridge — the wedge reads correctly.
- **No joint geometry at all** — that is the point. Pick spheres stay
  (shrunken) as hub raycast targets.
- Round sections: full-chord square ends (members simply meet); noted in
  the method note that mitering is a timber technique.

## Testing

- `miterCuts`: shape (one pair per edge); at the 1V bowl apex (5-way,
  symmetric) every seam = half the angle between adjacent apex struts and
  left = right; tilt ≈ 90 − axialAngle within 1°; zome apex symmetric too.
- `JOINT_METHODS` contains mitered with 0 end offset.
- `miterCsv`: row count = 2 × edges + header; angles in [0, 90].
- Rendering verified live (mitered ends visible, no hubs, picking works).

## Out of scope

- Exact convex clipping of the ridge facet (per-corner nearest-plane cut is
  the accepted approximation).
- Seam fastener/glue-area takeoff.
- Per-hub-type printable miter tables (the CSV covers the data).
