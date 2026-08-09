# Loads View — Truss Analysis Design Spec

**Date:** 2026-08-09
**Status:** Approved for planning

## Summary

A structural loads view for geodesic domes: a real 3D pin-jointed truss
solver (direct stiffness method) computes per-strut axial forces and
per-hub reactions under dead, snow, and wind load cases, checks each
member against tension and buckling capacity, and presents results as a
color-coded 3D view mode plus a Loads data tab. Zome and hex/pent frames
are not triangulated — a pin-frame mechanism — and get an honest
disclosure instead of numbers. Standing disclaimer everywhere results
appear: educational estimate, pin-joint idealization, not a substitute
for a structural engineer.

## Decisions (from brainstorming)

1. Real solver — direct stiffness, not tributary-area heuristics.
2. Load cases: dead + snow + wind (editable snow/wind pressures and skin
   density), enveloped per member.
3. Geodesic-only v1; zome/goldberg show the mechanism disclosure.
4. Presentation: "Loads" view mode (color-coded struts) + a Loads tab.

## Engine: `src/engine/loads.ts`

Pure TS, SI internally (N, m, Pa). Working units convert at the boundary:
imperial inches × 0.0254 → m; metric mm × 0.001 → m.

```ts
export interface StructureProps {
  eMPa: number         // Young's modulus
  densityKgM3: number
  sigmaTMPa: number    // allowable tension stress (already factored)
  sigmaCMPa: number    // allowable compression (crushing) stress
  wallMm?: number      // tube wall; required for round sections
}
export interface LoadInputs {
  snowKPa: number      // roof snow pressure on plan projection
  windKPa: number      // basic wind pressure on windward faces
  skinKgM2: number     // panel areal density per skin
  skinFactor: 1 | 2    // panelPlacement 'both' = 2
}
export interface MemberResult {
  edgeId: number
  forceN: number       // signed; + tension, − compression (envelope worst |N|)
  utilization: number  // |N| / capacity for the governing sign
  caseLabel: 'D' | 'D+S' | 'D+W'
}
export type LoadsResult =
  | {
      ok: true
      members: MemberResult[]           // one per edge, edge order
      reactions: { vertexId: number; fN: [number, number, number]; uplift: boolean }[]
      maxUtilization: number
      totalWeightN: number              // dead load total
    }
  | { ok: false; reason: 'unsupported-family' | 'mechanism' }

export function analyzeLoads(
  model: DomeModel,
  radiusWorking: number,
  units: UnitSystem,
  section: StrutSection,
  props: StructureProps,
  inputs: LoadInputs,
): LoadsResult
```

- **Family guard:** `model.rhombi || model.polys` present →
  `{ ok: false, reason: 'unsupported-family' }` before any math.
- **Section properties** (exported helpers, unit-tested):
  `sectionArea(section, wallMm?)` and `sectionImin(section, wallMm?)` in
  m² / m⁴. Rect: A = b·d, I_min = (max · min³)/12. Round tube:
  ID = OD − 2·wall, A = π/4(OD² − ID²), I = π/64(OD⁴ − ID⁴). Round with
  no wall → throw (materials always carry wallMm for round sections).
- **Truss solve:** nodes = vertices (3 DOF), members = edges with
  k = EA/L; global stiffness assembled from k·û·ûᵀ blocks into a dense
  Float64Array; `isBase` vertices fully pinned (eliminated DOF). Cholesky
  factorization; a non-positive pivot (≤ 1e-9 × trace scale) →
  `{ ok: false, reason: 'mechanism' }`. One factorization, three RHS.
- **Analyzed frame is the intact dome** — doorway cuts are NOT applied
  (disclaimer: the door buck must restore the removed members' load
  path). Panels add load, not stiffness (conservative for the frame).
  The base ring is treated as anchored whether or not a riser exists.
- **Face normals:** orient each face's normal outward (flip if
  n̂ · (centroid − domeCenter) < 0) before load projection.
- **Load cases** (three RHS vectors):
  - Dead (in every case): strut self-weight ρ·A·L·g split half to each
    end node, −z; panel weight per face = area × skinKgM2 × skinFactor ×
    g, split thirds to corners, −z. g = 9.81.
  - Snow: faces with n̂z > 0: F = snowPa × area × n̂z applied −z, split
    thirds.
  - Wind: ŵ = +x. Faces with n̂·ŵ > 0: F = windPa × area × (n̂·ŵ) along
    −n̂ (inward push), split thirds. Leeward suction ignored (disclosed
    as simplified).
  - Cases: D, D+S, D+W. Per member, envelope = the case with max |N|;
    record its label and signed force.
- **Member force:** N = (EA/L) · ûᵀ(d_j − d_i), tension positive.
- **Reactions:** at each support, sum of incident member end forces minus
  applied nodal load; `uplift` = true when the vertical reaction pulls
  the hub off the foundation (anchor demand).
- **Capacity per member** (length-dependent):
  capT = σt·A; capC = min(σc·A, π²EI_min / (L² × 2.5)) — Euler
  pinned-pinned with FoS 2.5. utilization = N > 0 ? N/capT : |N|/capC.

## Material structural properties

`MaterialDef` gains `structure: StructureProps` (ballpark, conservative,
meant to be honest defaults — not editable in v1):

