# 1V/2V Frequencies + Zome Mode — Design Spec

**Date:** 2026-08-07
**Status:** Approved for planning

## Summary

Two features, one spec:

- **Part A:** expose 1V and 2V geodesic frequencies (single- and two-strut-type
  domes) through the existing engine.
- **Part B:** a zome mode — polar zonohedron generator with n equal generator
  vectors: every strut the same length, rhombic faces in planar rows, a
  user-controlled profile (pitch), full parity with the geodesic feature set
  (doors, windows, riser, panels, optimizer, exports).

## Decisions (from brainstorming)

1. Zome pitch is an exposed parameter (20–70°, default 45°), not a fixed value
   or preset list.
2. Zome mode ships with full parity: portals, riser, panel takeoff, optimizer,
   exports all work in v1.
3. Zome lives inside the existing `DomeModel` contract: rhombi become triangle
   pairs in `faces`; `edges` holds only real zonohedron edges (no diagonals);
   a `rhombi` metadata array pairs each rhombus with its two triangles.
4. **Base correction (post-approval, conservative):** a zome's rhombus bands
   end in a ZIGZAG rim, not a planar ring. `baseMode` therefore applies to
   zomes exactly as to geodesics: `natural` = pure zigzag rim (single strut
   type, the mathematically pure zome), `leveled` = the zigzag notches filled
   with n half-rhombus triangles plus n horizontal base chords (flat planar
   ring, one extra strut type — the same trade geodesic leveling makes).
   Riser eligibility is uniformly `baseMode === 'leveled'`.

## Part A — 1V/2V

- `Frequency` type widens to `1 | 2 | 3 | 4 | 5 | 6`.
- Parameters panel Frequency toggle gains `1V` and `2V`.
- `restorePersisted` accepts 1 and 2.
- No engine changes: `subdivideIcosahedron` already handles f = 1..6 (the
  icosphere-count test runs them all today); truncation, riser, portals,
  panels, and exports flow through untouched.
- Known quirk, accepted: 1V has no equator vertices, so fraction `1/2` snaps
  to 27.6% (5-face cap) or 72.4% (15-face bowl); the existing "actual %"
  description surfaces this.
- Tests: 1V has exactly one strut type at both cuts; 2V `1/2` is the classic
  hemisphere with two strut types and chord factors 0.546533 / 0.618034
  (already pinned constants in the suite).

## Part B — Zome mode

### Generator: `src/engine/zome.ts`

```
generateZome(params: { sides: number; pitchDeg: number; rows: number }) => DomeModel
```

- **Generators:** n = `sides` unit vectors at angle `pitchDeg` off the dome
  axis, azimuths 2πi/n, pointing downward from the apex.
- **Vertices:** consecutive-run sums `v(k, i) = g_i + g_(i+1) + … + g_(i+k−1)`
  (indices mod n), k = 0..n. Apex is row 0; each row k is planar by symmetry
  and holds n vertices (rows 0 and n hold one). Band k rhombus corners:
  `v(k−1, i+1), v(k, i), v(k, i+1), v(k+1, i)` — bands end in bottom tips one
  row BELOW their side vertices (the zigzag).
- **Kept portion:** rhombus bands 1..`rows` (R), R clamped to [1, n−2],
  default `max(2, round(0.5 × n))` further clamped. Natural base: the rim
  zigzags between rows R (sides) and R+1 (tips). Leveled base: the notches
  fill with the top halves of band R+1 (n triangles — their slanted edges
  already exist as band-R lower edges) plus n horizontal base chords
  `v(R+1, i)→v(R+1, i+1)`, giving a flat planar ring at row R+1 with the same
  footprint and depth as the natural tips.
- **Counts (test invariants):** natural: V = 1 + n(R+1), E = n(2R+1),
  triangles = 2nR, rhombi = nR, one strut type. Leveled: V unchanged,
  E = 2n(R+1) (adds n base chords), triangles = 2nR + n, two strut types
  (generator edges + base chords).
- **Faces:** each rhombus emits two triangles into `faces` (outward winding)
  with `Face.edgeIds` listing its real border edges only (length 2 — the
  diagonal is not an edge; nothing downstream indexes `edgeIds[2]`). Leveled
  half-rhombus triangles are ordinary 3-real-edge faces and flow the normal
  triangle paths everywhere.
- **Edges:** real zonohedron edges only — every one a translate of a
  generator — plus, when leveled, the base chords. The existing classifier
  yields one strut type natural, two leveled.
