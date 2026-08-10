import type { CutList } from '../cutlist'
import type { DoorFrameInfo } from '../doorway'
import type { PanelPlan } from '../panels'
import type { PanelFramePlan } from '../panelFrames'
import type { PackingResult } from '../packing'
import type { OpeningGroup } from '../openings'
import type { DomeModel, UnitSystem } from '../types'
import { formatLength } from '../units'
import { miterCuts } from '../miter'
import type { CostEstimate } from '../bom'
import type { LoadsResult } from '../loads'

const esc = (s: string | number) => {
  const str = String(s)
  return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str
}
const row = (...cells: (string | number)[]) => cells.map(esc).join(',')

export function cutListCsv(cutList: CutList, units: UnitSystem): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const lines = [
    row(
      'Strut',
      'Qty',
      `Cut length (${unit})`,
      'Cut length (display)',
      `Exact (${unit})`,
      `Rounding error (${unit})`,
      `Chord (${unit})`,
      'Axial angle (deg)',
      'Dihedral (deg)',
      'Kind',
      'Notes',
    ),
  ]
  for (const r of cutList.rows) {
    lines.push(
      row(
        r.label,
        r.quantity,
        r.roundedCutLength.toFixed(4),
        formatLength(r.roundedCutLength, units),
        r.exactCutLength.toFixed(4),
        r.roundingError.toFixed(4),
        r.chordLength.toFixed(4),
        Number.isNaN(r.axialAngleDeg) ? '' : r.axialAngleDeg.toFixed(2),
        Number.isNaN(r.dihedralMinDeg)
          ? ''
          : `${r.dihedralMinDeg.toFixed(2)}–${r.dihedralMaxDeg.toFixed(2)}`,
        r.kind,
        r.note ?? '',
      ),
    )
  }
  lines.push('')
  lines.push(row('Total struts', cutList.totalStruts))
  lines.push(row(`Total length (${unit})`, cutList.totalLength.toFixed(1)))
  lines.push(row(`Max rounding error (${unit})`, cutList.maxRoundingError.toFixed(4)))
  return lines.join('\n')
}

/** Per-strut-END compound angles for the mitered hubless joint. */
export function miterCsv(model: DomeModel, units: UnitSystem, radius: number): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const cuts = miterCuts(model)
  const lines = [
    row(
      'Edge',
      'Strut type',
      'End',
      'Hub vertex',
      'Hub type',
      'Left seam (deg)',
      'Right seam (deg)',
      'Tilt (deg)',
      `Chord (${unit})`,
    ),
  ]
  for (const e of model.edges) {
    const t = model.strutTypes[e.typeId]
    cuts[e.id].forEach((end, i) => {
      const hub = model.hubTypes[model.vertices[end.vertexId].hubTypeId]
      lines.push(
        row(
          e.id,
          t.label,
          i === 0 ? 'v0' : 'v1',
          end.vertexId,
          hub.label,
          end.leftSeamDeg.toFixed(2),
          end.rightSeamDeg.toFixed(2),
          end.tiltDeg.toFixed(2),
          (e.chordFactor * radius).toFixed(3),
        ),
      )
    })
  }
  return lines.join('\n')
}

export function hubsCsv(model: DomeModel): string {
  const lines = [row('Hub type', 'Count', 'Struts', 'Pattern', 'Location')]
  for (const h of model.hubTypes) {
    lines.push(row(h.label, h.count, h.valence, h.pattern, h.isBase ? 'base ring' : 'dome'))
  }
  return lines.join('\n')
}

export function openingsCsv(
  groups: OpeningGroup[],
  doors: DoorFrameInfo[],
  units: UnitSystem,
): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const areaUnit = units === 'imperial' ? 'ft2' : 'm2'
  const areaOf = (a: number) => (units === 'imperial' ? a / 144 : a / 1e6)
  const lines = [
    row(
      'Opening',
      'Type',
      'Detail',
      `Area (${areaUnit})`,
      `Perimeter (${unit})`,
      'Frame / frame-out',
      'Struts affected',
      'Notes',
    ),
  ]
  for (const d of doors) {
    lines.push(
      row(
        d.id,
        'doorway',
        `${d.width.toFixed(1)} × ${d.height.toFixed(1)} ${unit} @ ${d.azimuthDeg}°`,
        areaOf(d.area).toFixed(2),
        (2 * d.height + d.width).toFixed(2),
        `2× jamb ${d.jambLength.toFixed(1)}, 1× header ${d.headerLength.toFixed(1)}`,
        `${d.removedStrutCount} removed, ${d.trimmedStrutCount} trimmed, ${d.removedHubCount} hubs out`,
        d.fits
          ? `buck inset ${d.tunnelDepth.toFixed(1)} ${unit}; closure sides ${areaOf(d.closureSideArea).toFixed(2)} + top ${areaOf(d.closureTopArea).toFixed(2)} ${areaUnit}`
          : 'DOES NOT FIT SHELL',
      ),
    )
  }
  for (const g of groups) {
    lines.push(
      row(
        g.label,
        g.type,
        `${g.faceIds.length} panels`,
        areaOf(g.area).toFixed(2),
        g.perimeter.toFixed(2),
        g.interiorSummary || '—',
        g.perimeterSummary,
        g.reachesBase ? 'reaches base' : '',
      ),
    )
  }
  return lines.join('\n')
}

