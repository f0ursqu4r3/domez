# Joint-Accurate Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** True-size mode renders real joints per the selected joint method — hub connectors with spokes, timber plates with axial-beveled strut ends, flattened-pipe tab stacks — instead of schematic spheres.

**Architecture:** One pure engine helper (`hubAxes`) supplies per-vertex outward axes from adjacent-face normals (mode-agnostic). All visualization lands in `buildDomeGroup` behind `strutSection && jointId`; state wiring is two extra `BuildOptions` fields passed from `DomeViewer` and the GLTF exporter.

**Tech Stack:** Vue 3 + TypeScript, Three.js BufferGeometry, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-08-07-joint-accurate-rendering-design.md`

## Global Constraints

- Tests `bunx vitest run src/engine/__tests__/engine.test.ts`; build `bun run build`.
- Schematic mode (True size off) must render exactly as today.
- Joint geometry constants (from spec, all × strut dimension): hub core r=1.4×halfWidth h=2.4×width; spoke reach = endOffset; plate n-gon r=1.9×endOffset, thickness 0.25″/6mm; pipe tab w=1.57×OD t=0.15×OD, body stops 1.5×OD short, tab overshoot 0.35×OD, stack pitch = tab thickness; bolt r=0.19×OD.
- Pick spheres shrink to 0.55× schematic radius in joint mode, stay raycastable.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `hubAxes` engine helper

**Files:**
- Create: `src/engine/hubs.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**
- Produces: `export function hubAxes(model: DomeModel): Vec3[]` — one unit vector per vertex, outward.

- [ ] **Step 1: Failing tests**

```ts
describe('hub axes', () => {
  it('geodesic axes point along the vertex radial', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const axes = hubAxes(m)
    expect(axes.length).toBe(m.vertices.length)
    for (const v of m.vertices) {
      const a = axes[v.id]
      expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 9)
      const p = v.position
      const pl = Math.hypot(p[0], p[1], p[2])
      expect((a[0] * p[0] + a[1] * p[1] + a[2] * p[2]) / pl).toBeGreaterThan(0.9)
    }
  })
  it('zome apex axis is +z', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'leveled' })
    const axes = hubAxes(z)
    const apex = z.vertices.reduce((a, b) => (a.position[2] > b.position[2] ? a : b))
    expect(axes[apex.id][2]).toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
import type { DomeModel, Vec3 } from './types'

/** Outward hub axis per vertex: normalized sum of adjacent raw face
 * normals (area-weighted). Falls back to the normalized position. */
export function hubAxes(model: DomeModel): Vec3[] {
  const sums = model.vertices.map(() => [0, 0, 0] as [number, number, number])
  for (const f of model.faces) {
    const [a, b, c] = f.vertexIds.map((vi) => model.vertices[vi].position)
    const n = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ]
    for (const vi of f.vertexIds) {
      sums[vi][0] += n[0]
      sums[vi][1] += n[1]
      sums[vi][2] += n[2]
    }
  }
  return model.vertices.map((v, i) => {
    let [x, y, z] = sums[i]
    let len = Math.hypot(x, y, z)
    if (len < 1e-12) {
      ;[x, y, z] = v.position
      len = Math.hypot(x, y, z) || 1
    }
    return [x / len, y / len, z / len] as const
  })
}
```

- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: hubAxes — outward joint axes from face normals`

---

### Task 2: Joint-accurate rendering in buildDomeGroup

**Files:**
- Modify: `src/lib/three-builders.ts`, `src/components/DomeViewer.vue`, `src/composables/useDomeProject.ts` (gltf exporter opts)

**Interfaces:**
- `BuildOptions` gains `jointId?: 'hub' | 'flattened-pipe' | 'timber-plate'` (import `JointMethodId` from `@/engine/cutlist`) and `endOffset?: number`.
- Joint mode predicate inside builder: `const jointMode = section !== undefined && opts.jointId !== undefined`.

- [ ] **Step 1: Strut shortening + beveled ends.** In the strut loop, when `jointMode`:
  - Compute per-edge endpoints pulled back along the strut axis: `a' = a + dir̂ × endOffset`, `b' = b − dir̂ × endOffset` (skip pullback when `endOffset ≤ 0`, i.e. flattened pipe keeps full chord for hole-to-hole, but its body shortening is handled by the pipe visualization below).
  - Timber-plate + rect section: replace the InstancedMesh path for kept edges with ONE merged `BufferGeometry` of custom hexahedra per strut: build the 8 corners from the strut frame (xAxis width, zAxis depth as in `placeStrut`), then project the 4 corners of each end onto the plane through the pulled-back end point with normal = that end's hub axis (plane projection along the strut direction: `t = dot(axis, endPoint − corner) / dot(axis, dir̂)`). Per-type color preserved by building one merged geometry per strut type (positions + computeVertexNormals). Pick maps: store `strutMaps` per merged mesh with a triangle→edgeId map — reuse the panelMaps pattern: `pick.strutFaceMaps` — simpler: keep an invisible-size instanced mesh? NO — keep it honest: extend `DomePickMaps` with `strutFaceMaps: Map<THREE.Mesh, number[]>` (triangle index → edgeId, 12 triangles per strut) and include those meshes in the viewer's strut raycast targets.
  - Hub method & round sections: keep the InstancedMesh path, just with shortened placement (no geometry change needed — `placeStrut(m, a', b')`).
- [ ] **Step 2: Joint geometry per vertex.** After the hub-sphere section, when `jointMode`, for each kept vertex: gather incident kept edge directions (skip removedEdges/trimmedEdges — if none remain, still draw the core so the frame reads), hub axis from `hubAxes(model)[v.id]` converted to three-space (`(x, z, −y)`), then per `opts.jointId`:
  - `'hub'`: core cylinder along axis + spoke per direction (cylinder for round sections radius 0.62×OD, box for rect 1.15×w/d), length endOffset (min floor 0.5×width so zero-offset still shows a nub), steel material.
  - `'timber-plate'`: n-gon plate (`CylinderGeometry(r, r, t, valence)` oriented along axis, offset +(strutDepth/2 + t/2) along axis), steel material. No spokes.
  - `'flattened-pipe'`: per direction i: tab box (w=1.57×OD, t=0.15×OD, length 1.5×OD + 0.35×OD overshoot) placed flat (its thickness dimension along the hub axis) from body-end toward/past the vertex, offset along axis by `(i − (k−1)/2) × t`; plus one bolt cylinder + two washer discs along the axis. Tube bodies: in the strut loop, flattened-pipe mode pulls each end back `1.5 × OD` (instead of endOffset) so bodies stop where tabs begin.
  - Shrink pick spheres: `hubR × 0.55` in joint mode; skip nothing else.
  - Exploded mode: offset all per-vertex joint geometry by the same explode vector as the pick sphere (`p.normalize() × explodeDist × 1.15`).
- [ ] **Step 3: Wire it.** `DomeViewer`: pass `jointId: state.jointId, endOffset: workingEndOffset.value` (destructure `workingEndOffset`), add `state.jointId` + `workingEndOffset.value` to the rebuild watcher array, and include `pick.strutFaceMaps` meshes in the click raycast strut targets (both the door/window placement targets and the selection targets — map hit `faceIndex → edgeId`). `useDomeProject` gltf exporter: same two fields.
- [ ] **Step 4: Verify** — `bunx vitest run …` (unchanged) + `bun run build` clean.
- [ ] **Step 5: Commit** — `feat: joint-accurate true-size rendering — hubs, plates, pipe stacks`

---

### Task 3: Live verification

- [ ] **Step 1:** Preview: geodesic 3V leveled, True size ON, material Douglas Fir 2×4 (timber-plate): beveled strut ends + polygonal plates at every hub; end offset change visibly grows/shrinks the gaps. Screenshot.
- [ ] **Step 2:** Material EMT conduit (flattened-pipe): tube bodies stop short, tab stacks + bolts at each vertex. Screenshot.
- [ ] **Step 3:** Material steel tube (hub method): spoked hubs, struts at cut length. Zome mode spot check (axes off-sphere), exploded mode, place a door (removed hubs gone), click a strut and a hub (selection still works).
- [ ] **Step 4:** Commit any fixes; final suite + build.
