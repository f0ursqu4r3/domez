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

/** Rectangular sheathing pieces (riser wall segments) in the sheet plan. */
export interface RectPanelType {
  /** R1, R2, ... smallest-area first. */
  label: string
  count: number
  w: number
  h: number
  /** One piece, w × h. */
  area: number
  /** 0 = seamed. */
  perSheet: number
  seamed: boolean
  sheets: number
}

/** Rhombic zome panels in the sheet plan (two nest per d1×d2 bounding rect). */
export interface RhombPanelType {
  /** Z1, Z2, ... smallest-area first. */
  label: string
  count: number
  /** Long (vertical) diagonal. */
  d1: number
  /** Short (horizontal) diagonal. */
  d2: number
  /** One rhombus, d1 × d2 / 2. */
  area: number
  /** 0 = seamed. */
  perSheet: number
  seamed: boolean
  sheets: number
}

/** Polygonal panels (goldberg hex/pent/partials) grouped by shape. */
export interface PolyPanelType {
  /** G1, G2, ... smallest-area first. */
  label: string
  count: number
  sides: number
  /** Representative edge lengths in ring order. */
  edges: number[]
  /** Representative outline, translated so the bbox min is the origin. */
  outline: [number, number][]
  area: number
  boundingW: number
  boundingH: number
  /** 0 = seamed. */
  perSheet: number
  seamed: boolean
  sheets: number
}

/** A one-off, site-fit skin panel produced by clipping a panel unit against
 * an opening prism (see `panelClip.ts`). Unlike the grouped panel types
 * above, every clipped piece is unique — no signature grouping, so there's
 * no `count`/`perSheet`/`sheets`; it's packed individually by its bounding
 * rect (see `planPanels`). */
export interface ClippedPanelType {
  /** X1, X2, ... in unit order; one entry per outer (non-hole) loop, so a
   * unit that clips into disjoint islands yields several. */
  label: string
  /** Outer loop, 2D working units, translated so the bbox min is the
   * origin (same convention as `PolyPanelType.outline`). */
  outline: [number, number][]
  /** Opening-carved void loops fully inside this piece, same basis/offset
   * as `outline`. */
  holes: [number, number][][]
  /** Surviving area, working units² (net of holes). */
  trueArea: number
  /** Axis-aligned bounding box of `outline`, working units. */
  bboxW: number
  bboxH: number
  /** Bbox exceeds one sheet in both orientations. */
  seamed: boolean
}

export interface PanelPlan {
  types: PanelType[]
  rects: RectPanelType[]
  rhombs: RhombPanelType[]
  polys: PolyPanelType[]
  clipped: ClippedPanelType[]
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
  /** Rectangular pieces to nest alongside the triangles (riser sheathing). */
  rects?: { w: number; h: number }[]
  /** Rhombic pieces by diagonals (zome skin panels). */
  rhombs?: { d1: number; d2: number }[]
  /** Polygonal pieces as 2D outlines, working units (goldberg panels). */
  polyOutlines?: [number, number][][]
  /** Opening-clipped, one-off skin pieces (see `ClippedPanelType`). `seamed`
   * is recomputed from `bboxW`/`bboxH` against this plan's sheet, so any
   * value passed in here is ignored. */
  clipped?: ClippedPanelType[]
}

/** Waste allowance for seamed (multi-piece) panels. */
export const SEAM_WASTE = 1.3

