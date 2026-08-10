# Floor Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A top-down orthographic "Plan" view mode plus a dimensioned floor-plan SVG (footprint, dimensions, doors/windows, headroom rings).

**Architecture:** `src/engine/exports/plan.ts` renders the SVG from the model + doorway cut (paper.ts conventions; `orderedBaseRing` from riser.ts for the footprint; sphere/zonal-profile math for headroom rings). The viewer adds an orthographic camera swap under `viewMode === 'plan'`. One exporter + one ExportPanel item.

**Tech Stack:** Pure-TS engine + vitest; three.js OrthographicCamera; Vue 3.

## Global Constraints

- Headroom thresholds: imperial `[72, 48]` inches; metric `[2000, 1200]` mm. Sphere ring: `z* = cutZ·R − riser + h`; `h ≤ riser` → "everywhere" (no ring); `z* ≥ R` → "nowhere"; else `r* = √(R² − z*²)`. Zome: linear interpolation on the per-level (z, maxRadius) profile polyline.
- Plan mapping: plan x = world x, plan y = −world y (same as guide.ts's top-down projection). Azimuth 0° (+x) points right in both the SVG and the plan view mode.
- Windows are `doorway.doors` entries whose spec has `sillHeight > 0` (read DoorFrameInfo's actual field path first); doors are the rest.
- Data attributes: `data-plan-footprint`, `data-dim`, `data-door-gap`, `data-window-tick`, `data-headroom-ring` + `data-height`.
- `ViewMode` gains `'plan'`; ViewModeBar label "Plan" after Loads; persistence validation list updated.
- `bun run build` and `bun run test` must pass before every commit; gate on exit codes. Baseline 149 tests.

---

### Task 1: `plan.ts` engine + tests

**Files:**
- Create: `src/engine/exports/plan.ts`
- Test: `src/engine/__tests__/plan.test.ts`

**Interfaces:**
- Consumes: `PAPER`, `esc` (./paper); `formatLength` (../units); `orderedBaseRing` (../riser); `DomeModel`, `UnitSystem` (../types); `DoorwayCut` (../doorway).
- Produces: `PlanOptions { units, radius, riserHeight, wallThickness, title }`, `planSvg(model, doorway, opts): string`. Task 3 wires the exporter.

Headroom core (exact code — the rest of the SVG follows patterns.ts/frames.ts conventions the implementer reads first):

```ts
/** Ring radius (working units) where interior standing height crosses h,
 * or the qualitative outcome when no ring exists. */
export type HeadroomOutcome =
  | { kind: 'ring'; radius: number }
  | { kind: 'everywhere' }
  | { kind: 'nowhere' }

export function headroomRing(
  model: DomeModel,
  radius: number,
  riserHeight: number,
  h: number,
): HeadroomOutcome {
  if (h <= riserHeight) return { kind: 'everywhere' }
  const R = radius
  if (model.rhombi) {
    // Zome: rotational profile — per z level, the max horizontal radius.
    const levels = new Map<number, number>()
    for (const v of model.vertices) {
      const z = Math.round(v.position[2] * 1e6) / 1e6
      const r = Math.hypot(v.position[0], v.position[1])
      levels.set(z, Math.max(levels.get(z) ?? 0, r))
    }
    const prof = [...levels.entries()].sort((a, b) => a[0] - b[0]) // base → apex
    const zTarget = (model.cutZ * R - riserHeight + h) / R // unit z
    if (zTarget >= prof[prof.length - 1][0]) return { kind: 'nowhere' }
    if (zTarget <= prof[0][0]) return { kind: 'everywhere' }
    for (let i = 1; i < prof.length; i++) {
      const [z0, r0] = prof[i - 1]
      const [z1, r1] = prof[i]
      if (zTarget <= z1) {
        const t = (zTarget - z0) / (z1 - z0 || 1)
        return { kind: 'ring', radius: (r0 + (r1 - r0) * t) * R }
      }
    }
    return { kind: 'nowhere' }
  }
  // Sphere-based (geodesic + goldberg dual): unit sphere × R.
  const zStar = model.cutZ * R - riserHeight + h
  if (zStar >= R) return { kind: 'nowhere' }
  return { kind: 'ring', radius: Math.sqrt(R * R - zStar * zStar) }
}
```

`planSvg` layout contract (single page, paper.ts):
- Scale-to-fit the footprint + margin into the drawing box; all geometry through one `toPage(x, y)` mapping (plan y = −world y).
- Footprint: `orderedBaseRing(model)` vertex loop × radius → closed path with class stroke; a second inner path offset toward the centroid by `wallThickness` (per-vertex: move along the normalized (centroid − vertex) direction — polygon offset approximation is fine at these thicknesses); group `data-plan-footprint`.
- Dimension line below the footprint: min/max x extension ticks + `formatLength(maxX − minX)`; floor-area text (`(area/144).toFixed(0) ft²` / `(area/1e6).toFixed(1) m²` from the shoelace area of the ring); scale bar (pick step: imperial 24″ segments × 5, metric 500 mm × 5, scaled); azimuth arrow at 0° outside the wall labeled `0°`; all inside one `data-dim` group.
- Doors: angular half-span = `atan(width/2 / ringRadiusAtAzimuth)`; blank the wall stroke over that span (draw the wall as arc segments between door spans, or overlay a background-colored gap rect rotated to the azimuth — implementer's choice, must visually break BOTH wall lines); label `⟨width⟩ @ ⟨az⟩°`; group per door `data-door-gap`.
- Windows: a tick rectangle across the wall at the azimuth; label `⟨width⟩ @ ⟨az⟩° · sill ⟨h⟩`; group `data-window-tick`.
- Headroom: for each threshold call `headroomRing`; `ring` → dashed circle `data-headroom-ring data-height="⟨h⟩"` centered on the plan origin; legend line per threshold: `≥ ⟨h formatted⟩: ⟨radius circle | everywhere | nowhere⟩`. Zome legend appends '(interpolated from panel profile)'. Riser note when riserHeight > 0.

Tests (exact assertions; adapt only import/param shapes to engine.test.ts conventions):

```ts
// src/engine/__tests__/plan.test.ts — inside one describe('floor plan')
const NO_DOOR = emptyDoorwayCut()
const OPTS = { units: 'imperial' as const, radius: 156, riserHeight: 0, wallThickness: 3.5, title: 'Test' }

it('draws the footprint and monotonic headroom rings', () => {
  const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const svg = planSvg(m, NO_DOOR, OPTS)
  expect(svg).toContain('data-plan-footprint')
  const r72 = headroomRing(m, 156, 0, 72)
  const r48 = headroomRing(m, 156, 0, 48)
  expect(r72.kind).toBe('ring')
  expect(r48.kind).toBe('ring')
  if (r72.kind === 'ring' && r48.kind === 'ring') {
    const zStar = m.cutZ * 156 + 72
    expect(r72.radius).toBeCloseTo(Math.sqrt(156 ** 2 - zStar ** 2), 6)
    expect(r48.radius).toBeGreaterThan(r72.radius)
  }
  expect((svg.match(/data-headroom-ring/g) ?? []).length).toBe(2)
})

it('riser shifts rings outward; h ≤ riser means everywhere', () => {
  const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const base = headroomRing(m, 156, 0, 72)
  const raised = headroomRing(m, 156, 24, 72)
  if (base.kind === 'ring' && raised.kind === 'ring') {
    expect(raised.radius).toBeGreaterThan(base.radius)
  } else {
    throw new Error('expected rings')
  }
  expect(headroomRing(m, 156, 24, 20)).toEqual({ kind: 'everywhere' })
})

it('marks doors and windows distinctly', () => {
  const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  // Build a doorway cut with one door and one framed window using the same
  // helper/params engine.test.ts uses for doorway tests (cutDoorways with
  // door specs; the window entry has sillHeight > 0).
  // Assert: exactly one data-door-gap, exactly one data-window-tick, and
  // the window label contains 'sill'.
})

it('zome rings interpolate within the profile; tiny domes report nowhere', () => {
  const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
  const ring = headroomRing(z, 100, 0, 48)
  // 48″ on a 100″-radius zome: must be a ring strictly inside the base radius.
  expect(ring.kind).toBe('ring')
  if (ring.kind === 'ring') {
    expect(ring.radius).toBeGreaterThan(0)
    expect(ring.radius).toBeLessThan(100 * z.unitBaseRadius + 1e-6)
  }
  const tiny = generateDome({ frequency: 2, fraction: '3/8', baseMode: 'natural' })
  expect(headroomRing(tiny, 40, 0, 72).kind).toBe('nowhere')
  const svgTiny = planSvg(tiny, NO_DOOR, { ...OPTS, radius: 40 })
  expect(svgTiny).toContain('nowhere')
})

it('natural zigzag rims produce a full footprint polygon', () => {
  const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
  const svg = planSvg(m, NO_DOOR, OPTS)
  const ring = orderedBaseRing(m)
  expect(ring.length).toBeGreaterThan(0)
  expect(svg).toContain('data-plan-footprint')
})
```

(The doors/windows test body: complete it against the real doorway API — the assertions named in the comment are binding.)

Steps: failing tests → implement → 155-ish tests green (149 + ~6) → gated commit `feat: floor plan SVG — footprint, dimensions, openings, headroom rings`.

---

### Task 2: Plan view mode (viewer)

**Files:**
- Modify: `src/composables/useDomeProject.ts` (ViewMode union + restore list)
- Modify: `src/components/ViewModeBar.vue` (Plan entry)
- Modify: `src/components/DomeViewer.vue` (ortho camera swap)
- Modify: `src/lib/three-builders.ts` ONLY if an `opts.mode` site needs a `'plan'` case (grep first; expected: none — plan takes assembly defaults)

**Contract:**
- DomeViewer: module-scope `let planCamera: THREE.OrthographicCamera | null`, `let savedView: { position: THREE.Vector3; target: THREE.Vector3 } | null`. Watch `state.viewMode`:
  - entering `'plan'`: save `camera.position.clone()` + `controls.target.clone()`; build/update the ortho camera — frustum half-extents = `gridSpec(radius, units).radius × 1.05` adjusted for aspect, near/far generous (`0.1` to `radius × 10`), position `(0, radius × 4, 0)`, `up.set(0, 0, -1)`, `lookAt(0, 0, 0)`; `controls.object = planCamera`, `controls.target.set(0, 0, 0)`, `controls.enableRotate = false`, `controls.update()`; render loop + raycaster + resize handler use the ACTIVE camera (introduce `activeCamera()` helper or a `let currentCamera` reassigned in the watch).
  - leaving: `controls.object = perspectiveCamera`, restore saved position/target, `enableRotate = true`, `controls.update()`.
  - resize: when in plan mode recompute ortho left/right/top/bottom from aspect; perspective path unchanged.
- Scale figure hidden in plan mode: the figure visibility expression becomes `state.showFigure && state.viewMode !== 'plan'` (both in rebuildGround and the showFigure watch — or add viewMode to that watch).
- ViewModeBar: `{ value: 'plan', label: 'Plan' }` after Loads. True size/Figure toggles behave as now (true-size in plan mode is allowed and fine).
- Composable: union + restore validation list add `'plan'`.

Steps: implement → build + tests gated → commit `feat: plan view mode — top-down orthographic camera`.

---

### Task 3: Exporter + ExportPanel

**Files:**
- Modify: `src/composables/useDomeProject.ts` (exporter `floorPlan`)
- Modify: `src/components/panels/ExportPanel.vue`

**Contract:** exporter follows siblings: `planSvg(model.value, doorway.value, { units: state.units, radius: radius.value, riserHeight: workingRiserHeight.value, wallThickness: strutSectionWorking.value.kind === 'rect' ? strutSectionWorking.value.depth : strutSectionWorking.value.diameter, title: titleOf(...) — match how other exporters obtain the title })`, filename `${fileStem.value}-floor-plan.svg`. ExportPanel Fabrication group (all families/joints, unconditional): label "Floor plan SVG", desc "dimensioned plan + headroom", icon PencilRuler, run `exporters.floorPlan`.

Steps: implement → build + tests gated → commit `feat: floor plan exporter + Build tab entry`.

---

### Task 4: Live verification

- [ ] Plan mode: enter → top-down ortho (no perspective convergence), drag does NOT rotate, pan + zoom work, figure hidden, grid visible; screenshot. Leave → previous orbit restored exactly, figure back.
- [ ] Selection works in plan mode (click a strut).
- [ ] Floor plan SVG: geodesic 3V leveled with a door + a window — footprint, dimension line, scale bar, door gap with label, window tick with sill, two dashed headroom rings, legend; render standalone via data: URI and screenshot.
- [ ] Riser 24″: rings visibly larger; riser note present. Zome + goldberg exports render without errors.
- [ ] Fix-forward commits gated on build+tests.
