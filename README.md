# DOMEZ — Parametric Geodesic Dome CAD

Design, visualize, optimize, and fabricate real geodesic domes. All geometry is generated
from first principles (icosahedron → class I subdivision → sphere projection → ring
truncation) — no stored dome plans.

## Run

```bash
bun install
bun run dev      # dev server
bun run test     # engine test suite (validated against published chord factors)
bun run build    # production build
```

## What it does

- **Parametric model** — frequency 3V–6V, sphere fraction (3/8 · 1/2 · 5/8), diameter,
  imperial/metric, material, joint method, cut rounding increment, available stock lengths.
- **Truncation that matches real kits** — cuts snap to the cleanest vertex ring
  (3V → the classic 4/9 and 5/9 domes; even frequencies get exact hemispheres). Odd
  frequencies have a naturally staggered base; the **leveled base** option slides base hubs
  along the sphere onto the cut plane, like flat-base kits (adds a few strut types).
- **Interactive 3D viewer** (Three.js) — assembly / frame / surface / exploded modes,
  click any strut or hub for lengths, angles, quantities, and hub patterns. Strut types are
  color-coded everywhere: 3D model, legend, cut list, cutting diagrams, fabrication SVG.
- **Fabrication outputs** — cut list with exact vs rounded lengths and error, axial (hub)
  angles and panel dihedrals, hub schedule, board-by-board cutting diagrams with kerf and
  waste, bottom-up assembly plan with per-course strut tallies, printable hub labels.
- **Diameter optimizer** — scans a range and scores candidates on clean cut rounding +
  minimal stock waste (first-fit-decreasing packing into your stock lengths).
- **Exports** — CSV (cut list / boards / hubs), SVG (fabrication drawings, hub labels),
  DXF (strut templates + top-view plan), OBJ, GLB, and a round-trippable project JSON.

## Architecture

```
Vue 3 + Tailwind v4 + shadcn-vue UI
        │
Three.js viewer  ←  src/lib/three-builders.ts
        │
src/engine/   pure TypeScript, zero DOM deps (portable to CLI/WASM)
  icosahedron → subdivide → dome (truncate/classify/hubs/angles)
  → cutlist → packing → optimize → assembly → exports/
```

The engine is validated in `src/engine/__tests__/` against published references:
Domebook chord factors (2V/3V), kit strut counts (3V 4/9 = 30/40/50, 3V 5/9 = 30/55/80,
5V 5/8 = 425 struts / 9 types, 6V 1/2 = 555 struts), icosphere invariants, and disk-topology
Euler characteristics.

## Notes for builders

- Cut lengths = chord − 2 × end offset (joint dependent). Hole-to-hole chord lengths are in
  the CSV for flattened-pipe builds.
- The axial angle shown per strut type is the hub-end cut angle: `90° − asin(chord/2R)`.
- Rounding error is bounded by half the chosen increment; the optimizer typically finds
  diameters with max error ≤ 1/32″ in a 10 ft search range.
