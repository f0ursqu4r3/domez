import type { PanelPlan } from '../panels'
import type { UnitSystem } from '../types'
import { formatLength } from '../units'
import { PAPER, esc } from './paper'

export interface PatternOptions {
  units: UnitSystem
  title: string
}

const deg = (rad: number) => (rad * 180) / Math.PI

/**
 * Dimensioned panel drawings: one page per panel type across the three
 * families — P triangles (true shape, edge lengths + corner angles),
 * R riser rectangles, Z zome rhombi. Deliberately NOT 1:1 — straight-edged
 * panels are laid out from the printed dimensions.
 */
export function panelPatternsSvg(plan: PanelPlan, opts: PatternOptions): string {
  const paper = PAPER[opts.units]
  const m = paper.margin
  const fs = opts.units === 'imperial' ? 0.15 : 3.8
  const stroke = opts.units === 'imperial' ? 0.02 : 0.5

  interface Page {
    label: string
    count: number
    hint: string
    /** Outline points in shape units, plus dimension callbacks. */
    render: (ox: number, oy: number, s: number, push: (t: string) => void) => void
    /** Shape bounds for scaling. */
    w: number
    h: number
  }
  const pages: Page[] = []
  const fmt = (v: number) => formatLength(v, opts.units)
  const hintOf = (perSheet: number, seamed: boolean) =>
    seamed ? 'seamed — too large for one sheet' : `${perSheet} per sheet — mirror alternates`

  for (const t of plan.types) {
    const [a, b, c] = t.edges
    const apexX = (a * a + c * c - b * b) / (2 * a)
    const apexY = Math.sqrt(Math.max(0, c * c - apexX * apexX))
    const angA = deg(Math.acos(Math.max(-1, Math.min(1, (b * b + c * c - a * a) / (2 * b * c)))))
    const angB = deg(Math.acos(Math.max(-1, Math.min(1, (a * a + c * c - b * b) / (2 * a * c)))))
    const angC = 180 - angA - angB
    pages.push({
      label: t.label,
      count: t.count,
      hint: hintOf(t.perSheet, t.seamed),
      w: a,
      h: apexY,
      render: (ox, oy, s, push) => {
        const p0 = [ox, oy + apexY * s]
        const p1 = [ox + a * s, oy + apexY * s]
        const pA = [ox + apexX * s, oy]
        push(
          `<path class="outline" d="M ${p0[0]} ${p0[1]} L ${p1[0]} ${p1[1]} L ${pA[0]} ${pA[1]} Z"/>`,
        )
        const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
        const edgeLbl = (p: number[], q: number[], len: number, dy: number) => {
          const [x, y] = mid(p, q)
          push(`<text x="${x}" y="${y + dy}" class="lbl">${esc(fmt(len))}</text>`)
        }
        edgeLbl(p0, p1, a, fs * 1.2)
        edgeLbl(p1, pA, b, -fs * 0.4)
        edgeLbl(pA, p0, c, -fs * 0.4)
        push(`<text x="${p0[0] + fs * 0.4}" y="${p0[1] - fs * 0.5}" class="s" data-angle="${angB.toFixed(2)}">∠${angB.toFixed(1)}°</text>`)
        push(`<text x="${p1[0] - fs * 2.4}" y="${p1[1] - fs * 0.5}" class="s" data-angle="${angA.toFixed(2)}">∠${angA.toFixed(1)}°</text>`)
        push(`<text x="${pA[0] + fs * 0.4}" y="${pA[1] + fs * 1.2}" class="s" data-angle="${angC.toFixed(2)}">∠${angC.toFixed(1)}°</text>`)
      },
    })
  }
  for (const r of plan.rects) {
    pages.push({
      label: r.label,
      count: r.count,
      hint: hintOf(r.perSheet, r.seamed),
      w: r.w,
      h: r.h,
      render: (ox, oy, s, push) => {
        push(`<rect class="outline" x="${ox}" y="${oy}" width="${r.w * s}" height="${r.h * s}"/>`)
        push(`<text x="${ox + (r.w * s) / 2}" y="${oy + r.h * s + fs * 1.3}" class="lbl">${esc(fmt(r.w))}</text>`)
        push(`<text x="${ox + r.w * s + fs * 0.4}" y="${oy + (r.h * s) / 2}" class="s">${esc(fmt(r.h))}</text>`)
        push(`<text x="${ox}" y="${oy - fs * 0.5}" class="s">riser sheathing</text>`)
      },
    })
  }
  for (const z of plan.rhombs) {
    const side = Math.hypot(z.d1 / 2, z.d2 / 2)
    const acute = deg(2 * Math.atan(z.d2 / z.d1))
    const obtuse = 180 - acute
    pages.push({
      label: z.label,
      count: z.count,
      hint: hintOf(z.perSheet, z.seamed),
      w: z.d1,
      h: z.d2,
      render: (ox, oy, s, push) => {
        const cx = ox + (z.d1 * s) / 2
        const cyy = oy + (z.d2 * s) / 2
        push(
          `<path class="outline" d="M ${ox} ${cyy} L ${cx} ${oy} L ${ox + z.d1 * s} ${cyy} L ${cx} ${oy + z.d2 * s} Z"/>`,
        )
        push(`<line class="dim" x1="${ox}" y1="${cyy}" x2="${ox + z.d1 * s}" y2="${cyy}"/>`)
        push(`<line class="dim" x1="${cx}" y1="${oy}" x2="${cx}" y2="${oy + z.d2 * s}"/>`)
        push(`<text x="${cx}" y="${cyy - fs * 0.4}" class="lbl">${esc(fmt(z.d1))} × ${esc(fmt(z.d2))} diagonals</text>`)
        push(`<text x="${cx}" y="${oy + z.d2 * s + fs * 1.3}" class="lbl">side ${esc(fmt(side))}</text>`)
        push(`<text x="${ox + fs * 0.4}" y="${cyy + fs * 1.2}" class="s" data-angle="${acute.toFixed(2)}">∠${acute.toFixed(1)}°</text>`)
        push(`<text x="${cx + fs * 0.4}" y="${oy + fs * 1.4}" class="s" data-angle="${obtuse.toFixed(2)}">∠${obtuse.toFixed(1)}°</text>`)
      },
    })
  }

  for (const g of plan.polys) {
    pages.push({
      label: g.label,
      count: g.count,
      hint: hintOf(g.perSheet, g.seamed),
      w: g.boundingW,
      h: g.boundingH,
      render: (ox, oy, s, push) => {
        const pts = g.outline.map(([x, y]) => [ox + x * s, oy + y * s])
        push(
          `<path class="outline" d="M ${pts.map((p) => p.join(' ')).join(' L ')} Z"/>`,
        )
        const n = pts.length
        for (let i = 0; i < n; i++) {
          const p = g.outline[i]
          const q = g.outline[(i + 1) % n]
          const mx = ox + ((p[0] + q[0]) / 2) * s
          const my = oy + ((p[1] + q[1]) / 2) * s
          push(`<text x="${mx}" y="${my - fs * 0.3}" class="lbl">${esc(fmt(g.edges[i]))}</text>`)
          // Interior angle at vertex i+1 (between edge i and edge i+1).
          const r = g.outline[(i + 2) % n]
          const v1 = [p[0] - q[0], p[1] - q[1]]
          const v2 = [r[0] - q[0], r[1] - q[1]]
          const ang = deg(
            Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  (v1[0] * v2[0] + v1[1] * v2[1]) /
                    (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1])),
                ),
              ),
            ),
          )
          const cx0 = ox + q[0] * s
          const cy0 = oy + q[1] * s
          push(
            `<text x="${cx0 + fs * 0.3}" y="${cy0 + fs * 0.9}" class="s" data-angle="${ang.toFixed(2)}">∠${ang.toFixed(1)}°</text>`,
          )
        }
      },
    })
  }

  const pageCount = Math.max(1, pages.length)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}${paper.unit}" height="${pageCount * paper.h}${paper.unit}" viewBox="0 0 ${paper.w} ${pageCount * paper.h}">`,
    `<style>text{font-family:ui-monospace,monospace;font-size:${fs}px;fill:#111}.h{font-size:${fs * 1.35}px;font-weight:bold}.s{font-size:${fs * 0.85}px;fill:#444}.lbl{font-size:${fs * 0.9}px;text-anchor:middle}.outline{stroke:#111;stroke-width:${stroke};fill:none}.dim{stroke:#06c;stroke-width:${stroke * 0.6};stroke-dasharray:${stroke * 6} ${stroke * 4}}.sep{stroke:#999;stroke-width:${stroke * 0.6};stroke-dasharray:${stroke * 12} ${stroke * 8}}</style>`,
    `<rect width="${paper.w}" height="${pageCount * paper.h}" fill="#fff"/>`,
  )

  if (pages.length === 0) {
    parts.push(
      `<text x="${m}" y="${m + fs * 1.5}" class="h">${esc(opts.title)} — panel patterns</text>`,
      `<text x="${m}" y="${m + fs * 3.5}" class="s">no panels — everything is cut or painted open</text>`,
    )
  }

  pages.forEach((pg, pi) => {
    const y0 = pi * paper.h
    const push = (t: string) => parts.push(t)
    parts.push(`<g data-pattern-page="${pi + 1}">`)
    push(`<text x="${m}" y="${y0 + m + fs * 1.2}" class="h">${esc(opts.title)} — panel ${esc(pg.label)}</text>`)
    push(`<text x="${m}" y="${y0 + m + fs * 2.8}">cut ${pg.count} · ${esc(pg.hint)}</text>`)
    const boxW = paper.w - 2 * m - (opts.units === 'imperial' ? 1 : 25)
    const boxH = paper.h * 0.6
    const s = Math.min(boxW / pg.w, boxH / pg.h)
    pg.render(m + (opts.units === 'imperial' ? 0.3 : 8), y0 + m + fs * 5, s, push)
    push(
      `<text x="${m}" y="${y0 + paper.h - m}" class="s">drawn to fit the page — cut from dimensions</text>`,
    )
    parts.push(`<line x1="0" y1="${y0 + paper.h}" x2="${paper.w}" y2="${y0 + paper.h}" class="sep"/>`)
    parts.push(`</g>`)
  })

  parts.push(`</svg>`)
  return parts.join('\n')
}
