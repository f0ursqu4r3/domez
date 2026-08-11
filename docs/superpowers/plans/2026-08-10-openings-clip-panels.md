# Openings Clip Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panels crossed by a framed opening survive as clipped shapes (skin, rendering, frames, jigs, packing) instead of being deleted; framed-panel mode stops rendering orphan trimmed sticks.

**Architecture:** `doorway.ts` exports its cut prisms; a new `panelClip.ts` clips every convex panel unit against them via convex-difference decomposition (Sutherland–Hodgman only) into fragments + merged boundary loops with cut-edge flags. `panelFrames.ts`, the skin takeoff, and `three-builders.ts` consume clip results; hub-style strut trimming is untouched.

**Tech Stack:** TypeScript, Vue 3, Three.js, vitest (`bun run test`), vue-tsc via `bun run build`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-openings-clip-panels-design.md`.
- Hub/pipe/timber/mitered strut trimming, cut lists, loads, floor plan, share codec: UNCHANGED. The doorwayShapes characterization test and all existing tests stay green (one exception: tests that assert whole-panel omission counts under doorway cuts may be updated to the clip semantics — each such change must be named in the task report).
- Painted per-face openings (`state.openings` window/vent) keep whole-face exclusion — clipping applies to parametric opening prisms only.
- Panels fully inside a prism are removed; touched panels are clipped; slivers < 1e-6·panel area drop.
- Clipped frame types: labels `X1, X2, …`, `siteFit: true`, one member per loop edge, miters = half interior angle, cut edges noted.
- Framed-panel mode: no `struts-trimmed` mesh, no `kind: 'trimmed'` cut-list rows.
- Work on `main`; every task ends `bun run test` green; commits end `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Golden repro (used across tasks)

```ts
import { generateZome } from '../zome' // adjust: the zome generator entry — check src/engine/zome.ts exports; if generation goes through a facade (dome.ts generate*), use that.
const R = (26 * 12) / 2 // 26 ft dome, inches
// Z10 55° 5 rows leveled — the user's report scene
const zome = generateZome({ sides: 10, pitchDeg: 55, rows: 5, baseMode: 'leveled' })
const archDoor = { id: 'D1', azimuthDeg: 288, width: 36, height: 80, extraDepth: 18, margin: 12, shape: 'arch' as const }
```

(Adapt the generator call to the real API in `src/engine/zome.ts` / `src/engine/dome.ts` — engine tests for zomes exist in `engine.test.ts`, copy their construction.)

---

### Task 1: `openingPrisms` export (doorway.ts)

**Files:**
- Modify: `src/engine/doorway.ts` (factor the per-door frame construction used by `cutDoorways` at ~lines 555–620: margined polygon → `buildEnvelopePlanes` → `cutPlaneDist`)
- Test: `src/engine/__tests__/panelClip.test.ts` (new file, started here)

**Interfaces:**
- Consumes: existing internals (`openingOutline`, `offsetConvexOutward`, `buildEnvelopePlanes`, fit math).
- Produces (Tasks 2+ rely on):

```ts
export interface OpeningPrism {
  doorId: string
  ux: number; uy: number; z0: number
  /** Inside = every nt·t + nz·(z − z0) ≤ c, with t = −uy·x + ux·y. */
  planes: { nt: number; nz: number; c: number }[]
  /** AND u = ux·x + uy·y ≥ cutPlaneDist. */
  cutPlaneDist: number
}
export function openingPrisms(
  model: DomeModel, doors: DoorSpec[], radius: number, opts: DoorwayOptions,
): OpeningPrism[]
```

