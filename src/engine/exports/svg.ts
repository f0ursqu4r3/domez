import type { CutList } from '../cutlist'
import type { DomeModel, UnitSystem } from '../types'
import { formatLength } from '../units'
import type { AssemblyPlan } from '../assembly'

export const STRUT_COLORS = [
  '#f59e0b',
  '#38bdf8',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#4ade80',
  '#fbbf24',
  '#22d3ee',
  '#c084fc',
  '#f87171',
  '#a3e635',
]

export function strutColor(typeId: number): string {
  return STRUT_COLORS[typeId % STRUT_COLORS.length]
}

const XML = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * Printable fabrication sheet: one dimensioned drawing per strut type with
 * cut length, axial end angle, quantity, and the type's tape color.
 */
export function fabricationSvg(
  model: DomeModel,
  cutList: CutList,
  units: UnitSystem,
  title: string,
): string {
  const rowH = 110
  const width = 1000
  const margin = 60
  const barX0 = margin + 120
  const barX1 = width - margin - 150
  const height = 130 + cutList.rows.length * rowH + 40
  const maxLen = Math.max(...cutList.rows.map((r) => r.roundedCutLength))

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Menlo, Consolas, monospace">`,
  )
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`)
  parts.push(
    `<text x="${margin}" y="52" font-size="26" font-weight="bold" fill="#111">${XML(title)}</text>`,
  )
  parts.push(
    `<text x="${margin}" y="78" font-size="13" fill="#555">${model.params.frequency}V ${model.params.fraction} dome · ${cutList.totalStruts} struts · lengths are cut lengths (joint offsets applied)</text>`,
  )

  cutList.rows.forEach((r, i) => {
    const y = 130 + i * rowH
    const color = strutColor(r.typeId)
    const barLen = (barX1 - barX0) * (r.roundedCutLength / maxLen)
    const barY = y + 34
    parts.push(`<g>`)
    parts.push(`<rect x="${margin}" y="${y + 10}" width="34" height="34" rx="4" fill="${color}"/>`)
    parts.push(
      `<text x="${margin + 17}" y="${y + 33}" font-size="18" font-weight="bold" text-anchor="middle" fill="#111">${r.label}</text>`,
    )
    parts.push(
      `<text x="${margin}" y="${y + 66}" font-size="12" fill="#333">× ${r.quantity}</text>`,
    )
    // strut bar with end-angle wedges
    parts.push(
      `<rect x="${barX0}" y="${barY}" width="${barLen.toFixed(1)}" height="16" fill="#e5e5e5" stroke="#111" stroke-width="1"/>`,
    )
    // dimension line
    const dimY = barY + 38
    parts.push(
      `<line x1="${barX0}" y1="${dimY}" x2="${(barX0 + barLen).toFixed(1)}" y2="${dimY}" stroke="#111" stroke-width="1"/>`,
    )
    parts.push(
      `<line x1="${barX0}" y1="${dimY - 6}" x2="${barX0}" y2="${dimY + 6}" stroke="#111" stroke-width="1"/>`,
    )
    parts.push(
      `<line x1="${(barX0 + barLen).toFixed(1)}" y1="${dimY - 6}" x2="${(barX0 + barLen).toFixed(1)}" y2="${dimY + 6}" stroke="#111" stroke-width="1"/>`,
    )
    parts.push(
      `<text x="${(barX0 + barLen / 2).toFixed(1)}" y="${dimY - 6}" font-size="15" font-weight="bold" text-anchor="middle" fill="#111">${XML(formatLength(r.roundedCutLength, units))}</text>`,
    )
    // right column: angles
    parts.push(
      `<text x="${barX1 + 24}" y="${barY + 4}" font-size="12" fill="#333">axial ${r.axialAngleDeg.toFixed(2)}°</text>`,
    )
    if (!Number.isNaN(r.dihedralMinDeg)) {
      parts.push(
        `<text x="${barX1 + 24}" y="${barY + 22}" font-size="12" fill="#333">dihedral ${r.dihedralMinDeg.toFixed(1)}–${r.dihedralMaxDeg.toFixed(1)}°</text>`,
      )
    }
    parts.push(
      `<text x="${barX1 + 24}" y="${barY + 40}" font-size="11" fill="#888">err ${r.roundingError < 1e-9 ? '0' : formatLength(r.roundingError, units)}</text>`,
    )
    parts.push(`</g>`)
  })
  parts.push('</svg>')
  return parts.join('\n')
}

/** Printable hub label sheet: one sticker per hub with id, type, pattern. */
export function hubLabelsSvg(_model: DomeModel, plan: AssemblyPlan, title: string): string {
  const cols = 4
  const cellW = 240
  const cellH = 88
  const margin = 40
  const rows = Math.ceil(plan.hubLabels.length / cols)
  const width = margin * 2 + cols * cellW
  const height = margin * 2 + 60 + rows * cellH

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Menlo, Consolas, monospace">`,
  )
  parts.push(`<rect width="${width}" height="${height}" fill="#fff"/>`)
  parts.push(
    `<text x="${margin}" y="${margin + 8}" font-size="20" font-weight="bold" fill="#111">${XML(title)} — hub labels</text>`,
  )
  plan.hubLabels.forEach((h, i) => {
    const x = margin + (i % cols) * cellW
    const y = margin + 40 + Math.floor(i / cols) * cellH
    parts.push(`<g>`)
    parts.push(
      `<rect x="${x + 4}" y="${y + 4}" width="${cellW - 8}" height="${cellH - 8}" rx="8" fill="none" stroke="#999" stroke-dasharray="4 3"/>`,
    )
    parts.push(
      `<text x="${x + 18}" y="${y + 34}" font-size="20" font-weight="bold" fill="#111">V${h.vertexId}</text>`,
    )
    parts.push(
      `<text x="${x + 96}" y="${y + 34}" font-size="14" fill="#333">${h.hubLabel} · ring ${h.course}</text>`,
    )
    parts.push(
      `<text x="${x + 18}" y="${y + 62}" font-size="13" fill="#555">${XML(h.pattern)}</text>`,
    )
    parts.push(`</g>`)
  })
  parts.push('</svg>')
  return parts.join('\n')
}
