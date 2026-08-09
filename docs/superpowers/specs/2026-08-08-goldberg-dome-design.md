# Hex/Pent (Goldberg) Dome Mode — Design Spec

**Date:** 2026-08-08
**Status:** Approved for planning

## Summary

A third structure family: the **Goldberg dual** of the geodesic sphere —
12 pentagons in a field of hexagons, every joint 3-way, panels structural.
Reuses the existing Frequency/Fraction controls and the shared `baseMode`,
lives inside the `DomeModel` contract via triangle fans + polygon metadata,
and flows through every downstream system. Ships with the honest structural
disclosure: a bare hex frame is not rigid — the panels (stressed skin) or
added bracing carry the shape.

## Decisions (from brainstorming)

1. True Goldberg dual panel dome — no baked-in triangulated bracing (option
   for a future overlay, out of scope).
2. `baseMode` mirrors the other families: `natural` = whole panels only
   (organic scalloped rim), `leveled` = straddling polygons clipped at the
   cut plane (trapezoid partials + a horizontal chord edge each → planar
   base ring, riser-ready).
3. ~~Mitered joint method is disabled for goldberg mode~~ **Reversed at
   user request post-ship:** mitered is available on all structure
   families. A 3-way mitered joint is an ordinary timber Y-joint; the
   miter math and rendering are valence-agnostic, and the hex-rigidity
   caveat applies to every joint method equally. All joints render
   through the existing joint-accurate paths.

## Generator: `src/engine/goldberg.ts`

```ts
export interface GoldbergParams {
  frequency: Frequency        // 1..6, reused
  fraction: Fraction          // '3/8' | '1/2' | '5/8' (never 'full' from UI)
  baseMode: 'natural' | 'leveled'
}
export function generateGoldberg(params: GoldbergParams): DomeModel
```

- **Dual construction:** full icosphere at ν; dual vertex per triangle =
  centroid normalized onto the unit sphere; dual polygon per icosphere
  vertex = its adjacent triangle centroids ordered by angle around the
  vertex direction (CCW from outside). Full sphere: 12 pentagons,
  10(ν²−1) hexagons, dual V = 20ν², dual E = 30ν², every dual vertex
  3-valent.
- **Cut selection:** candidate cut heights are the distinct z's of the
  ORIGINAL icosphere vertices (each owns a polygon); score =
  |actualFraction − target| exactly as the geodesic generator scores, with
  actual fraction measured on kept dual height. The cut plane z* is the
  chosen polygon-center level minus half the local polygon height —
  concretely: keep polygons whose owner vertex z ≥ z*, with z* chosen from
  the candidate levels nearest the requested fraction.
- **Natural base:** keep whole polygons only (owner vertex above the cut);
  rim follows the polygon outlines (scalloped, non-planar). `isBase` from
  boundary edges as everywhere.
- **Leveled base:** additionally keep polygons that STRADDLE the plane of
  the lowest kept ring: clip each straddling polygon against z = zCut
  (Sutherland–Hodgman on the polygon loop), producing a trapezoid partial
  with one new horizontal chord edge; clipped-in vertices are new model
  vertices ON the plane. Result: planar base ring of chord edges,
  `orderedBaseRing` walkable.
- **DomeModel packaging:** each polygon (whole or partial) enters `faces`
  as a fan from its vertex 0 (no added vertices; diagonals excluded from
  `edges`; `Face.edgeIds` holds only real border edges — 1 for interior
  fan triangles, following the zome precedent that nothing indexes beyond
  what exists). New metadata:

```ts
// DomeModel gains:
  /** Polygon panels for goldberg models: each polygon and its fan faces. */
  polys?: { vertexIds: number[]; faceIds: number[] }[]
  /** Goldberg params echo. */
  goldberg?: { frequency: number; fraction: string; leveled: boolean }
```