- **Rhombi metadata:** `DomeModel.rhombi?: { vertexIds: [number, number,
  number, number]; faceIds: [number, number] }[]` pairs each rhombus with its
  triangles, for panel takeoff and whole-rhombus vent painting.
- **Normalization:** scale so the widest kept row spans the unit diameter
  (user diameter = the zome's visual width, matching geodesic conventions).
  `cutZ` = normalized z of the LOWEST kept row (R+1 — tips or leveled ring),
  so the floor grid and riser sit at the true bottom; `unitHeight`,
  `unitBaseRadius` from the kept geometry; `actualFraction` = kept height /
  full zonohedron height.
- **Shared classifier:** the strut/hub classification + dihedral tail of
  `generateDome` is extracted into a `classifyModel()` helper in `dome.ts`
  (or a small shared module) that both generators call. The only refactor.

### State & UI

- New state: `mode: 'geodesic' | 'zome'` (default geodesic), `zomeSides`
  (4–16, default 8), `zomePitchDeg` (20–70, default 45), `zomeRows`
  (1..sides−2, defaulted/clamped when sides changes).
- `model` computed switches on mode. Geodesic settings (frequency, fraction)
  are separate fields and survive mode round-trips. `baseMode` is SHARED —
  the "Leveled base ring" switch stays visible in zome mode, where leveling
  fills the zigzag rim.
- Parameters panel: Geodesic/Zome toggle at the top of the Geometry section.
  Zome mode swaps Frequency/Fraction for Sides (select), Profile (pitch
  input, °), and Rows; the Leveled-base switch remains.
- Header chip: `Z8 · 45° · ⌀ 26 ft` in zome mode.
- Persistence, project JSON (`settings.mode`, `settings.zome{Sides,PitchDeg,Rows}`),
  and reset-to-defaults carry the new fields.

### Downstream systems

- **Doors & framed windows:** portal cutter unchanged — it clips real edges
  and sections triangles regardless of surface. Placement optimizer works;
  its ±36° search window covers the zome's 360/n symmetry period for all
  n ≤ 16. Riser pass-through (`riserHeight`) applies as in geodesic mode.
- **Riser wall:** eligibility is `baseMode === 'leveled'` in both modes (a
  zigzag rim cannot take a flat wall; the leveled zome ring is planar).
  `orderedBaseRing` and `buildRiser` work unchanged (boundary edges → ring
  walk; the leveled zome's boundary edges are the n base chords).
- **Panels:** `planPanels` gains `rhombs?: { d1: number; d2: number }[]` →
  `PanelPlan.rhombs: RhombPanelType[]` labeled `Z1…`, nesting 2 per d1×d2
  bounding rectangle (the triangle trick), seamed fallback with the existing
  waste factor, `skinFactor` honored, totals folded in. In zome mode the
  composable passes every face id as excluded (no triangle takeoff) and feeds
  the surviving rhombi — those whose triangles are neither doorway-removed
  nor painted as openings.
- **Vents / painting:** `paintFace` maps a clicked triangle to its rhombus
  partner and paints both; erase likewise. Flood-fill analysis unchanged.
- **Cut list / packing / optimizer:** untouched — one strut row plus portal
  and riser rows. The optimizer takes the model as-is (mode-agnostic).
- **Exports:** OBJ/GLTF/CSV/SVG/DXF flow through the model; project JSON round-trips
  the mode + zome params.

### Testing

- Zonohedron invariants per (n, R): natural V = 1 + n(R+1), E = n(2R+1),
  triangles 2nR, rhombi nR; leveled adds n chords and n triangles.
- Natural: every edge equal length (1e-9), exactly one strut type at any
  pitch. Leveled: exactly two strut types; base chords all equal.
- Rows planar; leveled base ring has n hubs; `orderedBaseRing` length n.
- Pitch changes height/width ratio but never edge equality.
- Door cut on a zome: trimmed struts land on envelope planes, closure builds.
- Riser on a leveled zome: segments = n, plates/studs/sheathing as in
  geodesic; riser null on a natural (zigzag) zome.
- Rhombus panel takeoff: `rows` distinct types × n each; doorway-removed
  rhombi excluded; both-skins doubles.
- Persistence + JSON round-trip of mode and zome params.
- Part A: 1V/2V kit tests as listed above.

## Out of scope (deliberate)

- Mixed geodesic/zome hybrids.
- Zonohedra with unequal generator lengths or non-polar arrangements.
- Class II (triacon) geodesic subdivision.
- Zome-specific hub connector drawings.
