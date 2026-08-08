# Cost Estimating + Hardware BOM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hardware BOM derived from the joint method + a cost estimate through an editable price book, in a new Costs tab with CSV export.

**Architecture:** One pure engine module `src/engine/bom.ts` (`buildBom`, `defaultPrice`, `estimateCost` — exact spec interfaces); sparse `prices` overrides + `currency` in project state; a new `CostsPanel.vue` tab.

**Tech Stack:** TypeScript, Vue 3, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-08-08-costs-and-bom-design.md`

## Global Constraints

- Tests `bunx vitest run src/engine/__tests__/engine.test.ts`; build `bun run build`.
- BOM/price interfaces, keys, quantity formulas, and ballpark defaults exactly as the spec's tables (keys: `stock:<label>`, `sheet`, `hub-connector`, `hub-plate`, `bolt`, `nut`, `washer`, `screw-structural`, `screw-framing`, `screw-panel`, `anchor`, `glue-seam`).
- Unpriced (price 0) lines: excluded from total, counted in `unpricedCount`; `glue-seam` informational (never unpriced-counted).
- Zero-quantity BOM lines omitted.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `bom.ts` engine module

**Files:**
- Create: `src/engine/bom.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:** the spec's `BomLine`, `buildBom(model, doorway, riser, jointId, panelPlan)`, `CostLine`, `CostEstimate`, `defaultPrice(key, label, units)`, `estimateCost(inputs)` verbatim.

- [ ] **Step 1: Failing tests**

```ts
describe('hardware BOM', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const noDoors = emptyDoorwayCut()
  const plan = planPanels(model, 150, { sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet', skinFactor: 1 })
  const V = model.vertices.length
  const E = model.edges.length
  const baseHubs = model.vertices.filter((v) => v.isBase).length

  it('hub method: connectors by valence, bolt per strut end', () => {
    const bom = buildBom(model, noDoors, null, 'hub', plan)
    const connectors = bom.filter((l) => l.key === 'hub-connector')
    expect(connectors.reduce((n, l) => n + l.quantity, 0)).toBe(V)
    expect(bom.find((l) => l.key === 'bolt')!.quantity).toBe(2 * E)
    expect(bom.find((l) => l.key === 'washer')!.quantity).toBe(4 * E)
    expect(bom.find((l) => l.key === 'anchor')!.quantity).toBe(baseHubs)
    expect(bom.find((l) => l.key === 'screw-panel')!.quantity).toBeGreaterThan(0)
  })

  it('pipe: one stack bolt per vertex; plate/mitered: 2 screws per end', () => {
    const pipe = buildBom(model, noDoors, null, 'flattened-pipe', plan)
    expect(pipe.find((l) => l.key === 'bolt')!.quantity).toBe(V)
    const plate = buildBom(model, noDoors, null, 'timber-plate', plan)
    expect(plate.filter((l) => l.key === 'hub-plate').reduce((n, l) => n + l.quantity, 0)).toBe(V)
    expect(plate.find((l) => l.key === 'screw-structural')!.quantity).toBe(2 * 2 * E)
    const mitered = buildBom(model, noDoors, null, 'mitered', plan)
    expect(mitered.find((l) => l.key === 'screw-structural')!.quantity).toBe(2 * 2 * E)
    expect(mitered.find((l) => l.key === 'glue-seam')!.quantity).toBe(
      model.vertices.reduce((n, v) => n + v.edgeIds.length, 0),
    )
  })

  it('doorway and riser adjust counts', () => {
    const doors = cutDoorways(model, [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }], 150, {
      minStubLength: 6, studSpacing: 16,
    })
    const riser = buildRiser(model, 150, {
      height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6,
      doors: [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }],
    })!
    const bom = buildBom(model, doors, riser, 'hub', plan)
    const connectors = bom.filter((l) => l.key === 'hub-connector')
    expect(connectors.reduce((n, l) => n + l.quantity, 0)).toBe(V - doors.removedVertices.size)
    const framingJoints = doors.doors.reduce((n, d) => n + d.closureJointCount, 0) + riser.jointCount
    expect(bom.find((l) => l.key === 'screw-framing')!.quantity).toBe(3 * framingJoints)
    expect(bom.find((l) => l.key === 'anchor')!.quantity).toBe(riser.segments.length)
  })
})

describe('cost estimate', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const plan = planPanels(model, 150, { sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet', skinFactor: 1 })
  const bom = buildBom(model, emptyDoorwayCut(), null, 'timber-plate', plan)
  const base = {
    boardCounts: [{ stockLabel: '12 ft', count: 30 }],
    totalSheets: plan.totalSheets,
    sheetLabel: plan.sheetLabel,
    bom,
    floorArea: Math.PI * (model.unitBaseRadius * 150) ** 2,
    units: 'imperial' as const,
  }

  it('prices with defaults, overrides win, unknown labels go unpriced', () => {
    const est = estimateCost({ ...base, prices: {} })
    const boards = est.lines.find((l) => l.key === 'stock:12 ft')!
    expect(boards.priceEach).toBe(defaultPrice('stock:12 ft', '12 ft', 'imperial'))
    expect(boards.total).toBeCloseTo(boards.priceEach * 30, 9)
    expect(est.total).toBeGreaterThan(0)
    expect(est.perArea).toBeCloseTo(est.total / (base.floorArea / 144), 9)

    const withOverride = estimateCost({ ...base, prices: { 'stock:12 ft': 9.99 } })
    expect(withOverride.lines.find((l) => l.key === 'stock:12 ft')!.priceEach).toBe(9.99)

    const weird = estimateCost({
      ...base,
      prices: {},
      boardCounts: [{ stockLabel: '3.14 m', count: 5 }],
    })
    const line = weird.lines.find((l) => l.key === 'stock:3.14 m')!
    expect(line.unpriced).toBe(true)
    expect(weird.unpricedCount).toBeGreaterThan(0)
    expect(weird.total).toBe(
      weird.lines.filter((l) => !l.unpriced).reduce((n, l) => n + l.total, 0),
    )
  })

  it('glue seams are informational, not unpriced', () => {
    const mBom = buildBom(model, emptyDoorwayCut(), null, 'mitered', plan)
    const est = estimateCost({ ...base, bom: mBom, prices: {} })
    const glue = est.lines.find((l) => l.key === 'glue-seam')!
    expect(glue.total).toBe(0)
    expect(glue.unpriced).toBe(false)
  })
})
```

