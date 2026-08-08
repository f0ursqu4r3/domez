import type { DomeModel } from './types'

/** Triangular skin panels grouped by shape, with sheet-good yield. */
export interface PanelType {
  /** P1, P2, ... shortest-perimeter first. */
  label: string
  count: number
  /** Edge lengths, descending, working units. */
  edges: [number, number, number]
  /** Longest edge (nesting base) and matching triangle height. */
  base: number
  height: number
  /** One panel's area, working units². */
  area: number
  /** Panels cut per sheet (two nest per base×height rectangle). 0 = the
   * triangle doesn't fit one sheet and must be seamed from pieces. */
  perSheet: number
  seamed: boolean
  sheets: number
}

export interface PanelPlan {
  types: PanelType[]
  sheetW: number
  sheetL: number
  sheetLabel: string
  /** 1 = single skin, 2 = inside + outside. */
  skinFactor: number
  totalPanels: number
  totalPanelArea: number
  totalSheets: number
  wasteFraction: number
}

export interface PanelPlanOptions {
  sheetW: number
  sheetL: number
  sheetLabel: string
  /** Faces not skinned: doorway cuts, windows, vents, painted openings. */
  excludeFaceIds?: Set<number>
  skinFactor: 1 | 2
}

/** Waste allowance for seamed (multi-piece) panels. */
const SEAM_WASTE = 1.3

function fitsPerSheet(base: number, height: number, sheetW: number, sheetL: number): number {
  let best = 0
  for (const [rw, rl] of [
    [base, height],
    [height, base],
  ]) {
    if (rw <= sheetW && rl <= sheetL) {
      best = Math.max(best, Math.floor(sheetW / rw) * Math.floor(sheetL / rl) * 2)
    }
    if (rw <= sheetL && rl <= sheetW) {
      best = Math.max(best, Math.floor(sheetL / rw) * Math.floor(sheetW / rl) * 2)
    }
  }
  return best
}

/**
 * Group the skinned faces into panel types (by edge-length triple) and plan
 * sheet-good usage: two mirrored triangles nest into a base × height
 * rectangle; rectangles tile the sheet. Panels too big for one sheet are
 * flagged seamed and estimated by area with a waste allowance.
 */
export function planPanels(model: DomeModel, radius: number, opts: PanelPlanOptions): PanelPlan {
  const groups = new Map<string, { edges: [number, number, number]; count: number }>()
  for (const f of model.faces) {
    if (opts.excludeFaceIds?.has(f.id)) continue
    const edges = f.edgeIds
      .map((eid) => model.edges[eid].chordFactor * radius)
      .sort((a, b) => b - a) as [number, number, number]
    const key = edges.map((e) => e.toFixed(3)).join(':')
    const g = groups.get(key) ?? { edges, count: 0 }
    g.count++
    groups.set(key, g)
  }

  const sheetArea = opts.sheetW * opts.sheetL
  const types: PanelType[] = [...groups.values()]
    .sort((a, b) => a.edges[0] + a.edges[1] + a.edges[2] - (b.edges[0] + b.edges[1] + b.edges[2]))
    .map((g, i) => {
      const [a, b, c] = g.edges
      const s = (a + b + c) / 2
      const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)))
      const height = (2 * area) / a
      const count = g.count * opts.skinFactor
      const perSheet = fitsPerSheet(a, height, opts.sheetW, opts.sheetL)
      const seamed = perSheet === 0
      const sheets = seamed
        ? Math.ceil((count * area * SEAM_WASTE) / sheetArea)
        : Math.ceil(count / perSheet)
      return {
        label: `P${i + 1}`,
        count,
        edges: g.edges,
        base: a,
        height,
        area,
        perSheet,
        seamed,
        sheets,
      }
    })

  const totalPanels = types.reduce((n, t) => n + t.count, 0)
  const totalPanelArea = types.reduce((n, t) => n + t.area * t.count, 0)
  const totalSheets = types.reduce((n, t) => n + t.sheets, 0)
  return {
    types,
    sheetW: opts.sheetW,
    sheetL: opts.sheetL,
    sheetLabel: opts.sheetLabel,
    skinFactor: opts.skinFactor,
    totalPanels,
    totalPanelArea,
    totalSheets,
    wasteFraction:
      totalSheets > 0 ? Math.max(0, 1 - totalPanelArea / (totalSheets * sheetArea)) : 0,
  }
}
