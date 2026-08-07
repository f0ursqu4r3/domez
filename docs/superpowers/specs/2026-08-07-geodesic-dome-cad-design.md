# Domez — Parametric Geodesic Dome CAD — Design

Date: 2026-08-07
Status: Approved-by-spec (user supplied full requirements; decisions below fill the open choices)

## Purpose

Lightweight CAD tool for designing, visualizing, optimizing, and fabricating real geodesic domes.
Primary use case: 20–30 ft diameter 5V 5/8 dome for real construction. All geometry generated
from parameters — no stored dome plans.

## Decisions (where the spec left options open)

1. **Geometry engine: pure TypeScript** (`src/engine/`, zero DOM/Three deps). The spec lists
   Rust→WASM as *optional*; a pure-TS module is portable to CLI/desktop later and avoids a
   toolchain the prototype doesn't need. Engine API is deliberately narrow so a WASM backend
   can replace it behind the same types.
2. **Subdivision: Class I ("alternate"), Method 1** — subdivide each icosahedron face into ν²
   planar triangles, project vertices to the sphere. This reproduces the published Domebook
   chord factors (2V: 0.54653/0.61803; 3V: 0.34862/0.40355/0.41241) and is what virtually all
   published dome plans assume. Engine supports ν ≥ 1; UI exposes V3–V6.
3. **Truncation: vertex-up orientation, cut at planar vertex rings.** With a vertex at the pole,
   vertices fall on discrete z-levels (planar rings). The requested fraction (3/8, 1/2, 5/8)
   snaps to the nearest ring; the UI reports the *actual* fraction (odd frequencies have no
   exact hemisphere — standard practice).
4. **Strut classification:** edges grouped by chord factor within 1e-6 tolerance → types
   A, B, C… ordered shortest-first. Hubs classified by valence + surrounding strut pattern.
5. **Joint methods** model an end offset per strut end (cut length = chord − 2×offset) plus
   fabrication notes: *hub connector* (user-set hub radius offset), *flattened pipe/conduit*
   (hole-to-hole = chord, add flatten allowance), *timber + hub plate* (offset, bevel notes).
6. **Angles reported:** axial angle per strut type (90° − asin(chord/2R), the hub-end cut
   angle) and face dihedrals for panelized builds.
7. **Optimizer:** scan diameter range at fixed step; per candidate, round each cut length to
   the chosen increment, score = weighted max rounding error + material waste from bin
   packing (first-fit-decreasing) into available stock lengths with kerf. Report best.
8. **Units:** imperial (decimal feet input, fractional-inch outputs) and metric (m input,
   mm outputs). Rounding increments: 1/32", 1/16", 1/8", 1/4" or 0.5/1/5 mm.
9. **Stack:** Vite + Vue 3 + TypeScript + Tailwind v4 + shadcn-vue + Three.js. State in one
   reactive composable (`useDomeProject`) — Pinia unnecessary at this size.
10. **Exports:** CSV cut list, JSON project (round-trippable), OBJ + GLTF (via Three
    exporter), SVG fabrication sheet (per-strut-type drawings with lengths/angles/labels),
    DXF (LINE/TEXT entities of strut templates).

## Architecture

```
Vue UI (panels)  ←→  useDomeProject (reactive state + derived model)
       │                      │
  Three.js viewer  ←  engine/ (pure TS: icosahedron → subdivide → project →
                               truncate → classify → hubs → cutlist → optimize → pack)
```

### Engine modules
- `types.ts` — Vertex {id, position, edgeIds, hubType}, Edge {id, v0, v1, chordFactor,
  length, typeId}, Face {id, vertexIds, neighborIds}, StrutType, HubType, DomeModel
- `icosahedron.ts` — canonical icosahedron, vertex-up rotation
- `subdivide.ts` — class-I subdivision with vertex dedup, sphere projection
- `dome.ts` — ring detection, truncation, classification, hub topology, angles
- `cutlist.ts` — joint offsets, rounding, per-type quantities/errors
- `packing.ts` — FFD bin packing into stock, kerf, waste %
- `optimize.ts` — diameter search
- `units.ts` — fractional inches, mm formatting, parsing
- `exports/` — csv.ts, json.ts, svg.ts, dxf.ts, obj.ts

### UI
- Left sidebar: parameters (frequency, fraction, diameter, units, material, joint,
  rounding, stock lengths) + optimizer
- Center: Three.js viewer — modes: assembly / frame / surface / exploded; click strut → type,
  lengths, angles, count; click hub → valence, strut pattern, angles
- Right drawer/tabs: Cut list, Hubs, Materials & packing, Exports

## Testing (vitest, engine only)

- Icosphere invariants: V=10ν²+2, E=30ν², F=20ν²; all |v|=R within 1e-9; Euler V−E+F=2
- Published chord factors: 2V and 3V exact to 1e-5
- 3V 5/8 dome: 3 strut types, counts 30/40/50; dome Euler V−E+F=1
- Cut list rounding: max error ≤ increment/2; packing: total cuts ≤ stock capacity, waste ≥ 0
- Units: fractional-inch round trips

## Milestone (this build)

V5 5/8 dome generated and displayed interactively; diameter editable; strut lengths shown;
CSV cut list export — plus the optimizer, packing, hub info, view modes, and full export set
described above since they share the same engine.

## Out of scope (future)

Structural/wind/snow analysis, solar layout, floor planning, openings, CNC templates,
laser-cut hub plates, design sharing.