(imports to add at the top of the test file: `emptyDoorwayCut` from `../doorway` — already imported? add if not — and `buildBom, estimateCost, defaultPrice` from `../bom`.)

- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement `src/engine/bom.ts`.**

```ts
import type { DoorwayCut } from './doorway'
import type { JointMethodId } from './cutlist'
import type { PanelPlan } from './panels'
import type { RiserModel } from './riser'
import type { DomeModel, UnitSystem } from './types'

// BomLine / CostLine / CostEstimate interfaces per spec.

export function buildBom(
  model: DomeModel,
  doorway: DoorwayCut,
  riser: RiserModel | null,
  jointId: JointMethodId,
  panelPlan: PanelPlan,
): BomLine[] {
  const lines: BomLine[] = []
  const keptVerts = model.vertices.filter((v) => !doorway.removedVertices.has(v.id))
  const cutEdges = new Set([...doorway.removedEdges, ...doorway.trimmedEdges])
  const fullStruts = model.edges.filter((e) => !cutEdges.has(e.id)).length
  const strutEnds = 2 * fullStruts + doorway.trimmed.length

  const byValence = new Map<number, number>()
  for (const v of keptVerts) byValence.set(v.edgeIds.length, (byValence.get(v.edgeIds.length) ?? 0) + 1)
  const valenceLines = (key: string, what: string) =>
    [...byValence.entries()].sort((a, b) => a[0] - b[0]).forEach(([val, count]) =>
      lines.push({ key, label: `${val}-way ${what}`, quantity: count }),
    )

  if (jointId === 'hub') {
    valenceLines('hub-connector', 'hub connector')
    lines.push(
      { key: 'bolt', label: 'Bolts', quantity: strutEnds, note: '1 per strut end' },
      { key: 'nut', label: 'Nuts', quantity: strutEnds },
      { key: 'washer', label: 'Washers', quantity: 2 * strutEnds },
    )
  } else if (jointId === 'flattened-pipe') {
    const n = keptVerts.length
    lines.push(
      { key: 'bolt', label: 'Stack bolts', quantity: n, note: '1 per hub, through all tabs' },
      { key: 'nut', label: 'Nuts', quantity: n },
      { key: 'washer', label: 'Washers', quantity: 2 * n },
    )
  } else if (jointId === 'timber-plate') {
    valenceLines('hub-plate', 'hub plate')
    lines.push({
      key: 'screw-structural', label: 'Structural screws', quantity: 2 * strutEnds,
      note: '2 per strut end (assumption)',
    })
  } else {
    lines.push({
      key: 'screw-structural', label: 'Structural screws', quantity: 2 * strutEnds,
      note: '2 per strut end (assumption)',
    })
    lines.push({
      key: 'glue-seam', label: 'Glued seams', quantity: keptVerts.reduce((n, v) => n + v.edgeIds.length, 0),
      note: 'glued seams — no unit price',
    })
  }

  const framingJoints =
    doorway.doors.reduce((n, d) => n + d.closureJointCount, 0) + (riser?.jointCount ?? 0)
  if (framingJoints > 0) {
    lines.push({ key: 'screw-framing', label: 'Framing screws', quantity: 3 * framingJoints, note: '3 per framing joint' })
  }

  const anchors = riser ? riser.segments.length : keptVerts.filter((v) => v.isBase).length
  if (anchors > 0) {
    lines.push({
      key: 'anchor', label: 'Base anchors', quantity: anchors,
      note: riser ? 'riser bottom plate to foundation, 1 per segment' : 'base hub to foundation',
    })
  }

  let perimeter = 0
  for (const t of panelPlan.types) perimeter += t.count * (t.edges[0] + t.edges[1] + t.edges[2])
  for (const r of panelPlan.rects) perimeter += r.count * 2 * (r.w + r.h)
  for (const z of panelPlan.rhombs)
    perimeter += z.count * 4 * Math.hypot(z.d1 / 2, z.d2 / 2)
  if (perimeter > 0) {
    // Spacing in the panel plan's working units: 8 in when the sheet is
    // inch-sized, 200 mm otherwise (sheetW 48 vs 1220).
    const spacing = panelPlan.sheetW < 100 ? 8 : 200
    lines.push({
      key: 'screw-panel', label: 'Panel screws', quantity: Math.ceil(perimeter / spacing),
      note: `${panelPlan.sheetW < 100 ? '8″' : '200 mm'} spacing — estimate`,
    })
  }
  return lines.filter((l) => l.quantity > 0)
}
```