export function panelsCsv(plan: PanelPlan, units: UnitSystem): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const areaUnit = units === 'imperial' ? 'ft2' : 'm2'
  const areaOf = (a: number) => (units === 'imperial' ? a / 144 : a / 1e6)
  const lines = [
    row(
      'Panel',
      `Qty${plan.skinFactor === 2 ? ' (both skins)' : ''}`,
      `Edges (${unit})`,
      `Area (${areaUnit})`,
      `Per ${plan.sheetLabel}`,
      'Sheets',
      'Notes',
    ),
  ]
  for (const t of plan.types) {
    lines.push(
      row(
        t.label,
        t.count,
        t.edges.map((e) => e.toFixed(2)).join(' / '),
        areaOf(t.area).toFixed(2),
        t.seamed ? '—' : t.perSheet,
        t.sheets,
        t.seamed ? 'too large for one sheet — seam from pieces' : 'two per nested rectangle',
      ),
    )
  }
  lines.push('')
  lines.push(row('Total panels', plan.totalPanels))
  lines.push(row(`Total sheets (${plan.sheetLabel})`, plan.totalSheets))
  lines.push(row('Sheet waste', `${(plan.wasteFraction * 100).toFixed(1)}%`))
  return lines.join('\n')
}

/** Framed-panel member takeoff: one row per distinct member spec per type. */
export function framesCsv(plan: PanelFramePlan, units: UnitSystem): string {
  const lines = [
    row(
      'type',
      'member',
      'qty',
      'long_point',
      'miter_start_deg',
      'miter_end_deg',
      'bevel_deg',
      'boundary',
    ),
  ]
  for (const t of plan.types) {
    for (const m of t.members) {
      lines.push(
        row(
          t.label,
          m.label,
          m.count * t.panelCount,
          formatLength(m.longPointLength, units),
          m.miterStartDeg.toFixed(1),
          m.miterEndDeg.toFixed(1),
          m.bevelDeg.toFixed(1),
          m.boundary ? 'yes' : 'no',
        ),
      )
    }
  }
  return lines.join('\n')
}

export function costsCsv(est: CostEstimate, currency: string): string {
  const lines = [row('Item', 'Qty', `Unit price (${currency})`, `Line total (${currency})`, 'Note')]
  for (const l of est.lines) {
    lines.push(
      row(
        l.label,
        l.quantity,
        l.unpriced ? 'unpriced' : l.priceEach.toFixed(2),
        l.unpriced ? '' : l.total.toFixed(2),
        l.note ?? '',
      ),
    )
  }
  lines.push('')
  lines.push(row(`Total (${currency})`, est.total.toFixed(2)))
  lines.push(row('Unpriced lines', est.unpricedCount))
  return lines.join('\n')
}

/** Per-member loads: force, sense, utilization, governing case. */
export function loadsCsv(
  model: DomeModel,
  result: LoadsResult,
  radiusWorking: number,
  units: UnitSystem,
): string {
  if (!result.ok) return ''
  const toForce = units === 'imperial' ? 0.224809 : 1
  const fUnit = units === 'imperial' ? 'lbf' : 'N'
  const lines = [row('edge', 'type', 'length', `force_${fUnit}`, 'sense', 'utilization_pct', 'case')]
  for (const m of result.members) {
    const e = model.edges[m.edgeId]
    lines.push(
      row(
        m.edgeId,
        model.strutTypes[e.typeId].label,
        formatLength(e.chordFactor * radiusWorking, units),
        (Math.abs(m.forceN) * toForce).toFixed(1),
        m.forceN >= 0 ? 'T' : 'C',
        (m.utilization * 100).toFixed(1),
        m.caseLabel,
      ),
    )
  }
  return lines.join('\n')
}

export function boardsCsv(packing: PackingResult, units: UnitSystem): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const lines = [row('Board #', 'Stock', 'Cuts', `Used (${unit})`, `Waste (${unit})`)]
  packing.boards.forEach((b, i) => {
    lines.push(
      row(
        i + 1,
        b.stockLabel,
        b.cuts.map((c) => `${c.label} ${formatLength(c.length, units)}`).join(' | '),
        b.used.toFixed(2),
        b.waste.toFixed(2),
      ),
    )
  })
  return lines.join('\n')
}
