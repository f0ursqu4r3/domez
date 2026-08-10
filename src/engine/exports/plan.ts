import type { DomeModel, UnitSystem } from '../types'
import type { DoorwayCut } from '../doorway'
import { orderedBaseRing } from '../riser'
import { formatLength } from '../units'
import { PAPER, esc } from './paper'

export interface PlanOptions {
  units: UnitSystem
  /** Working units. */
  radius: number
  /** Working units. 0 disables the riser note. */
  riserHeight: number
  /** Working units. */
  wallThickness: number
  title: string
}

/** Ring radius (working units) where interior standing height crosses h,
 * or the qualitative outcome when no ring exists. */
export type HeadroomOutcome =
  | { kind: 'ring'; radius: number }
  | { kind: 'everywhere' }
  | { kind: 'nowhere' }

export function headroomRing(
  model: DomeModel,
  radius: number,
  riserHeight: number,
  h: number,
): HeadroomOutcome {
  if (h <= riserHeight) return { kind: 'everywhere' }
  const R = radius
  if (model.rhombi) {
    // Zome: rotational profile — per z level, the max horizontal radius.
    const levels = new Map<number, number>()
    for (const v of model.vertices) {
      const z = Math.round(v.position[2] * 1e6) / 1e6
      const r = Math.hypot(v.position[0], v.position[1])
      levels.set(z, Math.max(levels.get(z) ?? 0, r))
    }
    const prof = [...levels.entries()].sort((a, b) => a[0] - b[0]) // base → apex
    const zTarget = (model.cutZ * R - riserHeight + h) / R // unit z
    if (zTarget >= prof[prof.length - 1][0]) return { kind: 'nowhere' }
    if (zTarget <= prof[0][0]) return { kind: 'everywhere' }
    const footprintR = model.unitBaseRadius * R
    for (let i = 1; i < prof.length; i++) {
      const [z0, r0] = prof[i - 1]
      const [z1, r1] = prof[i]
      if (zTarget <= z1) {
        const t = (zTarget - z0) / (z1 - z0 || 1)
        const ringRadius = (r0 + (r1 - r0) * t) * R
        if (ringRadius >= footprintR) return { kind: 'everywhere' }
        return { kind: 'ring', radius: ringRadius }
      }
    }
    return { kind: 'nowhere' }
  }
  // Sphere-based (geodesic + goldberg dual): unit sphere × R.
  const zStar = model.cutZ * R - riserHeight + h
  if (zStar >= R) return { kind: 'nowhere' }
  const ringRadius = Math.sqrt(R * R - zStar * zStar)
  if (ringRadius >= model.unitBaseRadius * R) return { kind: 'everywhere' }
  return { kind: 'ring', radius: ringRadius }
}

type Pt = [number, number]

/** Signed area × 2 (shoelace) of a closed polygon, world units². */
function shoelaceArea(pts: Pt[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    sum += x0 * y1 - x1 * y0
  }
  return Math.abs(sum) / 2
}

/** Centroid (arithmetic mean of vertices — adequate for the wall-offset
 * approximation at these thicknesses). */
function centroidOf(pts: Pt[]): Pt {
  const n = Math.max(1, pts.length)
  let cx = 0
  let cy = 0
  for (const [x, y] of pts) {
    cx += x
    cy += y
  }
  return [cx / n, cy / n]
}

/** Inset a polygon toward its centroid by `d`, per-vertex along the
 * normalized (centroid − vertex) direction. Polygon-offset approximation. */
function insetPolygon(pts: Pt[], centroid: Pt, d: number): Pt[] {
  return pts.map(([x, y]) => {
    const dx = centroid[0] - x
    const dy = centroid[1] - y
    const len = Math.hypot(dx, dy) || 1
    return [x + (dx / len) * d, y + (dy / len) * d] as Pt
  })
}

/** Distance from the origin to the ring boundary along the ray at `azDeg`
 * (0 = +x). Ray-casts against every ring edge and keeps the farthest hit —
 * correct for the star-shaped base rings this engine produces. Falls back
 * to the mean vertex radius when the ray misses (degenerate rings). */