`defaultPrice` + `estimateCost` per spec: a `DEFAULTS: Record<string, number>` for the fixed keys; stock via a label table `{ '8 ft': 4.25, '10 ft': 5.75, '12 ft': 7.25, '16 ft': 10.5, '20 ft': 15, '24 ft': 38, '2.4 m': 4.25, '3.0 m': 5.75, '3.6 m': 7.25, '4.8 m': 10.5, '6.0 m': 15 }` (metric mapped to nearest imperial default; note EMT/PVC/steel share the length-label economics — accepted ballpark), `sheet` 45; unknown → 0. `estimateCost` builds lines in order: stock lines, sheet line (label `${totalSheets}× ${sheetLabel}` — key `sheet`), BOM lines; `unpriced = priceEach <= 0 && key !== 'glue-seam' && quantity > 0`; totals + `perArea = total / (floorArea / (units === 'imperial' ? 144 : 1e6))`.

- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: hardware BOM + cost estimating engine`

---

### Task 2: State, exporter, Costs CSV

**Files:**
- Modify: `src/composables/useDomeProject.ts`, `src/engine/exports/csv.ts`, `src/engine/exports/json.ts`

**Interfaces:**
- State: `prices: Record<string, number>` (default `{}`), `currency: string` (default `'$'`).
- Composable exposes `bom`, `costEstimate`, `setPrice(key, value)`, `resetPrices()`.
- `costsCsv(est: CostEstimate, currency: string): string` in csv.ts.
- `ProjectSettings` gains `prices?: Record<string, number>; currency?: string`.

- [ ] **Step 1: Implement.**

State + init: `prices: {}`, `currency: '$'` (doc comments per spec). Computeds after `panelPlan`:

```ts
const bom = computed(() =>
  buildBom(model.value, doorway.value, riser.value, state.jointId, panelPlan.value),
)
const costEstimate = computed(() =>
  estimateCost({
    boardCounts: packing.value.boardCounts,
    totalSheets: panelPlan.value.totalSheets,
    sheetLabel: panelSheet.value.label,
    bom: bom.value,
    prices: state.prices,
    floorArea: summary.value.floorArea,
    units: state.units,
  }),
)
function setPrice(key: string, value: number) {
  if (Number.isFinite(value) && value > 0) state.prices[key] = value
  else delete state.prices[key]
}
function resetPrices() {
  state.prices = {}
}
```

(`summary` is declared after `panelPlan` today — declare `costEstimate` after `summary` to avoid TDZ, or use `Math.PI * (model.value.unitBaseRadius * radius.value) ** 2` directly; prefer placing after `summary`.)

Persistence: `persistedSlice` gains `prices: { ...state.prices }, currency: state.currency`; `restorePersisted` validates (`prices` object → keep finite ≥ 0 number entries; `currency` string ≤ 3 chars); `resetProject` sets `{}` / `'$'`; `projectSettings` + `loadProjectFile` mirror it; `json.ts` `ProjectSettings` gains the two optional fields with doc comments. Exporter:

```ts
costsCsv: () =>
  download(`${fileStem.value}-costs.csv`, costsCsv(costEstimate.value, state.currency), 'text/csv'),