- **Normalization:** dual vertices already on the unit sphere (partials'
  clipped vertices lie inside it on the cut plane — fine; world = position
  × radius). `cutZ` = lowest kept z; `unitHeight`, `unitBaseRadius`,
  `actualFraction` from kept geometry.
- **Classification:** `classifyModel` as-is — several strut types per
  frequency (dual edges are not equal), all-3-way hub types (plus base
  variants).
- 1V full dual sanity: dodecahedron — 12 pentagons, 20 vertices, 30 equal
  edges, one strut type.

## State & UI

- `mode: 'geodesic' | 'zome' | 'goldberg'`. Structure toggle gains
  **Hex/Pent** (three equal segments). Goldberg mode shows the SAME
  Frequency + Fraction controls as geodesic (shared fields) and the shared
  Leveled-base switch with a mode-aware description (whole panels /
  clipped flat ring). Description under the toggle: "Hexagon + pentagon
  panels, 3-way joints. Panels are structural — a bare hex frame is not
  rigid."
- Header chip: `⬡${frequency}V · ${fraction}` in goldberg mode.
- Joint method: selecting goldberg while `jointId === 'mitered'` falls
  back to the material's default joint; the Mitered option is disabled in
  the select while in goldberg mode (with the note in its description).
- Persistence, project JSON (`settings.mode` already exists — accepts
  'goldberg'), reset.

## Downstream systems

- **Portals / riser / optimizer / exports:** generic paths. Riser
  eligibility stays `baseMode === 'leveled'`; the goldberg leveled ring is
  planar chord edges.
- **paintFace:** paints the whole polygon via `polys` (all fan faces), as
  rhombi do for zomes.
- **Panels:** the composable flattens each kept polygon onto its best-fit
  plane and passes 2D outlines; `planPanels` gains
  `polys?: [number, number][][]` (one outline per panel, working units) →
  `PanelPlan.polys: PolyPanelType[]`:

```ts
export interface PolyPanelType {
  label: string       // G1, G2, ... smallest-area first
  count: number
  sides: number       // 5, 6, or 4 (partials)
  edges: number[]     // representative edge lengths
  area: number
  boundingW: number
  boundingH: number
  perSheet: number    // grid nesting of the bounding rect; 0 = seamed
  seamed: boolean
  sheets: number
}
```

  Grouped by rounded edge-length signature; edges, area (shoelace), and
  bounding box measured directly from each outline. Skin factor honored;
  totals folded in.
- **Panel patterns SVG:** polygon pages — outline drawn, every edge length
  labeled, interior angles labeled (`data-angle`), count + nesting hint.
- **BOM:** panel-screw perimeter includes polygon outlines.
- **Cut list / packing / templates / board diagrams / assembly guide /
  costs:** flow through unchanged (goldberg = more strut types, 3-way
  hubs; templates render per type as usual; guide courses cluster dual
  vertex z's fine).

## Testing

- Full-sphere dual invariants ν = 1..4: pentagon count 12, hexagons
  10(ν²−1), V = 20ν², E = 30ν², all vertices valence 3 (via edgeIds).
- 1V full dual = dodecahedron: 30 edges, one strut type, 12 pentagons.
- Truncated: natural rim has whole polygons only (every poly's owner
  above cut — assert no polygon has a vertex below cutZ − tol); leveled:
  base ring planar, `orderedBaseRing` length = ring chord count, riser
  builds with segments = ring edges; partial polygons have 4+ sides.
- Doorway cut on a leveled 3V goldberg: fits, trims land on envelope
  planes (reuse the generic assertion).
- Panels: `PanelPlan.polys` groups (2V leveled: pent group + hex groups +
  partial group), skin factor doubles counts; patterns SVG emits polygon
  pages with `data-angle` sums = (n−2)×180 ± 0.1.
- Mode round-trip: persistence + JSON accept 'goldberg'; mitered fallback
  on mode switch.

## Out of scope

- Interior bracing overlay, Class-II duals, mixed families, panel-joint
  hardware engineering (H-clips etc.).
