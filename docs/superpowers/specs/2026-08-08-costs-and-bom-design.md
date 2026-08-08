# Cost Estimating + Hardware BOM — Design Spec

**Date:** 2026-08-08
**Status:** Approved for planning

## Summary

A hardware bill of materials derived from the joint method and existing
takeoffs, and a cost estimate that prices boards, sheets, and hardware
through an editable price book with shipped ballpark defaults. Lives in a
new **Costs** tab with a CSV export.

## Decisions (from brainstorming)

1. Editable price book with shipped ballpark US defaults, clearly labeled
   estimates; zero/unknown price = "unpriced" line, excluded from the total
   and surfaced as a count so the total never silently lies.
2. New **Costs** tab (7th panel tab) — BOM table, price book, totals,
   Costs CSV. Materials tab unchanged.

## BOM engine: `src/engine/bom.ts`

```ts
export interface BomLine {
  /** Stable price-book key, e.g. 'hub-connector', 'bolt', 'screw-framing'. */
  key: string
  label: string
  quantity: number
  note?: string
}
export function buildBom(
  model: DomeModel,
  doorway: DoorwayCut,
  riser: RiserModel | null,
  jointId: JointMethodId,
  panelPlan: PanelPlan,
): BomLine[]
```

Quantities (kept = not doorway-removed):

- **Joint hardware by method:**
  - `hub`: per kept vertex one connector, grouped by valence — line per
    valence (`'hub-connector'` key, label "6-way hub connector"); bolts =
    2 × kept-full-strut count + 1 × trimmed piece count; nuts = bolts;
    washers = 2 × bolts.
  - `flattened-pipe`: bolts = kept vertex count (one stack bolt each);
    nuts = bolts; washers = 2 × bolts.
  - `timber-plate`: plates per kept vertex grouped by valence
    (`'hub-plate'`); screws (`'screw-structural'`) = 2 per strut end
    (2 × kept-full + 1 × trimmed), note "2 per strut end (assumption)".
  - `mitered`: `'screw-structural'` = 2 per strut end (same formula), plus
    an informational line `'glue-seam'` with quantity = Σ kept vertex
    valence (seam count), note "glued seams — no unit price".
- **Framing screws** (`'screw-framing'`): 3 × (Σ door closureJointCount +
  riser jointCount). Zero line omitted.
- **Base anchors** (`'anchor'`): riser segments when riser present, else
  base-ring hub count (kept `isBase` vertices). Note says what they anchor.
- **Panel screws** (`'screw-panel'`): perimeter of every skinned panel
  (triangle types: Σ count × (e1+e2+e3); rects: count × 2(w+h); rhombs:
  count × 4 × side where side = √((d1/2)² + (d2/2)²)) ÷ spacing
  (8 in / 200 mm), rounded up, note "8″/200 mm spacing — estimate". Omitted
  when the panel plan is empty.

Zero-quantity lines are omitted. Glue-seam lines are never priced.

## Pricing: same module

```ts
export interface CostLine {
  key: string
  label: string
  quantity: number
  /** Unit price actually used (override ?? default). */
  priceEach: number
  /** quantity × priceEach; 0 when unpriced. */
  total: number
  unpriced: boolean
  note?: string
}
export interface CostEstimate {
  lines: CostLine[]
  total: number
  unpricedCount: number
  /** total / floor area, per ft² (imperial) or m² (metric). */
  perArea: number
}
export function defaultPrice(key: string, label: string, units: UnitSystem): number
export function estimateCost(inputs: {
  boardCounts: { stockLabel: string; count: number }[]
  totalSheets: number
  sheetLabel: string
  bom: BomLine[]
  prices: Record<string, number>
  floorArea: number // working units²
  units: UnitSystem
}): CostEstimate
```

- Price-book keys: `stock:<label>` per stock line, `sheet`, plus the BOM
  keys. Override map wins; otherwise `defaultPrice`.
- Ballpark defaults (imperial labels): 2×4 stock '8 ft' 4.25, '10 ft' 5.75,
  '12 ft' 7.25, '16 ft' 10.5; 2×2 60 % of those; EMT '10 ft' 12; PVC
  '10 ft' 8, '20 ft' 15; steel tube '20 ft' 32, '24 ft' 38; `sheet` 45;
  `hub-connector` 12; `hub-plate` 6; `bolt` 0.6; `nut` 0.25; `washer` 0.1;
  `screw-structural` 0.18; `screw-framing` 0.08; `screw-panel` 0.07;
  `anchor` 3.5. Metric stock labels ('2.4 m' …) map to the nearest imperial
  default; genuinely unknown labels → 0 (unpriced).
- `glue-seam` lines carry `unpriced: false, priceEach: 0, total: 0` and are
  excluded from `unpricedCount` (informational).

## State & wiring

- `state.prices: Record<string, number>` (sparse overrides, default `{}`),
  `state.currency: string` (default `'$'`, max 3 chars). Persisted slice,
  `restorePersisted` (validate: finite ≥ 0 numbers / short string), project
  JSON (`settings.prices`, `settings.currency`), `loadProjectFile`,
  `resetProject` clears both.
- Computeds: `bom` (buildBom of current model/doorway/riser/jointId/
  panelPlan), `costEstimate` (estimateCost with packing.boardCounts,
  panelPlan.totalSheets + sheetLabel, bom, state.prices,
  summary.floorArea).
- `setPrice(key, value)` writes/deletes an override; `resetPrices()` clears
  the map.
- Exporter `costsCsv`: Item, Qty, Unit price, Line total, Note rows +
  Total / unpriced footer (currency symbol applied).

## UI: `src/components/panels/CostsPanel.vue` (new tab "Costs")

- Summary cards: Total (`{currency}{total}` with `~` prefix and an
  "estimates" caption), Cost per ft²/m², Unpriced lines count (destructive
  tint when > 0).
- Hardware BOM table: label, quantity, note (read-only).
- Price book list: one row per cost line — label, qty ×, price `Input`
  (writes `setPrice`; shows the default when no override), line total, an
  "unpriced" badge for zero-priced lines.
- Currency symbol input (3-char), "Reset prices" ghost button, "Costs CSV"
  export button.
- Footnote: "Shipped prices are rough US estimates — edit with your local
  numbers."
- `App.vue` tab bar gains `<TabsTrigger value="costs">Costs</TabsTrigger>` +
  content pane.

## Testing

- BOM: hand-checked quantities on 3V 1/2 leveled for each joint method
  (hub valence grouping totals = kept vertices; pipe bolts = kept
  vertices; plate screws = 2 × ends; mitered seams = Σ valence); doorway
  reduces vertex/end counts; riser adds framing screws + anchors =
  segments; panel screws > 0 and scale with skinFactor.
- Cost: override beats default; unknown stock label → unpriced, excluded
  from total, counted; glue-seam not counted unpriced; perArea =
  total / (floorArea/144) imperial.
- CSV: header + line rows + total row; currency symbol present.
- Zome + mitered spot check (single strut type, seams > 0).

## Out of scope

- Optimizer cost curves, taxes/shipping, regional price feeds, per-store
  price lookup, panel fastener engineering beyond the spacing estimate.
