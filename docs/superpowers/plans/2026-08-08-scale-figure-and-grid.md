# Scale Figure + Real-Unit Floor Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A billboard person silhouette at standard height beside the dome, and floor-grid rings snapped to clean real-unit distances.

**Architecture:** A pure `gridSpec(radius, units)` helper picks the ring step (unit-tested); a `buildFigure(heightWorld)` three.js builder returns a flat silhouette group; DomeViewer's `rebuildGround` consumes both, the render loop Y-billboards the figure, and a persisted `state.showFigure` + ViewModeBar toggle controls visibility.

**Tech Stack:** Vue 3 + TypeScript, three.js, vitest (bun).

## Global Constraints

- Figure height: `state.units === 'imperial' ? 69 : 1750` working units (inches/mm). Color `0x64748b`. Feet at y = 0 of the group; group max height exactly 1.0 before scaling.
- `state.showFigure: boolean` default `true`; persisted in the localStorage slice exactly like `trueSize` (persistedSlice + restorePersisted + resetProject); NOT added to ProjectSettings JSON export (trueSize isn't there either).
- Grid candidate steps: imperial `[12, 24, 60, 120]` inches; metric `[500, 1000, 2000, 5000]` mm. Smallest step with `ceil(radius × 1.6 / step) ≤ 16`, else the largest step. `spec.radius = rings × step`.
- PolarGridHelper keeps 12 sectors, 48 segments, colors `0x2a3648, 0x1a2230`.
- No engine changes. `bun run build` and `bun run test` must pass before every commit; gate commits on exit codes (`cmd > /tmp/x.out 2>&1; RC=$?; …; [ $RC -eq 0 ] && git commit …`).

---

### Task 1: `gridSpec` helper

**Files:**
- Create: `src/lib/scale.ts`
- Test: `src/lib/__tests__/scale.test.ts`

**Interfaces:**
- Consumes: `UnitSystem` from `@/engine/types` (`'imperial' | 'metric'`).
- Produces: `gridSpec(radius: number, units: UnitSystem): GridSpec` with `GridSpec { step: number; radius: number; rings: number }` — Task 3's `rebuildGround` calls it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/scale.test.ts
import { describe, expect, it } from 'vitest'
import { gridSpec } from '../scale'

describe('floor grid spec', () => {
  it('picks clean imperial steps', () => {
    // 26 ft dome: radius 156 in, target 249.6 → 12 in gives 21 rings (>16),
    // 24 in gives 11 → step 2 ft.
    const s = gridSpec(156, 'imperial')
    expect(s.step).toBe(24)
    expect(s.rings).toBe(11)
    expect(s.radius).toBe(264)
    expect(s.radius).toBeGreaterThanOrEqual(156 * 1.6)

    // 3 ft dome: radius 18 in → finest step.
    expect(gridSpec(18, 'imperial').step).toBe(12)

    // 120 ft dome: radius 720 in → only 120 in keeps rings ≤ 16.
    const big = gridSpec(720, 'imperial')
    expect(big.step).toBe(120)
    expect(big.rings).toBe(10)
  })

  it('picks clean metric steps and caps at the largest', () => {
    // 8 m dome: radius 4000 mm, target 6400 → 500 mm gives 13 rings.
    const s = gridSpec(4000, 'metric')
    expect(s.step).toBe(500)
    expect(s.rings).toBe(13)
    expect(s.radius).toBe(6500)

    // absurd 200 m dome: even 5 m exceeds 16 rings — use it anyway.
    const huge = gridSpec(100000, 'metric')
    expect(huge.step).toBe(5000)
    expect(huge.rings).toBe(32)
    expect(huge.radius).toBe(160000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test 2>&1 | tail -8`
Expected: FAIL — cannot resolve `../scale`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/scale.ts
import type { UnitSystem } from '@/engine/types'

export interface GridSpec {
  /** Ring spacing, working units. */
  step: number
  /** Outer radius — a whole multiple of step. */
  radius: number
  rings: number
}

const STEPS: Record<UnitSystem, number[]> = {
  imperial: [12, 24, 60, 120], // 1, 2, 5, 10 ft
  metric: [500, 1000, 2000, 5000], // 0.5, 1, 2, 5 m
}

/**
 * Ring layout for the floor grid: the smallest clean real-unit step that
 * covers radius × 1.6 in at most 16 rings (largest step regardless if
 * even it exceeds 16), outer ring on a whole multiple of the step.
 */
export function gridSpec(radius: number, units: UnitSystem): GridSpec {
  const target = radius * 1.6
  const steps = STEPS[units]
  const step = steps.find((s) => Math.ceil(target / s) <= 16) ?? steps[steps.length - 1]
  const rings = Math.ceil(target / step)
  return { step, radius: rings * step, rings }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test 2>&1 | tail -5`
Expected: PASS, 116 tests (114 + 2).

- [ ] **Step 5: Commit**

```bash
bun run test > /tmp/t.out 2>&1; RC=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && git add src/lib/scale.ts src/lib/__tests__/scale.test.ts && git commit -m "feat: real-unit floor grid spec helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `buildFigure` silhouette builder

**Files:**
- Create: `src/lib/figure.ts`

**Interfaces:**
- Consumes: three.js only.
- Produces: `buildFigure(heightWorld: number): THREE.Group` — group named `scale-figure`, feet at y = 0, total height `heightWorld`, facing +z. Task 3 adds it to the ground group and billboards it.

- [ ] **Step 1: Write the module**

```ts
// src/lib/figure.ts
import * as THREE from 'three'

/**
 * Right-side body outline (x, y) in normalized units — head is a separate
 * circle so the whole figure spans exactly y ∈ [0, 1]. Left side is the
 * mirror. Gingerbread contour: arms merged to the torso, feet forward.
 */
const RIGHT: [number, number][] = [
  [0.03, 0.855], // neck
  [0.15, 0.8], // shoulder
  [0.16, 0.58], // upper arm
  [0.135, 0.42], // hand
  [0.105, 0.42], // hand inner edge — tucks straight in, no re-entrant
  [0.1, 0.3], // thigh
  [0.08, 0.04], // ankle
  [0.12, 0.01], // toe
  [0.12, 0],
  [0.03, 0], // inner foot
  [0.035, 0.25], // inner leg
  [0, 0.4], // crotch (midline — not mirrored)
]

/** Flat billboard person silhouette; scale-figure group, feet at y=0. */
export function buildFigure(heightWorld: number): THREE.Group {
  const pts = [
    ...RIGHT,
    ...RIGHT.slice(0, -1)
      .reverse()
      .map(([x, y]) => [-x, y] as [number, number]),
  ]
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const material = new THREE.MeshBasicMaterial({ color: 0x64748b, side: THREE.DoubleSide })
  const body = new THREE.Mesh(new THREE.ShapeGeometry(shape), material)
  const head = new THREE.Mesh(new THREE.CircleGeometry(0.08, 24), material)
  head.position.y = 0.92 // crown lands exactly at y = 1
  const group = new THREE.Group()
  group.name = 'scale-figure'
  group.add(body, head)
  group.scale.setScalar(heightWorld)
  return group
}
```

- [ ] **Step 2: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: build clean, 116 tests pass.

- [ ] **Step 3: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/lib/figure.ts && git commit -m "feat: scale-figure silhouette builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: State, toggle, viewer wiring

**Files:**
- Modify: `src/composables/useDomeProject.ts` (state field + persistedSlice + restorePersisted + resetProject)
- Modify: `src/components/ViewModeBar.vue` (Figure toggle)
- Modify: `src/components/DomeViewer.vue` (grid spec, figure, billboard, visibility watch)

**Interfaces:**
- Consumes: `gridSpec` (Task 1), `buildFigure` (Task 2).
- Produces: `state.showFigure: boolean` — Task 4 verifies it live.

- [ ] **Step 1: State wiring in `useDomeProject.ts`**

Four edits, each mirroring the existing `trueSize` line adjacent to it:

1. In the state interface, after `trueSize: boolean` add:
```ts
  /** Show the billboard scale figure beside the dome. */
  showFigure: boolean
```
2. In the state defaults, after `trueSize: false,` add:
```ts
  showFigure: true,
```
3. In `persistedSlice()`, after `trueSize: state.trueSize,` add:
```ts
    showFigure: state.showFigure,
```
4. In `restorePersisted`, after `state.trueSize = !!p.trueSize` add (default-true, like `closeDoorways`):
```ts
    state.showFigure = p.showFigure !== false
```
5. In `resetProject`, after `state.trueSize = false` add:
```ts
  state.showFigure = true
```

- [ ] **Step 2: ViewModeBar toggle**

In `src/components/ViewModeBar.vue`, after the `</template>` that closes the True size `<template v-if="state.viewMode !== 'surface'">` block, add a Figure toggle that is always visible:

```html
    <Separator orientation="vertical" class="h-5" />
    <Toggle
      :model-value="state.showFigure"
      size="sm"
      class="px-3 text-xs"
      title="Show a 5′9″ / 175 cm person for scale"
      @update:model-value="(v: boolean) => (state.showFigure = v)"
    >
      Figure
    </Toggle>
```

- [ ] **Step 3: DomeViewer wiring**

In `src/components/DomeViewer.vue`:

1. Add imports:
```ts
import { gridSpec } from '@/lib/scale'
import { buildFigure } from '@/lib/figure'
```
2. Add a module-scope ref beside `groundGroup`:
```ts
let figureGroup: THREE.Group | null = null
```
3. Replace the body of `rebuildGround()` with:
```ts
function rebuildGround() {
  if (!scene) return
  if (groundGroup) {
    scene.remove(groundGroup)
    disposeGroup(groundGroup)
  }
  groundGroup = new THREE.Group()
  const r = radius.value
  const spec = gridSpec(r, state.units)
  const grid = new THREE.PolarGridHelper(spec.radius, 12, spec.rings, 48, 0x2a3648, 0x1a2230)
  // The floor sits at the foundation: the base plane, dropped by the riser.
  const groundY = model.value.cutZ * r - workingRiserHeight.value - 0.001 * r
  grid.position.y = groundY
  groundGroup.add(grid)

  const h = state.units === 'imperial' ? 69 : 1750
  figureGroup = buildFigure(h)
  // +z reads as front-left from the default diagonal camera: the figure
  // stands before the dome, clear of the strut-legend overlay at the right.
  figureGroup.position.set(
    0,
    groundY,
    Math.max(model.value.unitBaseRadius, 0.9) * r * 1.1 + 0.2 * h,
  )
  figureGroup.visible = state.showFigure
  groundGroup.add(figureGroup)
  scene.add(groundGroup)
}
```
4. In the render loop (the function passed to `requestAnimationFrame` — find the existing `controls.update()` / `renderer.render(...)` body) add, before rendering:
```ts
    if (figureGroup && camera) {
      figureGroup.rotation.y = Math.atan2(
        camera.position.x - figureGroup.position.x,
        camera.position.z - figureGroup.position.z,
      )
    }
```
5. Add a visibility watch beside the existing watches:
```ts
watch(
  () => state.showFigure,
  (v) => {
    if (figureGroup) figureGroup.visible = v
  },
)
```
(`state.units` changes flow through `radius` → the existing `[model, radius, workingRiserHeight]` watch already re-runs `rebuildGround`.)

- [ ] **Step 4: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: both clean (116 tests).

- [ ] **Step 5: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/composables/useDomeProject.ts src/components/ViewModeBar.vue src/components/DomeViewer.vue && git commit -m "feat: scale figure beside the dome + real-unit grid rings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Live verification

**Files:** none (browser only; fix-forward commits if issues surface).

- [ ] **Step 1:** Reload the preview (full `window.location.reload()`).
- [ ] **Step 2:** Figure present beside the dome at believable scale (≈5′9″ against a known diameter); screenshot from two orbit angles to confirm the silhouette faces the camera both times without tilting.
- [ ] **Step 3:** Toggle Figure off in the ViewModeBar → figure disappears; reload → stays off; toggle back on.
- [ ] **Step 4:** Grid: at 26 ft diameter imperial expect 11 rings (2 ft apart, outer ring 22 ft); switch units to metric and confirm ring count changes to a clean metric layout; switch back.
- [ ] **Step 5:** Set a riser height — figure and grid drop together to the foundation plane.
- [ ] **Step 6:** Click struts/faces near the figure — selection still works, figure never intercepts picks (it's outside `domeGroup`, verify no regression).
- [ ] **Step 7:** If any visual fix was needed, commit it gated on build+tests.