| id | eMPa | densityKgM3 | sigmaTMPa | sigmaCMPa | wallMm |
|---|---|---|---|---|---|
| lumber-2x4 | 11000 | 500 | 5 | 7 | — |
| lumber-2x2 | 11000 | 500 | 5 | 7 | — |
| emt-34 | 200000 | 7850 | 150 | 150 | 1.07 |
| pvc-1 | 2800 | 1400 | 10 | 10 | 3.38 |
| steel-tube-1 | 200000 | 7850 | 150 | 150 | 1.5 |

PVC results carry an extra note: PVC creeps under sustained load — treat
capacity as short-term only.

## State & persistence

- `state.loadInputs = { snowKPa: 0.96, windKPa: 0.96, skinKgM2: 8.5 }`
  (≈ 20 psf, 20 psf, 1.7 psf). Persisted in the localStorage slice AND in
  ProjectSettings JSON export (engineering inputs are project data, like
  `prices`). Restore validates each as a finite number ≥ 0; reset
  restores defaults.
- `ViewMode` union gains `'loads'`; the restore validation list and
  ViewModeBar's modes array include it (label "Loads").
- `loadsResult` computed in the composable: calls `analyzeLoads` with
  skinFactor from panelPlacement ('both' → 2 else 1). Lazy — only
  evaluated by the Loads view/tab when rendered.

## Rendering

- `three-builders.ts` BuildOptions gains
  `loads?: { forceN: number; utilization: number }[]` (per edge). When
  `mode === 'loads'`: struts render like assembly mode but in ONE
  instanced mesh with per-instance colors (`setColorAt`):
  - tension: gray `#6b7280` → blue `#3b82f6` lerped by min(u, 1)
  - compression: gray → red `#ef4444` lerped by min(u, 1)
  - u > 1: magenta `#d946ef`
  - hubs render as in assembly mode; no explode/true-size interplay
    (loads view ignores both).
- StrutLegend: when `viewMode === 'loads'`, show a utilization legend
  (two gradient bars + overload swatch) instead of strut types.
- DomeViewer passes `loads` (edge-indexed array or undefined) into
  buildDomeGroup when in loads view; selecting struts still works
  (InspectorCard unchanged).
- Zome/goldberg in loads view: dome renders as plain assembly and the
  overlay shows the mechanism disclosure chip (same copy as the tab).

## Loads tab (right sidebar, position 3: Parts, Openings, Loads, Materials, Build)

`LoadsTab.vue` with CollapsibleSections (ids `right:load-inputs`,
`right:load-results`):

- **Inputs**: snow pressure, wind pressure, skin density — numeric
  fields displayed in working units (imperial psf / lb·ft²: kPa × 20.885,
  kg/m² × 0.2048; metric shows kPa and kg/m² directly), stored SI.
- **Results** (geodesic + solve ok): max utilization stat card (green
  < 70%, amber < 100%, red ≥ 100%); worst-10 members table (strut type,
  length, force with T/C sign, utilization %, governing case); base
  reaction summary (max vertical, uplift count); total dead weight.
  PVC note when materialId is pvc-1.
- **Mechanism / unsupported**: Alert replacing results — zome/goldberg:
  "A pin-jointed zome/hex frame is a mechanism — the panels (stressed
  skin) carry the shape. Frame-only analysis would be meaningless;
  skin analysis is out of scope." Solver mechanism: "The frame is not
  self-supporting as a pin-jointed truss."
- **Disclaimer** (always visible, bottom): "Educational estimate. Pin
  joints, intact frame (openings not modeled — door bucks must restore
  the cut members' load path), simplified wind, no load combinations per
  code. Not a substitute for a structural engineer."

## Export

- `loadsCsv(model, result, units)` in `src/engine/exports/csv.ts`: one
  row per edge — edge id, type label, cut length, force (lbf imperial /
  N metric), tension/compression, utilization %, governing case. Exposed
  as `exporters.loadsCsv`; button appears in the Build tab's Fabrication
  group only when the current model is geodesic and the solve succeeded.

## Testing (vitest, engine-level)

- Section helpers: 2×4 area/I_min exact; EMT tube area/I vs hand calc;
  round without wall throws.
- Solver on textbook cases: symmetric 2-bar planar truss in 3D space
  (known N = P/(2·sinθ)); 3-leg tripod under vertical load (symmetry +
  equilibrium exact).
- Whole-dome invariants (3V 1/2 geodesic): Σ vertical reactions =
  total applied load (each case, 1e-6 rel); crown struts in compression
  under D+S; snow case forces symmetric for symmetric geometry; wind
  case breaks symmetry (windward ≠ leeward).
- Envelope: member caseLabel ∈ {D, D+S, D+W}; with snow ≫ wind, top
  members govern D+S.
- Buckling: same section, longer member → lower compression capacity;
  utilization uses capC for negative forces.
- Family guard: zome and goldberg models → `unsupported-family`.
- Mechanism: a geodesic model with all `isBase` flags cleared (no
  supports) → `mechanism`.
- CSV: header + one row per edge; imperial forces in lbf.

## Out of scope

- Stressed-skin / panel stiffness modeling, code load combinations
  (ASCE 7), leeward suction, editable material properties, riser wall
  analysis, seismic, per-hub connector engineering.
