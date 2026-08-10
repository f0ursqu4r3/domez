import type { AssemblyPlan } from '../assembly'
import type { CutList } from '../cutlist'
import type { DomeModel, UnitSystem } from '../types'
import { formatLength } from '../units'
import { strutColor } from './svg'
import { PAPER, esc } from './paper'

export interface GuideOptions {
  units: UnitSystem
  radius: number
  title: string
  framedPanel?: boolean
}

/**
 * Printable assembly guide: a cover page with totals and standing
 * instructions, then one page per course — a top-down plan diagram with
 * everything already erected in faint gray and this course's risers
 * (dashed) and ring struts (solid) in their type colors.
 */
export function assemblyGuideSvg(
  model: DomeModel,
  plan: AssemblyPlan,
  cutList: CutList,
  opts: GuideOptions,
): string {
  const paper = PAPER[opts.units]
  const m = paper.margin
  const fs = opts.units === 'imperial' ? 0.15 : 3.8
  const stroke = opts.units === 'imperial' ? 0.015 : 0.4
  const pages = 1 + plan.courses.length

  // ---- Top-down projection: working coords scaled into a square box ----
  const R = opts.radius
  const xs = model.vertices.map((v) => v.position[0] * R)
  const ys = model.vertices.map((v) => -v.position[1] * R)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const boxW = paper.w - 2 * m
  const boxH = paper.h * 0.62
  const scale = Math.min(boxW, boxH) / span
  const px = (vid: number) => m + (xs[vid] - minX + (span - (maxX - minX)) / 2) * scale
  // py is offset per page when used.
  const pyRel = (vid: number) => (ys[vid] - minY + (span - (maxY - minY)) / 2) * scale

  const typeRowByLabel = new Map(cutList.rows.filter((r) => r.kind === 'strut').map((r) => [r.label, r]))

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}${paper.unit}" height="${pages * paper.h}${paper.unit}" viewBox="0 0 ${paper.w} ${pages * paper.h}">`,
    `<style>text{font-family:ui-monospace,monospace;font-size:${fs}px;fill:#111}.h{font-size:${fs * 1.35}px;font-weight:bold}.s{font-size:${fs * 0.85}px;fill:#444}.old{stroke:#ccc;stroke-width:${stroke};fill:none}.sep{stroke:#999;stroke-width:${stroke * 0.6};stroke-dasharray:${stroke * 12} ${stroke * 8}}.lbl{font-size:${fs * 0.8}px;text-anchor:middle}</style>`,
    `<rect width="${paper.w}" height="${pages * paper.h}" fill="#fff"/>`,
  )
  const text = (x: number, y: number, t: string, cls = '') =>
    parts.push(`<text x="${x}" y="${y}"${cls ? ` class="${cls}"` : ''}>${esc(t)}</text>`)

  // ---- Cover ----
  let cy = m + fs * 1.5
  text(m, cy, `${opts.title} — assembly guide`, 'h')
  cy += fs * 2
  const summary = [
    `${cutList.totalStruts} struts · ${model.vertices.length} hubs · ${plan.courses.length} courses`,
    `diameter ${formatLength(2 * R, opts.units, { long: true })} · height ${formatLength(model.unitHeight * R, opts.units, { long: true })}`,
  ]
  for (const line of summary) {
    text(m, cy, line)
    cy += fs * 1.5
  }
  cy += fs * 0.5
  text(m, cy, 'Strut tally (cut lengths include the joint end offset):', 's')
  cy += fs * 1.4
  for (const r of cutList.rows.filter((r) => r.kind === 'strut' && r.quantity > 0)) {
    parts.push(
      `<rect x="${m}" y="${cy - fs * 0.85}" width="${fs * 0.9}" height="${fs * 0.9}" fill="${strutColor(r.typeId)}"/>`,
    )
    text(m + fs * 1.3, cy, `${r.label} × ${r.quantity} @ ${formatLength(r.roundedCutLength, opts.units)}`)
    cy += fs * 1.35
  }
  cy += fs
  for (const line of [
    '1. Raise each course bottom-up: stand the risers from the ring below, then close the ring.',
    '2. Print hub labels (Assembly tab) and tape each pattern to its plate before build day.',
    '3. Trimmed (†) door/window pieces install with their bucks — see the cut list and openings.',
    ...(opts.framedPanel
      ? [
          'Framed-panel build: place whole panels in the same course order — seams bolt to the previous course.',
        ]
      : []),
  ]) {
    text(m, cy, line, 's')
    cy += fs * 1.4
  }
  parts.push(`<line x1="0" y1="${paper.h}" x2="${paper.w}" y2="${paper.h}" class="sep"/>`)

  // ---- Course pages ----
  const placed: number[] = []
  plan.courses.forEach((course, ci) => {
    const y0 = (ci + 1) * paper.h
    const name =
      course.index === 0
        ? 'Base ring'
        : course.index === plan.courses.length - 1
          ? 'Apex'
          : `Course ${course.index + 1}`
    parts.push(`<g data-course-page="${ci + 1}">`)
    text(m, y0 + m + fs, `${String(ci + 1).padStart(2, '0')} — ${name}`, 'h')

    const diagY = y0 + m + fs * 2.5
    const py = (vid: number) => diagY + pyRel(vid)
    // Previously placed edges, faint.
    for (const eid of placed) {
      const e = model.edges[eid]
      parts.push(
        `<line x1="${px(e.v0)}" y1="${py(e.v0)}" x2="${px(e.v1)}" y2="${py(e.v1)}" class="old"/>`,
      )
    }
    // This course's new struts: risers dashed, ring solid, type colors.
    const draw = (eid: number, dashed: boolean) => {
      const e = model.edges[eid]
      const color = strutColor(e.typeId)
      parts.push(
        `<g data-new-strut="${eid}"><line x1="${px(e.v0)}" y1="${py(e.v0)}" x2="${px(e.v1)}" y2="${py(e.v1)}" stroke="${color}" stroke-width="${stroke * 2.4}"${dashed ? ` stroke-dasharray="${stroke * 8} ${stroke * 5}"` : ''}/><text x="${(px(e.v0) + px(e.v1)) / 2}" y="${(py(e.v0) + py(e.v1)) / 2 - fs * 0.2}" class="lbl" fill="${color}">${esc(model.strutTypes[e.typeId].label)}</text></g>`,
      )
    }
    for (const eid of course.riserStrutIds) draw(eid, true)
    for (const eid of course.ringStrutIds) draw(eid, false)
    for (const hid of course.hubIds) {
      parts.push(`<circle cx="${px(hid)}" cy="${py(hid)}" r="${fs * 0.28}" fill="#333"/>`)
    }
    placed.push(...course.riserStrutIds, ...course.ringStrutIds)

    // Sidebar under the diagram.
    let sy = diagY + Math.min(boxW, boxH) + fs * 1.8
    const hubTypes = [
      ...new Set(course.hubIds.map((h) => model.hubTypes[model.vertices[h].hubTypeId].label)),
    ].sort()
    text(m, sy, `${course.hubIds.length} hubs — ${hubTypes.join(', ')}`, 's')
    sy += fs * 1.4
    const tally = Object.entries(course.strutTally)
      .map(([label, count]) => {
        const row = typeRowByLabel.get(label)
        return `${count}× ${label}${row ? ` @ ${formatLength(row.roundedCutLength, opts.units)}` : ''}`
      })
      .join(' · ')
    text(m, sy, tally || 'no new struts', 's')
    sy += fs * 1.4
    text(
      m,
      sy,
      `${course.riserStrutIds.length} risers from below (dashed) · ${course.ringStrutIds.length} in-course (solid)`,
      's',
    )
    parts.push(`<line x1="0" y1="${y0 + paper.h}" x2="${paper.w}" y2="${y0 + paper.h}" class="sep"/>`)
    parts.push(`</g>`)
  })

  parts.push(`</svg>`)
  return parts.join('\n')
}
