import type { CutList } from '../cutlist'
import type { JointMethodId } from '../cutlist'
import type { PackingResult } from '../packing'
import type { DomeModel, UnitSystem } from '../types'
import { formatLength } from '../units'
import { miterCuts } from '../miter'
import { strutColor } from './svg'

/** Paper geometry in working units (1 SVG user unit = 1 in / 1 mm). */
const PAPER = {
  imperial: { w: 8.5, h: 11, unit: 'in', cal: 3, calLabel: '3 in', margin: 0.5 },
  metric: { w: 210, h: 297, unit: 'mm', cal: 75, calLabel: '75 mm', margin: 12 },
} as const

const esc = (s: string | number) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export interface TemplateOptions {
  units: UnitSystem
  jointId: JointMethodId
  /** Working units. */
  endOffset: number
  radius: number
  section:
    | { kind: 'rect'; width: number; depth: number }
    | { kind: 'round'; diameter: number }
  title: string
}

interface TemplateGroup {
  typeId: number
  label: string
  /** Ends cut like this. */
  count: number
  /** Off-square bevel for timber-plate, degrees. */
  bevelDeg?: number
  /** Mitered signature. */
  leftSeamDeg?: number
  rightSeamDeg?: number
  tiltDeg?: number
  hubLabels?: string[]
  /** Rounded cut length from the cut list. */
  cutLength: number
}

/**
 * 1:1 printable end cut templates, one page per distinct end signature.
 * Printing at 100% is true scale (the root SVG declares physical units);
 * page one carries a calibration ruler to verify before cutting.
 */