Rules: identical to the strut-cut construction — margined polygon, floor-door bottom half-plane skipped, window bottom clamped to `zLowRel`, riser-conflicted or non-fitting doors contribute NO prism. `cutDoorways` must consume this same function internally (factor, don't duplicate — one construction, two callers).

- [ ] **Step 1: Write failing tests** (new `panelClip.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { cutDoorways, openingPrisms } from '../doorway'

const R = 156
const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
const door = { id: 'D1', azimuthDeg: 20, width: 36, height: 80, margin: 1.5 }

const insidePrism = (p: ReturnType<typeof openingPrisms>[number], x: number, y: number, z: number) => {
  const t = -p.uy * x + p.ux * y
  const u = p.ux * x + p.uy * y
  return u >= p.cutPlaneDist && p.planes.every((pl) => pl.nt * t + pl.nz * (z - p.z0) <= pl.c + 1e-9)
}

describe('openingPrisms', () => {
  it('matches cutDoorways vertex removal exactly', () => {
    const prisms = openingPrisms(dome, [door], R, { minStubLength: 6 })
    expect(prisms).toHaveLength(1)
    const cut = cutDoorways(dome, [door], R, { minStubLength: 6 })
    for (const v of dome.vertices) {
      const [x, y, z] = v.position.map((c) => c * R)
      expect(insidePrism(prisms[0], x, y, z)).toBe(cut.removedVertices.has(v.id))
    }
  })
  it('riser-conflicted doors contribute no prism', () => {
    const short = { id: 'D1', azimuthDeg: 0, width: 36, height: 20 }
    expect(openingPrisms(dome, [short], R, { minStubLength: 6, riserHeight: 24 })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run** — `bun run test -- panelClip` → fails (no export).
- [ ] **Step 3: Implement** — extract the frame construction into a helper both `cutDoorways` and `openingPrisms` call.
- [ ] **Step 4: Full suite green** (`bun run test` — the doorwayShapes characterization is the refactor guard).
- [ ] **Step 5: Commit** — `feat: export openingPrisms — shared cut-region construction`

---

### Task 2: `panelClip.ts` — units, fragments, loops

**Files:**
- Create: `src/engine/panelClip.ts`
- Test: `src/engine/__tests__/panelClip.test.ts` (extend)

**Interfaces:**
- Consumes: `OpeningPrism` (Task 1), `DomeModel`, `Vec3`.
- Produces (Tasks 3–6 rely on these exact names):

```ts
export interface PanelUnit { ring: number[]; faceIds: number[] }
/** polys → rhombi + uncovered faces → faces. All convex. */
export function panelUnits(model: DomeModel): PanelUnit[]

export interface ClippedLoop {
  /** Closed loop, world scale (working units); pts[i]→pts[i+1 mod n]. */
  pts: Vec3[]
  /** cut[i] true = edge i lies on a prism boundary (opening interface). */
  cut: boolean[]
}
export interface ClippedPanel {
  unitIndex: number
  ring: number[]
  faceIds: number[]
  status: 'whole' | 'clipped' | 'removed'
  /** Disjoint convex fragments, CCW viewed from outside the dome.
   * 'whole': one fragment = the original ring. 'removed': empty. */
  fragments: Vec3[][]
  /** Outer loops CCW, hole loops CW (signed area against the panel
   * normal). 'whole': one loop, all cut flags false. */
  loops: ClippedLoop[]
  /** Surviving area, working units². */
  area: number
}
export function clipPanels(model: DomeModel, radius: number, prisms: OpeningPrism[]): ClippedPanel[]
```

**Algorithm (per unit):**
1. Panel plane basis (Newell normal + first-edge e1, e2 = n×e1 — same construction as `panelFrames.ts:91-127`), outline CCW in 2D.
2. Per prism: map each 3D constraint to a 2D half-plane on the panel plane (`nt·t + nz·(z−z0) ≤ c` and `u ≥ cutPlaneDist` are linear in world coords; substitute the plane parameterization `P(s1,s2) = cen + s1·e1 + s2·e2`). Collect K+1 half-planes `H_j`.
3. Convex difference: current fragment list starts as `[outline]`; for each prism, each fragment F decomposes into `F ∩ H̄_j ∩ H_0..j−1` for j = 0..K (Sutherland–Hodgman for each half-plane; complement clip = clip against the negated half-plane). Keep fragments with area ≥ 1e-6 × original panel area.
4. Loops: collect all fragment edges keyed by rounded endpoints (`round(coord × 1e4)` both orders); edges appearing twice are internal — drop both; chain the rest by endpoint key into closed loops. A loop edge is `cut` when its midpoint lies on some prism 2D half-plane boundary (|distance| < 1e-6 × panel diameter) AND inside that prism's other half-planes (+1e-6) — i.e. it borders the removed region; otherwise it survives from the original outline.
5. Status: `removed` when no fragments survive; `whole` when total fragment area ≥ (1 − 1e-9) × panel area AND no cut edges; else `clipped`. Fast path: if every prism's 2D region misses the panel's bounding circle, status 'whole' without clipping.
6. Back-map loop/fragment 2D points to 3D via the plane basis, scaled to working units.

- [ ] **Step 1: Write failing tests** (extend `panelClip.test.ts`):

```ts
import { clipPanels, panelUnits } from '../panelClip'

/** Polygon area from the Newell cross-sum (planar polygon, any orientation). */
const polyArea3 = (pts: [number, number, number][]) => {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  return Math.hypot(nx, ny, nz) / 2
}
const unitArea = (ring: number[]) => polyArea3(ring.map((vi) => dome.vertices[vi].position.map((c) => c * R) as [number, number, number]))

describe('clipPanels', () => {
  const prisms = openingPrisms(dome, [door], R, { minStubLength: 6 })
  const clips = clipPanels(dome, R, prisms)
  const units = panelUnits(dome)

  it('classifies every unit and conserves area', () => {
    expect(clips).toHaveLength(units.length)
    for (const c of clips) {
      const orig = unitArea(units[c.unitIndex].ring)
      const fragArea = c.fragments.reduce((s, f) => s + polyArea3(f as [number, number, number][]), 0)
      if (c.status === 'whole') expect(fragArea).toBeCloseTo(orig, 3)
      if (c.status === 'removed') expect(fragArea).toBe(0)
      if (c.status === 'clipped') {
        expect(fragArea).toBeGreaterThan(0)
        expect(fragArea).toBeLessThan(orig - 1e-6)
        expect(c.area).toBeCloseTo(fragArea, 6)
      }
    }
  })
  it('at least one unit is clipped (the door crosses panels) and loops close', () => {
    const clipped = clips.filter((c) => c.status === 'clipped')
    expect(clipped.length).toBeGreaterThan(0)
    for (const c of clipped) {
      for (const loop of c.loops) {
        expect(loop.pts.length).toBeGreaterThanOrEqual(3)
        expect(loop.cut).toHaveLength(loop.pts.length)
        expect(loop.cut.some(Boolean)).toBe(true) // a clipped panel borders the opening
      }
      // loop area sum equals fragment area sum
    }
  })
  it('porthole fully inside one panel produces an outer loop + hole loop', () => {
    // Reuse the Task 2 (openings-shapes) centroid probe on the 5V dome to
    // aim a 10" circle window at a panel interior; assert that panel's clip
    // has status 'clipped', 2 loops, one with all cut flags true (the hole)
    // and one with none (the untouched outer triangle).
  })
  it('no prisms → every unit whole', () => {
    for (const c of clipPanels(dome, R, [])) expect(c.status).toBe('whole')
  })
})
```

(The test file must implement the small area helpers concretely — Newell magnitude against the unit normal; the porthole test copies the existing `doorwayShapes.test.ts` centroid probe verbatim.)

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `panelClip.ts`** per the algorithm.
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit** — `feat: panelClip engine — convex-difference panel clipping with boundary loops`

---

### Task 3: Clip-driven `buildPanelFrames`

**Files:**
- Modify: `src/engine/panelFrames.ts` (whole file is 267 lines — read it all)
- Modify: `src/engine/optimize.ts` (per-candidate call site passes clips)
- Modify: `src/composables/useDomeProject.ts` (framePlan computed ~line 531; add a shared `panelClips` computed)
- Test: `src/engine/__tests__/panelFrames.test.ts` (extend)

**Interfaces:**
- Consumes: `clipPanels`, `openingPrisms`, `panelUnits`, `ClippedPanel`.
- Produces:

```ts
// FrameType gains:
holes?: [number, number][][]   // 2D hole outlines (same plane basis as outline)
siteFit?: boolean              // X-types only
// FrameMemberSpec gains:
cutEdge?: boolean              // true = lies on the opening interface (X-types only)
// buildPanelFrames signature becomes:
export function buildPanelFrames(
  model: DomeModel, radius: number, units: UnitSystem,
  doorway: DoorwayCut, clips: ClippedPanel[],
): PanelFramePlan
```

**Implementation:**
1. Replace the internal `units_`/`kept` derivation (`panelFrames.ts:66-80`) with the clip results: `whole` → today's PanelGeom path and signature grouping (F-types, byte-identical output when nothing is clipped); `removed` → counts toward `omittedPanels`; `clipped` → X-types.
2. X-type per clipped panel (no grouping): project each loop to the panel plane 2D (same basis as the outline math), outer loop → `outline` + `cornerAnglesDeg`, hole loops → `holes`. Members: one per loop edge across ALL loops — long point = edge length, miters = half the interior angle at each end vertex (within that loop), bevel: original outline edges keep the model-edge bevel lookup (`edgeByKey` on the ring vertices under the edge — a non-cut loop edge lies on a model edge; find it by matching direction/overlap, else bevel 0 + boundary true), cut edges get `bevelDeg 0`, `boundary: true`, and label suffix note handled in Task 6's cut list. Labels `X1, X2, …` continuing after the F-types, `panelCount: 1`, `siteFit: true`, `edgeMemberIdx` mapping as today (dedupe identical cuts within the panel).
3. Seams (`panelFrames.ts:242-256`): replace the kept-faces/removed-edges test with surviving-overlap: for each interior model edge with both panels not removed, each side's surviving intervals along the edge = the non-cut loop edges lying on that model edge (parameterize by projection onto the edge segment, merge intervals); seam length = total overlap of the two sides' interval sets; count a seam when overlap > 1e-6; bolts `max(2, ceil(overlap / spacing))` per today's spacing. Whole–whole edges reduce to today's full length.
4. Callers: `useDomeProject.ts` — add `const panelClips = computed(() => clipPanels(model.value, radius.value, openingPrisms(model.value, portalSpecs.value, radius.value, { minStubLength: minStubLength.value, riserHeight: workingRiserHeight.value })))` and pass `panelClips.value` into `buildPanelFrames`; expose `panelClips` in the return object (viewer + panelPlan use it in Tasks 4–5). `optimize.ts` — the framed-panel candidate scoring builds prisms + clips for the CANDIDATE's own doorway (same pattern as the existing per-candidate buildPanelFrames call; do not reuse a snapshot across candidates).

- [ ] **Step 1: Write failing tests** (extend `panelFrames.test.ts` — read its existing helpers first):

```ts
it('clipped panels become one-off site-fit X types with closed frames', () => {
  // golden zome repro + archDoor (header of the plan); cut + prisms + clips
  const plan = buildPanelFrames(zome, R, 'imperial', cut, clips)
  const xTypes = plan.types.filter((t) => t.siteFit)
  expect(xTypes.length).toBeGreaterThan(0)
  for (const t of xTypes) {
    expect(t.panelCount).toBe(1)
    expect(t.label).toMatch(/^X\d+$/)
    // members cover every loop edge: total member count (Σ count) equals
    // outline edges + hole edges
    const edgeCount = t.outline.length + (t.holes ?? []).reduce((s, h) => s + h.length, 0)
    expect(t.members.reduce((s, m) => s + m.count, 0)).toBe(edgeCount)
  }
})
it('no clipped panels → output identical to the pre-change plan', () => {
  // no doors: buildPanelFrames(zome, R, 'imperial', emptyDoorwayCut(), clipsOfNoPrisms)
  // pin: types.length, totalPanels, seamCount, boltCount against values
  // captured from the CURRENT implementation before refactor (capture in
  // Step 2 and hard-code).
})
it('seam overlap: an edge fully consumed by the opening is no seam', () => {
  // pick a model edge whose both faces are removed/heavily clipped by the
  // arch door; assert seamCount decreased vs the no-door plan by at least
  // the edges the door consumed, and every bolt count ≥ 2.
})
```

- [ ] **Step 2: Capture the no-door baseline** from the current implementation (run once, hard-code the numbers) BEFORE refactoring.
- [ ] **Step 3: Run new tests → fail. Implement. Full suite green** (`panelFrames.test.ts` existing tests must pass unchanged — whole-panel path frozen).
- [ ] **Step 4: `bun run build` clean** (signature change ripples).
- [ ] **Step 5: Commit** — `feat: clip-driven panel frames — X site-fit types, overlap seams`

---

### Task 4: Skin takeoff + packing for clipped panels

**Files:**
- Modify: `src/engine/panels.ts` (PanelPlan/PanelPlanOptions/planPanels)
- Modify: `src/composables/useDomeProject.ts:576-650` (panelPlan computed)
- Test: `src/engine/__tests__/engine.test.ts` (planPanels block) or a new describe in `panelClip.test.ts`

**Interfaces:**
- Consumes: `panelClips` computed (Task 3), `ClippedPanel`.
- Produces:

```ts
// panels.ts additions:
export interface ClippedPanelType {
  label: string            // X1, X2, … (aligned with frame labels by unit order)
  outline: [number, number][]   // outer loop, 2D working units
  holes: [number, number][][]
  trueArea: number
  bboxW: number
  bboxH: number
  seamed: boolean          // bbox exceeds one sheet
}
// PanelPlanOptions gains: clipped?: ClippedPanelType[]
// PanelPlan gains:        clipped: ClippedPanelType[]
```

**Implementation:**
1. `planPanels`: clipped pieces consume sheets by bounding rect (`rectsPerSheet` with bboxW×bboxH; too-big → seamed, area × SEAM_WASTE like existing big panels); `totalPanels`/`totalPanelArea` include them (trueArea × skinFactor).
2. Composable `panelPlan`: derive per-unit handling from `panelClips` instead of the removedFaces/dead-rhombus logic (`useDomeProject.ts:580-603`): `whole` units follow today's triangle/rhomb/poly paths; `clipped` units project loops to 2D (plane basis — reuse the goldberg flattening code at 604-637, factored into a small local helper) and push `ClippedPanelType`; `removed` contribute nothing. Painted openings (`state.openings`) still exclude whole faces BEFORE clipping is considered (a painted face makes its unit's painted faces excluded as today — keep the existing exclude-set path for painted faces; parametric prisms drive clipping only).
3. `panelsCsv` (`src/engine/exports/csv.ts`): add clipped rows (label, bbox, true area, seamed) — mirror the poly rows' format.

- [ ] **Step 1: Failing tests** — `planPanels` with one clipped entry (24×36 bbox, trueArea 500) on the 3V dome: `plan.clipped` has it, totalSheets grows accordingly, totalPanelArea includes 500 × skinFactor; a clipped bbox larger than the sheet → `seamed: true`.
- [ ] **Step 2: Implement engine + composable + CSV.**
- [ ] **Step 3: Full suite + build green.**
- [ ] **Step 4: Commit** — `feat: clipped skin panels in the takeoff, packing, and CSV`

---

### Task 5: Rendering — clipped frames, fragments, no orphan sticks

**Files:**
- Modify: `src/lib/three-builders.ts` (panel-unit duplicate at ~787-802 → import `panelUnits`; framed members pass at ~782-1000; trimmed mesh at ~430-452; skin/surface face rendering — find the face-mesh builder that filters `removedFaces` and the panel-unit filter at ~688)
- Modify: `src/components/DomeViewer.vue` (pass `panelClips` through the render options)
- Test: none (visual) — `bun run test` + `bun run build` green; Task 7 verifies live.

**Interfaces:**
- Consumes: `panelClips` (via a new `RenderOptions.panelClips?: ClippedPanel[]`), `panelUnits`.

**Implementation:**
1. `RenderOptions` gains `panelClips?: ClippedPanel[]`; DomeViewer passes the composable's `panelClips`.
2. Framed-member pass: replace the local `panelUnits` derivation + `kept` filter with clip results — `whole` panels render exactly as today (their ring path); `clipped` panels render one member solid per loop edge, in-plane (edge dir × in-plane perpendicular using the panel normal — same construction as the existing per-edge member code; cut edges have no model edge id → use `eid = -1` for the faceMap and the default panel color). `removed` render nothing.
3. Trimmed sticks: build the `struts-trimmed` mesh only when NOT framed-panel mode.
4. Skin/surface rendering: where faces are filtered by `removedFaces`, render `whole` units' faces as today; `clipped` units render their `fragments` fan-triangulated (positions only + computeVertexNormals, matching the existing face-mesh material); `removed` nothing. Note: keep raycast/selection behavior for whole faces; clipped fragments are non-pickable (name them `panel-clipped-${unitIndex}`).
5. Delete the "keep in sync by hand" comment — the sync problem is gone.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: `bun run test` + `bun run build` green.**
- [ ] **Step 3: Commit** — `feat: render clipped panels — loop members, skin fragments, no orphan sticks in framed mode`

---

### Task 6: Cut list, jig SVG, patterns

**Files:**
- Modify: `src/engine/cutlist.ts` (trimmed block ~158-195: skip when `useFramePlan`)
- Modify: `src/engine/exports/frames.ts` (X-types: holes + site-fit caption; cut-edge member note)
- Modify: `src/engine/exports/svg.ts` (`panelPatternsSvg`: clipped one-off patterns from `PanelPlan.clipped`)
- Test: `src/engine/__tests__/panelClip.test.ts` (extend) or `panelFrames.test.ts`

**Implementation:**
1. `cutlist.ts`: when `useFramePlan` is true, skip the trimmed-piece row block entirely (removed/trimmed struts are already excluded from type counts; the frame rows carry the panels). Non-framed joints unchanged.
2. `frames.ts`: render X-types through the existing per-type path; draw `holes` as inner polygons; caption `site-fit — cut edges marked` and mark cut-edge members (`boundary && miter 0 && the type is siteFit` is NOT reliable — extend `FrameMemberSpec` in Task 3 with `cutEdge?: boolean` and use it here; annotate those edges with a dashed stroke + `data-cut-edge` attribute).
3. `svg.ts` patterns: for each `PanelPlan.clipped` entry emit one pattern block (outline + holes polygons, label + true area + "site-fit" caption) — reuse the existing pattern-drawing helpers.
4. Tests:

```ts
it('framed cut list has no trimmed rows; X members present', () => {
  const list = buildCutList(zome, { radius: R, increment: 0.125, endOffset: 0, units: 'imperial', jointId: 'framed-panel' }, cut, null, plan)
  expect(list.rows.some((r) => r.kind === 'trimmed')).toBe(false)
  expect(list.rows.some((r) => r.label.startsWith('X1'))).toBe(true)
})
it('hub-mode cut list still carries trimmed rows', () => {
  const list = buildCutList(zome, { radius: R, increment: 0.125, endOffset: 2, units: 'imperial', jointId: 'hub' }, cut)
  expect(list.rows.some((r) => r.kind === 'trimmed')).toBe(true)
})
it('jig svg draws X types with data-cut-edge markings', () => {
  const svg = frameJigsSvg(plan, 'imperial') // adjust to the real export name in frames.ts
  expect(svg).toContain('X1')
  expect(svg).toContain('data-cut-edge')
})
```

(Adjust `buildCutList` framePlan argument order and `frames.ts` export names to the real signatures — read the files first. Note Task 3 must add `cutEdge?: boolean` to `FrameMemberSpec`; if it didn't, add it here and set it in panelFrames.)

- [ ] **Step 1: Failing tests → implement → suite + build green.**
- [ ] **Step 2: Commit** — `feat: framed cut list drops stick rows; X-type jigs + clipped skin patterns`

---

### Task 7: Live verification

**Files:** none (browser).

- [ ] Golden scene (Z10 55° 5 rows leveled ⌀26–31 ft, framed panels, arch door 36×80 depth 18 margin 12): panels around the arch are clipped to the envelope — no whole-panel crater; NO misaligned base stub (the orphan stick is gone); frame members hug the clipped outlines including the cut edge.
- [ ] Frame schedule shows X-types (site-fit) with one-off counts; F5-b style counts no longer drop whole panels (compare vs pre-change: 56 → more kept panels).
- [ ] Surface view: skin hole equals the opening envelope exactly.
- [ ] Porthole (circle window) placed inside one rhombus: panel stays with a hole; jig SVG shows the rim; no console errors.
- [ ] Hub joint method on the same scene: trimmed sticks still render and appear in the cut list (unchanged path).
- [ ] Exports: frames jig SVG (X types, data-cut-edge), panels CSV clipped rows, panel patterns SVG one-offs.
- [ ] Kill the dev server when done.
