import type { PanelFramePlan } from '../panelFrames'
import type { UnitSystem } from '../types'
import { formatLength } from '../units'
import { PAPER, esc } from './paper'

/**
 * Printable build jigs for framed-panel domes: one page per distinct panel
 * type, with its outline scaled to fit the page, every edge dimensioned
 * with the member cut it takes (long-point length + bevel) and every
 * corner dimensioned with the miter each member is cut to. Deliberately
 * schematic, like `panelPatternsSvg` — drawn to fit the page, not 1:1.
 */
export function frameJigsSvg(plan: PanelFramePlan, units: UnitSystem, title: string): string {
  const paper = PAPER[units]
  const m = paper.margin
  const fs = units === 'imperial' ? 0.15 : 3.8
  const stroke = units === 'imperial' ? 0.02 : 0.5
  const fmt = (v: number) => formatLength(v, units)

  const hasManySides = plan.types.some((t) => t.sides > 4)
  const hasSquareSill = plan.types.some((t) => t.members.some((mm) => mm.boundary && mm.bevelDeg === 0))
  const footNotes = [
    units === 'imperial' ? '16″ seam-bolt spacing.' : '400 mm seam-bolt spacing.',
    'Cut members back at the miter — the small point clash where panels meet is a normal build detail.',
  ]
  if (hasManySides) {
    footNotes.push('Hex/pent outlines are near-planar approximations — jig to the drawing.')
  }
  if (hasSquareSill) {
    footNotes.push('Natural base: sill members are square-cut — scribe to grade on site.')
  }

  const pageCount = Math.max(1, plan.types.length)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}${paper.unit}" height="${pageCount * paper.h}${paper.unit}" viewBox="0 0 ${paper.w} ${pageCount * paper.h}">`,
    `<style>text{font-family:ui-monospace,monospace;font-size:${fs}px;fill:#111}.h{font-size:${fs * 1.35}px;font-weight:bold}.s{font-size:${fs * 0.85}px;fill:#444}.lbl{font-size:${fs * 0.85}px;text-anchor:middle}.outline{stroke:#111;stroke-width:${stroke};fill:none}.vtx{fill:#111}.miter{fill:#06c;text-anchor:middle}.sep{stroke:#999;stroke-width:${stroke * 0.6};stroke-dasharray:${stroke * 12} ${stroke * 8}}</style>`,
    `<rect width="${paper.w}" height="${pageCount * paper.h}" fill="#fff"/>`,
  )

  if (plan.types.length === 0) {
    parts.push(
      `<text x="${m}" y="${m + fs * 1.5}" class="h">${esc(title)} — panel jigs</text>`,
      `<text x="${m}" y="${m + fs * 3.5}" class="s">no framed panels in this plan</text>`,
    )
  }

  const headerH = fs * 4.4
  const footH = footNotes.length * fs * 1.4 + fs * 0.8

  plan.types.forEach((t, ti) => {
    const y0 = ti * paper.h
    const push = (s: string) => parts.push(s)
    parts.push(`<g data-frame-page="${ti + 1}">`)

    const headerText =
      (ti === 0 ? `${title} — ` : '') + `${t.label} — build ${t.panelCount} · ${t.sides} sides`
    push(`<text x="${m}" y="${y0 + m + fs * 1.2}" class="h">${esc(headerText)}</text>`)
    push(
      `<text x="${m}" y="${y0 + m + fs * 2.8}" class="s">members: ${t.members.map((mm) => mm.label).join(', ')}</text>`,
    )

    // ---- Scale-to-fit + center the outline within the drawing box ----
    const boxX = m
    const boxY = y0 + m + headerH
    const boxW = paper.w - 2 * m
    const boxH = paper.h - headerH - footH - 2 * m
    const xs = t.outline.map((p) => p[0])
    const ys = t.outline.map((p) => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const w = Math.max(1e-6, maxX - minX)
    const h = Math.max(1e-6, maxY - minY)
    const s = Math.min(boxW / w, boxH / h)
    const ox = boxX + (boxW - w * s) / 2 - minX * s
    const oy = boxY + (boxH - h * s) / 2 - minY * s
    const pts = t.outline.map(([x, y]) => [ox + x * s, oy + y * s])
    const nV = pts.length
    const cx = pts.reduce((sum, p) => sum + p[0], 0) / nV
    const cy = pts.reduce((sum, p) => sum + p[1], 0) / nV

    push(`<path class="outline" d="M ${pts.map((p) => p.join(' ')).join(' L ')} Z"/>`)
    for (const p of pts) {
      push(`<circle class="vtx" cx="${p[0]}" cy="${p[1]}" r="${fs * 0.16}"/>`)
    }

    for (let i = 0; i < nV; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % nV]
      const member = t.members[t.edgeMemberIdx[i]]

      const ex = q[0] - p[0]
      const ey = q[1] - p[1]
      const elen = Math.hypot(ex, ey) || 1
      let nx = -ey / elen
      let ny = ex / elen
      const midx = (p[0] + q[0]) / 2
      const midy = (p[1] + q[1]) / 2
      if ((midx - cx) * nx + (midy - cy) * ny < 0) {
        nx = -nx
        ny = -ny
      }
      const tx = midx + nx * fs * 1.8
      const ty = midy + ny * fs * 1.8

      push(`<g data-edge="${i}" data-bevel="${member.bevelDeg.toFixed(1)}">`)
      push(`<line class="outline" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`)
      push(
        `<text x="${tx}" y="${ty}" class="lbl">${esc(member.label)} ${esc(fmt(member.longPointLength))}</text>`,
      )
      push(
        `<text x="${tx}" y="${ty + fs * 1.1}" class="lbl s">bevel ${member.bevelDeg.toFixed(1)}°${member.boundary ? ' (sill)' : ''}</text>`,
      )
      push(`</g>`)
    }

    for (let i = 0; i < nV; i++) {
      const v = pts[i]
      let dx = cx - v[0]
      let dy = cy - v[1]
      const dlen = Math.hypot(dx, dy) || 1
      dx /= dlen
      dy /= dlen
      const lx = v[0] + dx * fs * 1.6
      const ly = v[1] + dy * fs * 1.6
      push(
        `<text x="${lx}" y="${ly}" class="miter">miter ${(t.cornerAnglesDeg[i] / 2).toFixed(1)}°</text>`,
      )
    }

    footNotes.forEach((line, li) => {
      const fy = y0 + paper.h - m - (footNotes.length - 1 - li) * fs * 1.4
      push(`<text x="${m}" y="${fy}" class="s">${esc(line)}</text>`)
    })

    if (ti < plan.types.length - 1) {
      parts.push(`<line x1="0" y1="${y0 + paper.h}" x2="${paper.w}" y2="${y0 + paper.h}" class="sep"/>`)
    }
    parts.push(`</g>`)
  })

  parts.push(`</svg>`)
  return parts.join('\n')
}