export function rectsPerSheet(w: number, h: number, sheetW: number, sheetL: number): number {
  let best = 0
  if (w <= sheetW && h <= sheetL) best = Math.max(best, Math.floor(sheetW / w) * Math.floor(sheetL / h))
  if (w <= sheetL && h <= sheetW) best = Math.max(best, Math.floor(sheetL / w) * Math.floor(sheetW / h))
  return best
}

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

  // Rectangular pieces (riser wall sheathing) nest as plain grids.
  const rectGroups = new Map<string, { w: number; h: number; count: number }>()
  for (const r of opts.rects ?? []) {
    const key = `${r.w.toFixed(3)}:${r.h.toFixed(3)}`
    const g = rectGroups.get(key) ?? { w: r.w, h: r.h, count: 0 }
    g.count++
    rectGroups.set(key, g)
  }
  const rects: RectPanelType[] = [...rectGroups.values()]
    .sort((a, b) => a.w * a.h - b.w * b.h)
    .map((g, i) => {
      const count = g.count * opts.skinFactor
      const area = g.w * g.h
      const perSheet = rectsPerSheet(g.w, g.h, opts.sheetW, opts.sheetL)
      const seamed = perSheet === 0
      const sheets = seamed
        ? Math.ceil((count * area * SEAM_WASTE) / sheetArea)
        : Math.ceil(count / perSheet)
      return { label: `R${i + 1}`, count, w: g.w, h: g.h, area, perSheet, seamed, sheets }
    })

  // Rhombic pieces (zome skins): two mirrored rhombi nest into their d1×d2
  // bounding rectangle, the same trick as the triangles.
  const rhombGroups = new Map<string, { d1: number; d2: number; count: number }>()
  for (const r of opts.rhombs ?? []) {
    const key = `${r.d1.toFixed(3)}:${r.d2.toFixed(3)}`
    const g = rhombGroups.get(key) ?? { d1: r.d1, d2: r.d2, count: 0 }
    g.count++
    rhombGroups.set(key, g)
  }
  const rhombs: RhombPanelType[] = [...rhombGroups.values()]
    .sort((a, b) => a.d1 * a.d2 - b.d1 * b.d2)
    .map((g, i) => {
      const count = g.count * opts.skinFactor
      const area = (g.d1 * g.d2) / 2
      const perSheet = fitsPerSheet(g.d1, g.d2, opts.sheetW, opts.sheetL)
      const seamed = perSheet === 0
      const sheets = seamed
        ? Math.ceil((count * area * SEAM_WASTE) / sheetArea)
        : Math.ceil(count / perSheet)
      return { label: `Z${i + 1}`, count, d1: g.d1, d2: g.d2, area, perSheet, seamed, sheets }
    })

  // Polygonal pieces (goldberg panels): grid nesting of the bounding box.
  const polyGroups = new Map<
    string,
    { outline: [number, number][]; edges: number[]; area: number; w: number; h: number; count: number }
  >()
  for (const raw of opts.polyOutlines ?? []) {
    const xs = raw.map((p) => p[0])
    const ys = raw.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const outline = raw.map((p) => [p[0] - minX, p[1] - minY] as [number, number])
    const w = Math.max(...xs) - minX
    const h = Math.max(...ys) - minY
    const edgeLens = outline.map((p, i) => {
      const q = outline[(i + 1) % outline.length]
      return Math.hypot(q[0] - p[0], q[1] - p[1])
    })
    let area = 0
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i]
      const [x1, y1] = outline[(i + 1) % outline.length]
      area += x0 * y1 - x1 * y0
    }
    area = Math.abs(area) / 2
    const key = `${edgeLens
      .slice()
      .sort((a, b) => a - b)
      .map((e) => e.toFixed(2))
      .join(':')}|${area.toFixed(1)}`
    const g = polyGroups.get(key) ?? { outline, edges: edgeLens, area, w, h, count: 0 }
    g.count++
    polyGroups.set(key, g)
  }
  const polys: PolyPanelType[] = [...polyGroups.values()]
    .sort((a, b) => a.area - b.area)
    .map((g, i) => {
      const count = g.count * opts.skinFactor
      const perSheet = rectsPerSheet(g.w, g.h, opts.sheetW, opts.sheetL)
      const seamed = perSheet === 0
      const sheets = seamed
        ? Math.ceil((count * g.area * SEAM_WASTE) / sheetArea)
        : Math.ceil(count / perSheet)
      return {
        label: `G${i + 1}`,
        count,
        sides: g.outline.length,
        edges: g.edges,
        outline: g.outline,
        area: g.area,
        boundingW: g.w,
        boundingH: g.h,
        perSheet,
        seamed,
        sheets,
      }
    })

  // Clipped pieces (opening-carved skin panels): unique, one-off shapes, so
  // each is packed individually by its bounding rect — the same trick as
  // the rectangular sheathing pieces, just without shape grouping. `seamed`
  // is always recomputed here (never trusted from the caller) since it
  // depends on this plan's sheet size.
  const clipped: ClippedPanelType[] = (opts.clipped ?? []).map((c) => ({
    ...c,
    seamed: rectsPerSheet(c.bboxW, c.bboxH, opts.sheetW, opts.sheetL) === 0,
  }))
  let clippedSheets = 0
  for (const c of clipped) {
    const count = opts.skinFactor
    if (c.seamed) {
      clippedSheets += Math.ceil((count * c.trueArea * SEAM_WASTE) / sheetArea)
    } else {
      const perSheet = rectsPerSheet(c.bboxW, c.bboxH, opts.sheetW, opts.sheetL)
      clippedSheets += Math.ceil(count / perSheet)
    }
  }

  const totalPanels =
    types.reduce((n, t) => n + t.count, 0) +
    rects.reduce((n, t) => n + t.count, 0) +
    rhombs.reduce((n, t) => n + t.count, 0) +
    polys.reduce((n, t) => n + t.count, 0) +
    clipped.length * opts.skinFactor
  const totalPanelArea =
    types.reduce((n, t) => n + t.area * t.count, 0) +
    rects.reduce((n, t) => n + t.area * t.count, 0) +
    rhombs.reduce((n, t) => n + t.area * t.count, 0) +
    polys.reduce((n, t) => n + t.area * t.count, 0) +
    clipped.reduce((n, c) => n + c.trueArea, 0) * opts.skinFactor
  const totalSheets =
    types.reduce((n, t) => n + t.sheets, 0) +
    rects.reduce((n, t) => n + t.sheets, 0) +
    rhombs.reduce((n, t) => n + t.sheets, 0) +
    polys.reduce((n, t) => n + t.sheets, 0) +
    clippedSheets
  return {
    types,
    rects,
    rhombs,
    polys,
    clipped,
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
