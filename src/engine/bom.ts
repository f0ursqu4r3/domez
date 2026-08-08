import type { DoorwayCut } from './doorway'
import type { JointMethodId } from './cutlist'
import type { PanelPlan } from './panels'
import type { RiserModel } from './riser'
import type { DomeModel, UnitSystem } from './types'

/** One hardware line item, quantity derived from the model + joint method. */
export interface BomLine {
  /** Stable price-book key, e.g. 'hub-connector', 'bolt', 'screw-framing'. */
  key: string
  label: string
  quantity: number
  note?: string
}

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

/**
 * Hardware bill of materials for the current build: joint hardware by
 * method, framing screws for closures and the riser, base anchors, and an
 * estimated panel-screw count. Quantities exclude doorway-removed geometry.
 */
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
  // Trimmed pieces keep their hub end only.
  const strutEnds = 2 * fullStruts + doorway.trimmed.length

  const byValence = new Map<number, number>()
  for (const v of keptVerts) {
    byValence.set(v.edgeIds.length, (byValence.get(v.edgeIds.length) ?? 0) + 1)
  }
  const valenceLines = (key: string, what: string) => {
    for (const [val, count] of [...byValence.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push({ key, label: `${val}-way ${what}`, quantity: count })
    }
  }

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
      key: 'screw-structural',
      label: 'Structural screws',
      quantity: 2 * strutEnds,
      note: '2 per strut end (assumption)',
    })
  } else {
    lines.push({
      key: 'screw-structural',
      label: 'Structural screws',
      quantity: 2 * strutEnds,
      note: '2 per strut end (assumption)',
    })
    lines.push({
      key: 'glue-seam',
      label: 'Glued seams',
      quantity: keptVerts.reduce((n, v) => n + v.edgeIds.length, 0),
      note: 'glued seams — no unit price',
    })
  }

  const framingJoints =
    doorway.doors.reduce((n, d) => n + d.closureJointCount, 0) + (riser?.jointCount ?? 0)
  if (framingJoints > 0) {
    lines.push({
      key: 'screw-framing',
      label: 'Framing screws',
      quantity: 3 * framingJoints,
      note: '3 per framing joint',
    })
  }

  const anchors = riser ? riser.segments.length : keptVerts.filter((v) => v.isBase).length
  if (anchors > 0) {
    lines.push({
      key: 'anchor',
      label: 'Base anchors',
      quantity: anchors,
      note: riser ? 'riser bottom plate to foundation, 1 per segment' : 'base hub to foundation',
    })
  }

  // Panel screws along skinned panel perimeters (spacing estimate).
  let perimeter = 0
  for (const t of panelPlan.types) perimeter += t.count * (t.edges[0] + t.edges[1] + t.edges[2])
  for (const r of panelPlan.rects) perimeter += r.count * 2 * (r.w + r.h)
  for (const z of panelPlan.rhombs) perimeter += z.count * 4 * Math.hypot(z.d1 / 2, z.d2 / 2)
  if (perimeter > 0) {
    const inches = panelPlan.sheetW < 100 // sheet sized in inches vs mm
    const spacing = inches ? 8 : 200
    lines.push({
      key: 'screw-panel',
      label: 'Panel screws',
      quantity: Math.ceil(perimeter / spacing),
      note: `${inches ? '8″' : '200 mm'} spacing — estimate`,
    })
  }

  return lines.filter((l) => l.quantity > 0)
}

/** Ballpark US prices — rough 2025 big-box estimates, meant to be edited. */
const FIXED_DEFAULTS: Record<string, number> = {
  sheet: 45,
  'hub-connector': 12,
  'hub-plate': 6,
  bolt: 0.6,
  nut: 0.25,
  washer: 0.1,
  'screw-structural': 0.18,
  'screw-framing': 0.08,
  'screw-panel': 0.07,
  anchor: 3.5,
}
const STOCK_DEFAULTS: Record<string, number> = {
  '8 ft': 4.25,
  '10 ft': 5.75,
  '12 ft': 7.25,
  '16 ft': 10.5,
  '20 ft': 15,
  '24 ft': 38,
  '2.4 m': 4.25,
  '3.0 m': 5.75,
  '3.6 m': 7.25,
  '4.8 m': 10.5,
  '6.0 m': 15,
}

/** Default unit price for a price-book key; 0 = unpriced. */
export function defaultPrice(key: string, label: string, _units: UnitSystem): number {
  // Stock keys carry the stock label — prefer it over the display label,
  // which may be decorated ("12 ft boards").
  if (key.startsWith('stock:')) return STOCK_DEFAULTS[key.slice(6)] ?? STOCK_DEFAULTS[label] ?? 0
  return FIXED_DEFAULTS[key] ?? 0
}

export interface CostInputs {
  boardCounts: { stockLabel: string; count: number }[]
  totalSheets: number
  sheetLabel: string
  bom: BomLine[]
  /** Sparse user overrides by price-book key. */
  prices: Record<string, number>
  /** Working units². */
  floorArea: number
  units: UnitSystem
}

/** Price the build: boards + sheets + hardware through the price book. */
export function estimateCost(inputs: CostInputs): CostEstimate {
  const lines: CostLine[] = []
  const priceFor = (key: string, label: string) => {
    const override = inputs.prices[key]
    return Number.isFinite(override) && override! > 0
      ? override!
      : defaultPrice(key, label, inputs.units)
  }
  const push = (key: string, label: string, quantity: number, note?: string) => {
    const priceEach = key === 'glue-seam' ? 0 : priceFor(key, label)
    const unpriced = key !== 'glue-seam' && priceEach <= 0 && quantity > 0
    lines.push({
      key,
      label,
      quantity,
      priceEach,
      total: unpriced ? 0 : priceEach * quantity,
      unpriced,
      note,
    })
  }

  for (const b of inputs.boardCounts) {
    push(`stock:${b.stockLabel}`, `${b.stockLabel} boards`, b.count)
  }
  if (inputs.totalSheets > 0) {
    push('sheet', `${inputs.sheetLabel}s`, inputs.totalSheets)
  }
  for (const l of inputs.bom) {
    // BOM valence lines share a key; label disambiguates. Price by key.
    const priceEach = l.key === 'glue-seam' ? 0 : priceFor(l.key, l.label)
    const unpriced = l.key !== 'glue-seam' && priceEach <= 0 && l.quantity > 0
    lines.push({
      key: l.key,
      label: l.label,
      quantity: l.quantity,
      priceEach,
      total: unpriced ? 0 : priceEach * l.quantity,
      unpriced,
      note: l.note,
    })
  }

  const total = lines.filter((l) => !l.unpriced).reduce((n, l) => n + l.total, 0)
  const areaDiv = inputs.units === 'imperial' ? 144 : 1e6
  return {
    lines,
    total,
    unpricedCount: lines.filter((l) => l.unpriced).length,
    perArea: inputs.floorArea > 0 ? total / (inputs.floorArea / areaDiv) : 0,
  }
}