```

`csv.ts`:

```ts
export function costsCsv(est: CostEstimate, currency: string): string {
  const lines = [row('Item', 'Qty', `Unit price (${currency})`, `Line total (${currency})`, 'Note')]
  for (const l of est.lines) {
    lines.push(row(l.label, l.quantity, l.unpriced ? 'unpriced' : l.priceEach.toFixed(2),
      l.unpriced ? '' : l.total.toFixed(2), l.note ?? ''))
  }
  lines.push('')
  lines.push(row(`Total (${currency})`, est.total.toFixed(2)))
  lines.push(row('Unpriced lines', est.unpricedCount))
  return lines.join('\n')
}
```

Return `bom`, `costEstimate`, `setPrice`, `resetPrices` from `useDomeProject`.

- [ ] **Step 2: Test (append):**

```ts
describe('costs csv', () => {
  it('emits lines and totals with the currency symbol', () => {
    const model = generateDome({ frequency: 2, fraction: '1/2' })
    const plan = planPanels(model, 150, { sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet', skinFactor: 1 })
    const bom = buildBom(model, emptyDoorwayCut(), null, 'hub', plan)
    const est = estimateCost({
      boardCounts: [{ stockLabel: '8 ft', count: 10 }], totalSheets: plan.totalSheets,
      sheetLabel: plan.sheetLabel, bom, prices: {}, floorArea: 1e5, units: 'imperial',
    })
    const csv = costsCsv(est, '$')
    expect(csv).toContain('Unit price ($)')
    expect(csv).toContain('Total ($)')
    expect(csv.split('\n').length).toBeGreaterThan(est.lines.length)
  })
})
```

- [ ] **Step 3: Suite + build** — PASS/clean.
- [ ] **Step 4: Commit** — `feat: cost state, persistence, and costs CSV export`

---

### Task 3: Costs tab UI + live verification

**Files:**
- Create: `src/components/panels/CostsPanel.vue`
- Modify: `src/App.vue`, `src/components/panels/ExportPanel.vue`

- [ ] **Step 1: CostsPanel.vue**

```vue
<script setup lang="ts">
import { useDomeProject } from '@/composables/useDomeProject'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { FileSpreadsheet, RotateCcw } from '@lucide/vue'

const project = useDomeProject()
const { state, bom, costEstimate } = project

const money = (v: number) =>
  `${state.currency}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <section>
      <h3 class="section-title">Cost estimate</h3>
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-md border border-border bg-card px-3 py-2">
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Total</div>
          <div class="font-mono text-lg">~{{ money(costEstimate.total) }}</div>
        </div>
        <div class="rounded-md border border-border bg-card px-3 py-2">
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground">
            Per {{ state.units === 'imperial' ? 'ft²' : 'm²' }} floor
          </div>
          <div class="font-mono text-lg">{{ money(costEstimate.perArea) }}</div>
        </div>
        <div
          class="rounded-md border px-3 py-2"
          :class="costEstimate.unpricedCount > 0 ? 'border-destructive/60 bg-destructive/5' : 'border-border bg-card'"
        >
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Unpriced</div>
          <div class="font-mono text-lg">{{ costEstimate.unpricedCount }}</div>
        </div>
      </div>
      <p class="mt-2 text-xs text-muted-foreground leading-relaxed">
        Shipped prices are rough US estimates — edit any line with your local numbers. Unpriced
        lines are excluded from the total.
      </p>
    </section>

    <Separator />

    <section>
      <div class="flex items-center justify-between">
        <h3 class="section-title mb-0">Price book</h3>
        <div class="flex items-center gap-2">
          <Input
            class="h-7 w-12 font-mono text-center"
            maxlength="3"
            :model-value="state.currency"
            @update:model-value="(v) => (state.currency = String(v).slice(0, 3) || '$')"
          />
          <Button size="sm" variant="ghost" class="text-xs" @click="project.resetPrices()">
            <RotateCcw data-icon="inline-start" /> Reset
          </Button>
        </div>
      </div>
      <div class="mt-2 flex flex-col gap-1">
        <div
          v-for="l in costEstimate.lines"
          :key="l.key + l.label"
          class="grid grid-cols-[1fr_auto_5rem_5.5rem] items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
        >
          <span class="truncate">
            {{ l.label }}
            <span v-if="l.note" class="text-muted-foreground"> · {{ l.note }}</span>
          </span>
          <span class="font-mono text-muted-foreground">×{{ l.quantity }}</span>
          <Input
            v-if="l.key !== 'glue-seam'"
            type="number" min="0" step="0.01" class="h-7 font-mono text-right"
            :model-value="l.priceEach || ''"
            @update:model-value="(v) => project.setPrice(l.key === 'sheet' || l.key.startsWith('stock:') ? l.key : l.key, Number(v))"
          />
          <span v-else />
          <span class="text-right font-mono">
            <Badge v-if="l.unpriced" variant="destructive" class="text-[10px]">unpriced</Badge>
            <template v-else-if="l.key !== 'glue-seam'">{{ money(l.total) }}</template>
          </span>
        </div>
      </div>
    </section>

    <Button variant="outline" class="w-full" @click="project.exporters.costsCsv()">
      <FileSpreadsheet data-icon="inline-start" />
      Costs CSV
    </Button>
  </div>
</template>
```

**Deliberate simplification vs the spec:** the spec listed a read-only BOM
table AND a price book; merged into ONE table here — every BOM line appears
with quantity, note, price input, and line total, so a separate read-only
table would be pure duplication. Note it in the commit message.

**Snippet fix:** the price-input handler simplifies to
`project.setPrice(l.key, Number(v))` — stock lines already carry their
`stock:<label>` keys from `estimateCost`.

- [ ] **Step 2: App.vue tab.** Import `CostsPanel`; add `<TabsTrigger value="costs" class="text-xs">Costs</TabsTrigger>` after Materials and a matching `<TabsContent value="costs" class="min-h-0 flex-1"><ScrollArea class="h-full"><CostsPanel /></ScrollArea></TabsContent>`.

- [ ] **Step 3: Verify.** Suite + build. Browser: Costs tab shows totals and lines for the default 5V (timber-plate: plates by valence, structural/framing/panel screws, anchors); edit a price → total moves and persists across refresh; switch to metric → mapped stock labels stay priced, truly unknown labels badge as unpriced; mitered → glue seams line informational; CSV button downloads. Screenshot.
- [ ] **Step 4: Commit** — `feat: Costs tab — hardware BOM price book, totals, CSV`