export function cutTemplatesSvg(
  model: DomeModel,
  cutList: CutList,
  opts: TemplateOptions,
): string {
  const paper = PAPER[opts.units]
  const typeRows = cutList.rows.filter((r) => r.kind === 'strut' && r.quantity > 0)

  // ---- End-signature groups ----
  const groups: TemplateGroup[] = []
  if (opts.jointId === 'mitered') {
    const cuts = miterCuts(model)
    const byKey = new Map<
      string,
      { typeId: number; count: number; hubs: Set<string>; l: number; r: number; t: number }
    >()
    for (const e of model.edges) {
      for (const end of cuts[e.id]) {
        const key = `${e.typeId}:${end.leftSeamDeg.toFixed(1)}:${end.rightSeamDeg.toFixed(1)}:${end.tiltDeg.toFixed(1)}`
        const g = byKey.get(key) ?? {
          typeId: e.typeId,
          count: 0,
          hubs: new Set<string>(),
          l: end.leftSeamDeg,
          r: end.rightSeamDeg,
          t: end.tiltDeg,
        }
        g.count++
        g.hubs.add(model.hubTypes[model.vertices[end.vertexId].hubTypeId].label)
        byKey.set(key, g)
      }
    }
    for (const g of [...byKey.values()].sort((a, b) => a.typeId - b.typeId || b.count - a.count)) {
      const row = typeRows.find((r) => r.typeId === g.typeId)
      groups.push({
        typeId: g.typeId,
        label: model.strutTypes[g.typeId].label,
        count: g.count,
        leftSeamDeg: g.l,
        rightSeamDeg: g.r,
        tiltDeg: g.t,
        hubLabels: [...g.hubs].sort(),
        cutLength: row?.roundedCutLength ?? model.strutTypes[g.typeId].chordFactor * opts.radius,
      })
    }
  } else {
    for (const r of typeRows) {
      groups.push({
        typeId: r.typeId,
        label: r.label,
        count: r.quantity * 2,
        bevelDeg: opts.jointId === 'timber-plate' ? 90 - r.axialAngleDeg : undefined,
        cutLength: r.roundedCutLength,
      })
    }
  }

  const m = paper.margin
  const fs = opts.units === 'imperial' ? 0.16 : 4 // base font size
  const stroke = opts.units === 'imperial' ? 0.02 : 0.5
  const pages = Math.max(1, groups.length)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}${paper.unit}" height="${pages * paper.h}${paper.unit}" viewBox="0 0 ${paper.w} ${pages * paper.h}">`,
    `<style>text{font-family:ui-monospace,monospace;font-size:${fs}px;fill:#111}.h{font-size:${fs * 1.3}px;font-weight:bold}.s{font-size:${fs * 0.85}px;fill:#444}.cut{stroke:#c00;stroke-width:${stroke * 1.5};fill:none}.outline{stroke:#111;stroke-width:${stroke};fill:none}.reg{stroke:#111;stroke-width:${stroke * 3}}.dim{stroke:#06c;stroke-width:${stroke * 0.8};fill:none}.sep{stroke:#999;stroke-width:${stroke * 0.6};stroke-dasharray:${stroke * 12} ${stroke * 8}}</style>`,
    `<rect width="${paper.w}" height="${pages * paper.h}" fill="#fff"/>`,
  )

  groups.forEach((g, pi) => {
    const y0 = pi * paper.h
    const cx = m
    let cy = y0 + m + fs
    const text = (x: number, yy: number, t: string, cls = '') =>
      parts.push(`<text x="${x}" y="${yy}"${cls ? ` class="${cls}"` : ''}>${esc(t)}</text>`)
    parts.push(`<g data-template-page="${pi + 1}">`)
    text(cx, cy, `${opts.title} — T${pi + 1} · strut ${g.label}`, 'h')
    cy += fs * 1.6
    parts.push(
      `<rect x="${cx}" y="${cy - fs}" width="${fs}" height="${fs}" fill="${strutColor(g.typeId)}"/>`,
    )
    text(cx + fs * 1.4, cy, `cut ${g.count} ends like this`)
    cy += fs * 1.5
    if (g.hubLabels) {
      text(cx, cy, `at hubs: ${g.hubLabels.join(', ')}`, 's')
      cy += fs * 1.4
    }
    if (pi === 0) {
      // Calibration ruler.
      const ry = cy + fs
      parts.push(
        `<line x1="${cx}" y1="${ry}" x2="${cx + paper.cal}" y2="${ry}" class="reg" data-cal-length="${paper.cal}"/>`,
        `<line x1="${cx}" y1="${ry - fs * 0.6}" x2="${cx}" y2="${ry + fs * 0.6}" class="outline"/>`,
        `<line x1="${cx + paper.cal}" y1="${ry - fs * 0.6}" x2="${cx + paper.cal}" y2="${ry + fs * 0.6}" class="outline"/>`,
      )
      text(cx + paper.cal + fs * 0.6, ry + fs * 0.35, `${paper.calLabel} — verify before cutting`, 's')
      cy = ry + fs * 2
    }

    // ---- 1:1 drawing, anchored to the left registration edge ----
    const drawX = cx
    const drawY = cy + fs * 1.2
    const drawW = paper.w - 2 * m
    if (opts.section.kind === 'rect') {
      const isMiter = g.leftSeamDeg !== undefined
      // Side view (depth) for timber bevel; plan view (width) for mitered.
      const h = isMiter ? opts.section.width : opts.section.depth
      const bodyLen = Math.min(drawW, opts.units === 'imperial' ? 7.5 : 186)
      parts.push(
        `<line x1="${drawX}" y1="${drawY - fs}" x2="${drawX}" y2="${drawY + h + fs}" class="reg"/>`,
      )
      text(drawX + fs * 0.3, drawY - fs * 0.4, 'align to board edge ▼', 's')
      parts.push(
        `<path class="outline" d="M ${drawX + bodyLen} ${drawY} H ${drawX} V ${drawY + h} H ${drawX + bodyLen}"/>`,
      )
      if (!isMiter && g.bevelDeg !== undefined) {
        // Axial bevel: cut line leans bevelDeg off square across the depth.
        const run = Math.tan((g.bevelDeg * Math.PI) / 180) * h
        const xTop = drawX + (opts.units === 'imperial' ? 1.2 : 30)
        parts.push(
          `<line x1="${xTop}" y1="${drawY}" x2="${xTop + run}" y2="${drawY + h}" class="cut"/>`,
        )
        text(xTop + run + fs * 0.5, drawY + h / 2, `${g.bevelDeg.toFixed(1)}° off square`, 's')
        text(
          drawX,
          drawY + h + fs * 1.6,
          `mark ${formatLength(g.cutLength, opts.units)} tip-to-tip along the top face — see cut list`,
          's',
        )
      } else if (isMiter) {
        // Plan view: ridge on the centerline, cheek lines at the seam angles.
        const ridgeX = drawX + (opts.units === 'imperial' ? 1.6 : 40)
        const midY = drawY + h / 2
        const runL = Math.tan(((g.leftSeamDeg ?? 45) * Math.PI) / 180) * (h / 2)
        const runR = Math.tan(((g.rightSeamDeg ?? 45) * Math.PI) / 180) * (h / 2)
        parts.push(
          `<line x1="${ridgeX}" y1="${midY}" x2="${ridgeX + runL}" y2="${drawY}" class="cut"/>`,
          `<line x1="${ridgeX}" y1="${midY}" x2="${ridgeX + runR}" y2="${drawY + h}" class="cut"/>`,
          `<line x1="${drawX}" y1="${midY}" x2="${ridgeX}" y2="${midY}" class="dim"/>`,
        )
        text(
          ridgeX + Math.max(runL, runR) + fs * 0.5,
          midY,
          `seams ${g.leftSeamDeg!.toFixed(1)}° / ${g.rightSeamDeg!.toFixed(1)}°`,
          's',
        )
        text(drawX, drawY + h + fs * 1.6, `blade tilt ${g.tiltDeg!.toFixed(1)}°`, 's')
        text(
          drawX,
          drawY + h + fs * 3,
          `full chord ${formatLength(g.cutLength, opts.units)} ridge-to-ridge — see miter CSV`,
          's',
        )
      }
    } else {
      // Round section: tube outline, square end, hole center for pipe.
      const od = opts.section.diameter
      const bodyLen = Math.min(drawW, opts.units === 'imperial' ? 7.5 : 186)
      parts.push(
        `<line x1="${drawX}" y1="${drawY - fs}" x2="${drawX}" y2="${drawY + od + fs}" class="reg"/>`,
        `<path class="outline" d="M ${drawX + bodyLen} ${drawY} H ${drawX} V ${drawY + od} H ${drawX + bodyLen}"/>`,
      )
      if (opts.jointId === 'flattened-pipe') {
        const hx = drawX + od
        const hy = drawY + od / 2
        parts.push(
          `<g data-hole-center="1"><line x1="${hx - fs * 0.5}" y1="${hy}" x2="${hx + fs * 0.5}" y2="${hy}" class="cut"/><line x1="${hx}" y1="${hy - fs * 0.5}" x2="${hx}" y2="${hy + fs * 0.5}" class="cut"/></g>`,
        )
        text(
          drawX,
          drawY + od + fs * 1.6,
          `hole center ${formatLength(od, opts.units)} from the flattened end · hole-to-hole = ${formatLength(g.cutLength, opts.units)}`,
          's',
        )
      } else {
        text(
          drawX,
          drawY + od + fs * 1.6,
          `square cut · ${formatLength(g.cutLength, opts.units)} end-to-end · hub offset ${formatLength(opts.endOffset, opts.units)}`,
          's',
        )
      }
    }

    // Page boundary crop marks + separator.
    const py = y0 + paper.h
    parts.push(
      `<line x1="0" y1="${py}" x2="${paper.w}" y2="${py}" class="sep"/>`,
      `</g>`,
    )
  })

  // Footer note on the last page.
  const fy = pages * paper.h - m
  parts.push(
    `<text x="${m}" y="${fy}" class="s">Trimmed (†) and frame pieces cut square at the buck/plate — see the cut list.</text>`,
    `</svg>`,
  )
  return parts.join('\n')
}

