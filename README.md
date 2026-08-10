# DOMEZ — Parametric Dome CAD

**Design, analyze, and fabricate real geodesic domes, zomes, and hex/pent domes — in the browser.**

**→ Live app: [f0ursqu4r3.github.io/domez](https://f0ursqu4r3.github.io/domez/)**

All geometry is generated from first principles — no stored dome plans. Pick a structure
family, size it, cut openings, check the loads, and print the drawings.

## Three structure families

| | Geometry | Character |
|---|---|---|
| **Geodesic** | Icosahedron → class I subdivision (1V–6V) → sphere projection → ring truncation (3/8 · 1/2 · 5/8) | The classic. Triangulated, rigid as a bare frame |
| **Zome** | Polar zonohedron — n generators at a pitch you choose (20–70°) | Every strut the same length; rhombic panels; bullet-to-onion profiles |
| **Hex/Pent** | Goldberg dual of the geodesic sphere | 12 pentagons in a field of hexagons, every joint 3-way — panels are structural (a bare hex frame is not rigid, and the app says so) |

Odd-frequency geodesics and zomes have naturally staggered bases; the **leveled base**
option produces a flat foundation ring in every family (slid hubs, half-rhombi, or clipped
partial polygons respectively). A stud-framed **riser (knee) wall** can lift any leveled
dome, with doors cutting through it to the foundation.

## Design

- **Parametric everything** — frequency/sides/pitch, sphere fraction, diameter,
  imperial/metric, material, joint method, panel skin placement, cut rounding, stock lengths.
- **Openings** — parametric doorways cut through the frame (interrupted struts trim back to
  the buck; jambs + header join the cut list), framed windows placed by click at real sill
  heights, per-panel window/vent painting with glazing takeoffs.
- **Interactive 3D** — assembly / frame / surface / exploded / loads view modes, per-part
  inspection, a billboard scale figure (5′9″ / 175 cm), and a floor grid with real-unit
  rings. **True size** mode renders joint-accurate geometry: spoked hubs, timber plates
  with beveled ends, flattened-pipe tab stacks, or fully mitered hubless intersections cut
  by exact convex clipping.
- **Diameter optimizer** — scans a range for the cleanest cut rounding and least stock
  waste (first-fit-decreasing packing into your stock lengths).

## Analyze

- **Loads view** — a real pin-jointed 3D truss solve (direct stiffness method) of dead +
  snow + wind cases, enveloped per member by utilization. Struts color by demand
  (tension blue, compression red, over-capacity magenta); the Loads tab lists worst
  members with governing case, base reactions, and uplift anchors. Compression capacity
  is Euler-buckling-aware, so long slender struts score honestly.
- **Honesty built in** — zome and hex/pent pin-frames are mechanisms; the app shows a
  disclosure instead of fake numbers. Every result carries the standing disclaimer:
  *educational estimate, pin joints, intact frame, not a substitute for a structural engineer.*

## Fabricate

- **Cut list** — exact vs rounded lengths with error bounds, axial hub angles, panel
  dihedrals, per-end compound miter angles (mitered joint CSV).
- **Printable SVG documents** — 1:1 end-region cut templates with calibration rulers,
  board-by-board cutting diagrams, a course-by-course assembly guide, dimensioned panel
  flat patterns, fabrication drawings, hub labels.
- **Costs** — a hardware BOM per joint method (connectors, bolts, screws, anchors, panel
  fasteners) priced through an editable price book with honest ballpark defaults; unpriced
  lines are counted, never invented.
- **Exports** — CSV (cuts / boards / hubs / openings / panels / miters / loads / costs),
  SVG, DXF, OBJ, GLB, and round-trippable project JSON.

## Share

The header share button packs the entire project into the URL hash
(deflate + base64url, ~500 chars) — no backend, no expiry. Opening a link applies the
project instantly for fresh visitors and asks first if you have your own work in progress.
Hostile links are neutered: payloads are validated, clamped, and size-capped.

## Run it locally

```bash
bun install
bun run dev      # dev server
bun run test     # 133-test suite
bun run build    # production build
```

Pushes to `main` deploy automatically to GitHub Pages through a test-gated Actions
workflow — a red suite never ships.

## Architecture

```
Vue 3 + Tailwind v4 + shadcn-vue UI
        │
Three.js viewer  ←  src/lib/three-builders.ts
        │
src/engine/   pure TypeScript, zero DOM deps
  icosahedron → subdivide → dome | zome | goldberg
  → classify → cutlist → packing → optimize → assembly
  → doorway → riser → panels → miter → loads → bom → exports/
```

The engine is validated in `src/engine/__tests__/` against published references and
first-principles invariants: Domebook chord factors (2V/3V), kit strut counts
(3V 4/9 = 30/40/50, 5V 5/8 = 425 struts / 9 types), icosphere and Goldberg-dual counts
(V = 20ν², E = 30ν², 12 pentagons), disk-topology Euler characteristics, textbook truss
solutions (pyramid, tripod), and global equilibrium of every load case.

## Notes for builders

- Cut lengths = chord − 2 × end offset (joint dependent). Hole-to-hole chord lengths are
  in the CSV for flattened-pipe builds.
- The axial angle per strut type is the hub-end cut angle: `90° − asin(chord/2R)`.
- Rounding error is bounded by half the chosen increment; the optimizer typically finds
  diameters with max error ≤ 1/32″ in a 10 ft search range.
- Openings are not modeled in the loads analysis — the door buck must restore the cut
  members' load path. PVC creeps; treat its capacity as short-term only.
