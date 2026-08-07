import type { CutList } from '../cutlist'
import type { PackingResult } from '../packing'
import type { DomeModel, UnitSystem } from '../types'
import { formatLength } from '../units'

const esc = (s: string | number) => {
  const str = String(s)
  return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str
}
const row = (...cells: (string | number)[]) => cells.map(esc).join(',')

export function cutListCsv(cutList: CutList, units: UnitSystem): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const lines = [
    row('Strut', 'Qty', `Cut length (${unit})`, 'Cut length (display)', `Exact (${unit})`,
      `Rounding error (${unit})`, `Chord (${unit})`, 'Axial angle (deg)', 'Dihedral (deg)'),
  ]
  for (const r of cutList.rows) {
    lines.push(row(
      r.label,
      r.quantity,
      r.roundedCutLength.toFixed(4),
      formatLength(r.roundedCutLength, units),
      r.exactCutLength.toFixed(4),
      r.roundingError.toFixed(4),
      r.chordLength.toFixed(4),
      r.axialAngleDeg.toFixed(2),
      Number.isNaN(r.dihedralMinDeg) ? '' : `${r.dihedralMinDeg.toFixed(2)}–${r.dihedralMaxDeg.toFixed(2)}`,
    ))
  }
  lines.push('')
  lines.push(row('Total struts', cutList.totalStruts))
  lines.push(row(`Total length (${unit})`, cutList.totalLength.toFixed(1)))
  lines.push(row(`Max rounding error (${unit})`, cutList.maxRoundingError.toFixed(4)))
  return lines.join('\n')
}

export function hubsCsv(model: DomeModel): string {
  const lines = [row('Hub type', 'Count', 'Struts', 'Pattern', 'Location')]
  for (const h of model.hubTypes) {
    lines.push(row(h.label, h.count, h.valence, h.pattern, h.isBase ? 'base ring' : 'dome'))
  }
  return lines.join('\n')
}

export function boardsCsv(packing: PackingResult, units: UnitSystem): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const lines = [row('Board #', 'Stock', 'Cuts', `Used (${unit})`, `Waste (${unit})`)]
  packing.boards.forEach((b, i) => {
    lines.push(row(
      i + 1,
      b.stockLabel,
      b.cuts.map((c) => `${c.label} ${formatLength(c.length, units)}`).join(' | '),
      b.used.toFixed(2),
      b.waste.toFixed(2),
    ))
  })
  return lines.join('\n')
}