export interface BoardDiagramOptions {
  units: UnitSystem
  title: string
  /** Working-unit kerf, shown in the footer. */
  kerf: number
}

/**
 * Board layout diagrams: every packed board as a horizontal bar with its
 * cuts, kerf ticks, and waste tail — the visual cutting plan. Reference
 * scale (page rules align to real paper; the bars are scaled to fit).
 */
export function boardDiagramsSvg(packing: PackingResult, opts: BoardDiagramOptions): string {
  const paper = PAPER[opts.units]
  const fs = opts.units === 'imperial' ? 0.13 : 3.4
  const stroke = opts.units === 'imperial' ? 0.015 : 0.4
  const m = paper.margin
  const labelW = opts.units === 'imperial' ? 1.4 : 35
  const barH = opts.units === 'imperial' ? 0.3 : 7.5
  const gap = opts.units === 'imperial' ? 0.16 : 4
  const barX = m + labelW
  const barW = paper.w - barX - m
  const maxStock = Math.max(1, ...packing.boards.map((b) => b.stockLength))
  const sx = barW / maxStock

  const parts: string[] = []
  const body: string[] = []
  let y = m + fs * 2.2

  const text = (x: number, yy: number, t: string, cls = '') =>
    body.push(`<text x="${x}" y="${yy}"${cls ? ` class="${cls}"` : ''}>${esc(t)}</text>`)

  text(m, y, `${opts.title} — board diagrams`, 'h')
  y += fs * 2.4

  let lastStock = ''
  packing.boards.forEach((b, i) => {
    if (b.stockLabel !== lastStock) {
      lastStock = b.stockLabel
      y += gap
      text(m, y + fs, `${b.stockLabel} stock`, 'h')
      y += fs * 1.8
    }
    body.push(`<g data-board="${i + 1}">`)
    text(m, y + barH * 0.65, `#${i + 1}`, 's')
    body.push(
      `<rect x="${barX}" y="${y}" width="${b.stockLength * sx}" height="${barH}" class="stockrect"/>`,
    )
    let cx = barX
    b.cuts.forEach((c, j) => {
      const w = c.length * sx
      body.push(
        `<rect x="${cx}" y="${y}" width="${w}" height="${barH}" fill="${strutColor(c.typeId)}55" stroke="#555" stroke-width="${stroke * 0.6}"/>`,
      )
      const label =
        w > (opts.units === 'imperial' ? 0.8 : 20)
          ? `${c.label} ${formatLength(c.length, opts.units)}`
          : c.label
      text(cx + w / 2, y + barH * 0.65, label, 'c')
      cx += w
      if (j < b.cuts.length - 1) {
        body.push(
          `<line x1="${cx}" y1="${y - fs * 0.35}" x2="${cx}" y2="${y + barH + fs * 0.35}" class="kerf" data-kerf-tick="1"/>`,
        )
      }
    })
    if (b.waste > 0.01) {
      const wx = barX + b.used * sx
      const ww = Math.max(0, (b.stockLength - b.used) * sx)
      body.push(`<rect x="${wx}" y="${y}" width="${ww}" height="${barH}" fill="url(#hatch)"/>`)
      if (ww > (opts.units === 'imperial' ? 0.5 : 13)) {
        text(wx + ww / 2, y + barH * 0.65, `waste ${formatLength(b.waste, opts.units)}`, 'c s')
      }
    }
    body.push(`</g>`)
    y += barH + gap
  })

  if (packing.boards.length === 0) {
    text(m, y, 'No boards — enable stock lengths in the Parameters panel.', 's')
    y += fs * 2
  }

  y += fs
  const counts = packing.boardCounts.map((c) => `${c.stockLabel} × ${c.count}`).join(' · ')
  text(
    m,
    y + fs,
    `${packing.boards.length} boards — ${counts || 'none'} · waste ${(packing.wasteFraction * 100).toFixed(1)}% · kerf ${formatLength(opts.kerf, opts.units)}`,
    's',
  )
  y += fs * 2 + m

  const totalH = Math.max(paper.h, y)
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}${paper.unit}" height="${totalH}${paper.unit}" viewBox="0 0 ${paper.w} ${totalH}">`,
    `<style>text{font-family:ui-monospace,monospace;font-size:${fs}px;fill:#111}.h{font-size:${fs * 1.25}px;font-weight:bold}.s{fill:#444}.c{text-anchor:middle;font-size:${fs * 0.9}px}.stockrect{fill:#f3f3f3;stroke:#111;stroke-width:${stroke}}.kerf{stroke:#c00;stroke-width:${stroke}}</style>`,
    `<defs><pattern id="hatch" width="${fs}" height="${fs}" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="${fs}" stroke="#999" stroke-width="${stroke}"/></pattern></defs>`,
    `<rect width="${paper.w}" height="${totalH}" fill="#fff"/>`,
  )
  // Page-boundary rules.
  for (let py = paper.h; py < totalH; py += paper.h) {
    parts.push(
      `<line x1="0" y1="${py}" x2="${paper.w}" y2="${py}" stroke="#999" stroke-width="${stroke * 0.6}" stroke-dasharray="${stroke * 12} ${stroke * 8}"/>`,
    )
  }
  parts.push(...body, `</svg>`)
  return parts.join('\n')
}