export function ringRadiusAt(azDeg: number, pts: Pt[]): number {
  if (pts.length < 3) return 0
  const az = (azDeg * Math.PI) / 180
  const dx = Math.cos(az)
  const dy = Math.sin(az)
  let best = -Infinity
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % n]
    const ex = x1 - x0
    const ey = y1 - y0
    const det = ex * dy - ey * dx
    if (Math.abs(det) < 1e-12) continue
    const t = (ex * y0 - ey * x0) / det
    const u = (dx * y0 - dy * x0) / det
    if (t >= -1e-9 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t)
  }
  if (best > -Infinity) return best
  return pts.reduce((s, [x, y]) => s + Math.hypot(x, y), 0) / n
}

const fmtAz = (deg: number) => `${Number(deg.toFixed(1))}`

/**
 * Floor-plan page: base-ring footprint (outer wall + inset inner wall),
 * a dimension/scale/azimuth block, door gaps and window ticks from a
 * doorway cut, and dashed headroom-clearance rings with a legend. Scaled
 * to fit one page — the dome is far larger than the sheet, so the scale
 * bar (not 1:1 printing) carries the real size.
 */
export function planSvg(model: DomeModel, doorway: DoorwayCut, opts: PlanOptions): string {
  const paper = PAPER[opts.units]
  const m = paper.margin
  const fs = opts.units === 'imperial' ? 0.15 : 3.8
  const stroke = opts.units === 'imperial' ? 0.02 : 0.5
  const fmt = (v: number) => formatLength(v, opts.units)
  const R = opts.radius

  // ---- Footprint geometry (world units, z ignored — top-down view) ----
  const ringIds = orderedBaseRing(model)
  const outerPts: Pt[] =
    ringIds.length >= 3
      ? ringIds.map((vi) => {
          const p = model.vertices[vi].position
          return [p[0] * R, p[1] * R] as Pt
        })
      : [
          [-R, -R],
          [R, -R],
          [R, R],
          [-R, R],
        ]
  const centroid = centroidOf(outerPts)
  const innerPts = insetPolygon(outerPts, centroid, opts.wallThickness)

  // Footprint-only bbox — the printed overall dimension always describes the
  // building, never a headroom ring that happens to reach further out.
  const footMinX = Math.min(...outerPts.map((p) => p[0]))
  const footMaxX = Math.max(...outerPts.map((p) => p[0]))
  const footMinY = Math.min(...outerPts.map((p) => p[1]))
  const footMaxY = Math.max(...outerPts.map((p) => p[1]))

  let minX = footMinX
  let maxX = footMaxX
  let minY = footMinY
  let maxY = footMaxY

  // ---- Headroom thresholds ----
  const thresholds = opts.units === 'imperial' ? [72, 48] : [2000, 1200]
  const outcomes = thresholds.map((h) => ({ h, out: headroomRing(model, R, opts.riserHeight, h) }))
  for (const { out } of outcomes) {
    if (out.kind === 'ring') {
      minX = Math.min(minX, -out.radius)
      maxX = Math.max(maxX, out.radius)
      minY = Math.min(minY, -out.radius)
      maxY = Math.max(maxY, out.radius)
    }
  }

  const spanX = Math.max(1e-6, maxX - minX)
  const spanY = Math.max(1e-6, maxY - minY)
  // Room for the azimuth arrow (east) and the dimension/scale block (south).
  const padEast = spanX * 0.16
  const padWest = spanX * 0.06
  const padNorth = spanY * 0.08
  const padSouth = spanY * 0.4
  const wMinX = minX - padWest
  const wMaxX = maxX + padEast
  const wMinY = minY - padSouth
  const wMaxY = maxY + padNorth

  // ---- Doors / windows split from the doorway cut ----
  const doors = doorway.doors.filter((d) => !((d.sillHeight ?? 0) > 0))
  const windows = doorway.doors.filter((d) => (d.sillHeight ?? 0) > 0)

  // ---- Page layout ----
  const legendLines = 1 + thresholds.length + (opts.riserHeight > 0 ? 1 : 0)
  const headerH = fs * 3.2
  const footH = legendLines * fs * 1.5 + fs
  const boxX = m
  const boxY = m + headerH
  const boxW = paper.w - 2 * m
  const boxH = paper.h - headerH - footH - 2 * m

  const s = Math.min(boxW / (wMaxX - wMinX), boxH / (wMaxY - wMinY))
  const pxLeft = boxX + (boxW - (wMaxX - wMinX) * s) / 2
  const pyTop = boxY + (boxH - (wMaxY - wMinY) * s) / 2
  const ox = pxLeft - wMinX * s
  const oy = pyTop + wMaxY * s
  // Single mapping every geometry element flows through: plan y = −world y.
  const toPage = (x: number, y: number): Pt => [ox + x * s, oy - y * s]

  const pathOf = (pts: Pt[]) =>
    `M ${pts.map((p) => toPage(...p).join(' ')).join(' L ')} Z`

  const parts: string[] = []
  const push = (...ts: string[]) => parts.push(...ts)

  push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}${paper.unit}" height="${paper.h}${paper.unit}" viewBox="0 0 ${paper.w} ${paper.h}">`,
    `<style>text{font-family:ui-monospace,monospace;font-size:${fs}px;fill:#111}.h{font-size:${fs * 1.35}px;font-weight:bold}.s{font-size:${fs * 0.85}px;fill:#444}.wall{stroke:#111;stroke-width:${stroke};fill:none}.wall-inner{stroke:#111;stroke-width:${stroke * 0.7};fill:none}.dim{stroke:#06c;stroke-width:${stroke * 0.6};fill:none}.dimlbl{font-size:${fs * 0.85}px;fill:#06c;text-anchor:middle}.gap{fill:#fff}.gap-lbl{font-size:${fs * 0.8}px;text-anchor:middle}.tick{fill:#fc9;stroke:#c60;stroke-width:${stroke * 0.6}}.tick-lbl{font-size:${fs * 0.8}px;text-anchor:middle;fill:#c60}.headroom{stroke:#999;stroke-width:${stroke * 0.6};stroke-dasharray:${stroke * 8} ${stroke * 5};fill:none}.legend{font-size:${fs * 0.9}px}.arrow{stroke:#111;stroke-width:${stroke * 0.7};fill:none}</style>`,
    `<rect width="${paper.w}" height="${paper.h}" fill="#fff"/>`,
  )

  push(`<text x="${m}" y="${m + fs * 1.2}" class="h">${esc(opts.title)} — floor plan</text>`)
  const subtitle =
    `${opts.units} · radius ${esc(fmt(R))} · wall ${esc(fmt(opts.wallThickness))}` +
    (opts.riserHeight > 0 ? ` · riser ${esc(fmt(opts.riserHeight))}` : '')
  push(`<text x="${m}" y="${m + fs * 2.6}" class="s">${subtitle}</text>`)

  // ---- Footprint: outer wall + inset inner wall ----
  push(`<g data-plan-footprint="1">`)
  push(`<path class="wall" d="${pathOf(outerPts)}"/>`)
  push(`<path class="wall-inner" d="${pathOf(innerPts)}"/>`)
  push(`</g>`)

  // ---- Headroom rings (dashed circles centered on the plan origin) ----
  const [ocx, ocy] = toPage(0, 0)
  for (const { h, out } of outcomes) {
    if (out.kind === 'ring') {
      push(
        `<circle class="headroom" data-headroom-ring="1" data-height="${h}" cx="${ocx.toFixed(3)}" cy="${ocy.toFixed(3)}" r="${(out.radius * s).toFixed(3)}"/>`,
      )
    }
  }

  // ---- Doors: overlay a background-colored gap over both wall lines ----
  const overlap = opts.wallThickness * 0.35
  const gapQuad = (azDeg: number, halfWidth: number, r0: number, r1: number): Pt[] => {
    const az = (azDeg * Math.PI) / 180
    const cs = Math.cos(az)
    const sn = Math.sin(az)
    const at = (r: number, t: number): Pt => [r * cs - t * sn, r * sn + t * cs]
    return [at(r0, -halfWidth), at(r0, halfWidth), at(r1, halfWidth), at(r1, -halfWidth)]
  }

  for (const d of doors) {
    if (!d.fits) continue
    const ringR = ringRadiusAt(d.azimuthDeg, outerPts)
    // Angular half-span = atan(width/2 / ringR); the tangential half-width
    // at ringR is ringR·tan(that) = width/2 exactly, so it's used directly
    // (also sidesteps 0·∞ if ringR degenerates to 0 — no base ring).
    const halfWidth = d.width / 2
    const r0 = ringR + overlap
    const r1 = ringR - opts.wallThickness - overlap
    const quad = gapQuad(d.azimuthDeg, halfWidth, r0, r1).map((p) => toPage(...p))
    push(`<g data-door-gap="${esc(d.id)}">`)
    push(`<path class="gap" d="M ${quad.map((p) => p.join(' ')).join(' L ')} Z"/>`)
    const [lx, ly] = toPage(...gapQuad(d.azimuthDeg, 0, r0 + overlap * 3, r0 + overlap * 3)[0])
    push(
      `<text x="${lx.toFixed(3)}" y="${ly.toFixed(3)}" class="gap-lbl">${esc(fmt(d.width))} @ ${fmtAz(d.azimuthDeg)}°</text>`,
    )
    push(`</g>`)
  }

  // ---- Windows: a tick rectangle across the wall (does not break it) ----
  for (const w of windows) {
    if (!w.fits) continue
    const ringR = ringRadiusAt(w.azimuthDeg, outerPts)
    // See the door loop above: width/2 is the tangential half-width at
    // ringR directly, equal to ringR·tan(atan(width/2/ringR)).
    const halfWidth = w.width / 2
    const r0 = ringR + overlap
    const r1 = ringR - opts.wallThickness - overlap
    const quad = gapQuad(w.azimuthDeg, halfWidth, r0, r1).map((p) => toPage(...p))
    push(`<g data-window-tick="${esc(w.id)}">`)
    push(`<path class="tick" d="M ${quad.map((p) => p.join(' ')).join(' L ')} Z"/>`)
    const [lx, ly] = toPage(...gapQuad(w.azimuthDeg, 0, r0 + overlap * 3, r0 + overlap * 3)[0])
    push(
      `<text x="${lx.toFixed(3)}" y="${ly.toFixed(3)}" class="tick-lbl">${esc(fmt(w.width))} @ ${fmtAz(w.azimuthDeg)}° · sill ${esc(fmt(w.sillHeight ?? 0))}</text>`,
    )
    push(`</g>`)
  }

  // ---- Dimension / scale / azimuth block ----
  push(`<g data-dim="1">`)
  {
    // Extension ticks + overall x-span dimension line, south of the footprint.
    // Extents here are the footprint's own bbox — never widened by a headroom
    // ring — so the printed span always describes the building.
    const dimWorldY = footMinY - padSouth * 0.35
    const [xa, ya] = toPage(footMinX, footMinY)
    const [xb, yb] = toPage(footMinX, dimWorldY)
    const [xc, yc] = toPage(footMaxX, footMinY)
    const [xd, yd] = toPage(footMaxX, dimWorldY)
    push(`<line class="dim" x1="${xa.toFixed(3)}" y1="${ya.toFixed(3)}" x2="${xb.toFixed(3)}" y2="${yb.toFixed(3)}"/>`)
    push(`<line class="dim" x1="${xc.toFixed(3)}" y1="${yc.toFixed(3)}" x2="${xd.toFixed(3)}" y2="${yd.toFixed(3)}"/>`)
    const lineY = yb
    push(`<line class="dim" x1="${xa.toFixed(3)}" y1="${lineY.toFixed(3)}" x2="${xc.toFixed(3)}" y2="${lineY.toFixed(3)}"/>`)
    push(
      `<text x="${((xa + xc) / 2).toFixed(3)}" y="${(lineY + fs * 1.2).toFixed(3)}" class="dimlbl">${esc(fmt(footMaxX - footMinX))}</text>`,
    )

    // Floor area, from the shoelace area of the outer ring.
    const area = shoelaceArea(outerPts)
    const areaText =
      opts.units === 'imperial' ? `${(area / 144).toFixed(0)} ft²` : `${(area / 1e6).toFixed(1)} m²`
    push(
      `<text x="${((xa + xc) / 2).toFixed(3)}" y="${(lineY + fs * 2.6).toFixed(3)}" class="dimlbl">floor area ${esc(areaText)}</text>`,
    )

    // Scale bar: imperial 24″ × 5, metric 500 mm × 5 — drawn at plan scale,
    // clamped to the drawing box's own span (drop trailing segments rather
    // than overflow the page; always keep at least one).
    const step = opts.units === 'imperial' ? 24 : 500
    const maxSegs = Math.max(1, Math.floor(boxW / s / step))
    const segs = Math.min(5, maxSegs)
    const barWorldY = minY - padSouth * 0.75
    const [bx0, by0] = toPage(minX, barWorldY)
    for (let i = 0; i < segs; i++) {
      const [x0] = toPage(minX + i * step, barWorldY)
      const [x1] = toPage(minX + (i + 1) * step, barWorldY)
      push(
        `<rect x="${Math.min(x0, x1).toFixed(3)}" y="${(by0 - fs * 0.3).toFixed(3)}" width="${Math.abs(x1 - x0).toFixed(3)}" height="${(fs * 0.6).toFixed(3)}" fill="${i % 2 === 0 ? '#111' : '#fff'}" stroke="#111" stroke-width="${stroke * 0.5}"/>`,
      )
    }
    push(
      `<text x="${bx0.toFixed(3)}" y="${(by0 + fs * 1.6).toFixed(3)}" class="s">scale — each segment ${esc(fmt(step))}, ${esc(fmt(step * segs))} total</text>`,
    )

    // Azimuth arrow at 0° (world +x), just outside the wall.
    const [ax0, ay0] = toPage(0, 0)
    const [ax1, ay1] = toPage(Math.max(maxX, ringRadiusAt(0, outerPts)) + padEast * 0.6, 0)
    push(`<line class="arrow" x1="${ax0.toFixed(3)}" y1="${ay0.toFixed(3)}" x2="${ax1.toFixed(3)}" y2="${ay1.toFixed(3)}"/>`)
    push(
      `<text x="${(ax1 + fs * 0.4).toFixed(3)}" y="${(ay1 + fs * 0.3).toFixed(3)}" class="s">0°</text>`,
    )
  }
  push(`</g>`)

  // ---- Headroom legend ----
  let ly = paper.h - m - (legendLines - 1) * fs * 1.5
  push(`<text x="${m}" y="${ly.toFixed(3)}" class="legend h">Headroom clearance:</text>`)
  for (const { h, out } of outcomes) {
    ly += fs * 1.5
    let desc: string
    if (out.kind === 'ring') desc = `${fmt(out.radius)} radius`
    else desc = out.kind
    if (model.rhombi) desc += ' (interpolated from panel profile)'
    push(`<text x="${m}" y="${ly.toFixed(3)}" class="legend">≥ ${esc(fmt(h))}: ${esc(desc)}</text>`)
  }
  if (opts.riserHeight > 0) {
    ly += fs * 1.5
    push(
      `<text x="${m}" y="${ly.toFixed(3)}" class="legend s">Riser wall raises the floor ${esc(fmt(opts.riserHeight))} — headroom is measured from the raised floor.</text>`,
    )
  }

  push(`</svg>`)
  return parts.join('\n')
}
