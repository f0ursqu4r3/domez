import type { CutList } from '../cutlist'
import type { DomeModel } from '../types'

/**
 * Minimal DXF R12 fabrication file. Two kinds of content:
 *  - `struts` layer: one dimensioned strut template per type (axis line at
 *    true cut length, end ticks, label) stacked vertically.
 *  - `dome_plan` layer: top view of the dome wireframe at true scale.
 * Units follow the working units (inches or mm) of the cut list.
 */
export function fabricationDxf(model: DomeModel, cutList: CutList, radius: number): string {
  const e: string[] = []
  const push = (...vals: (string | number)[]) => e.push(...vals.map(String))

  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    push(
      0,
      'LINE',
      8,
      layer,
      10,
      x1.toFixed(4),
      20,
      y1.toFixed(4),
      30,
      0,
      11,
      x2.toFixed(4),
      21,
      y2.toFixed(4),
      31,
      0,
    )
  const text = (layer: string, x: number, y: number, h: number, value: string) =>
    push(0, 'TEXT', 8, layer, 10, x.toFixed(4), 20, y.toFixed(4), 30, 0, 40, h.toFixed(2), 1, value)

  // Strut templates, stacked with spacing relative to dome size.
  const gap = Math.max(...cutList.rows.map((r) => r.roundedCutLength)) * 0.12
  cutList.rows.forEach((r, i) => {
    const y = -i * gap
    line('struts', 0, y, r.roundedCutLength, y)
    line('struts', 0, y - gap * 0.15, 0, y + gap * 0.15)
    line('struts', r.roundedCutLength, y - gap * 0.15, r.roundedCutLength, y + gap * 0.15)
    text(
      'struts',
      0,
      y + gap * 0.2,
      gap * 0.18,
      `${r.label} x${r.quantity}  L=${r.roundedCutLength.toFixed(3)}  axial=${r.axialAngleDeg.toFixed(2)}deg`,
    )
  })

  // Top-view dome plan to the right of the templates.
  const planX = Math.max(...cutList.rows.map((r) => r.roundedCutLength)) + radius * 1.4
  for (const edge of model.edges) {
    const a = model.vertices[edge.v0].position
    const b = model.vertices[edge.v1].position
    line('dome_plan', planX + a[0] * radius, a[1] * radius, planX + b[0] * radius, b[1] * radius)
  }

  return (
    [
      0,
      'SECTION',
      2,
      'HEADER',
      0,
      'ENDSEC',
      0,
      'SECTION',
      2,
      'TABLES',
      0,
      'TABLE',
      2,
      'LAYER',
      70,
      2,
      0,
      'LAYER',
      2,
      'struts',
      70,
      0,
      62,
      2,
      6,
      'CONTINUOUS',
      0,
      'LAYER',
      2,
      'dome_plan',
      70,
      0,
      62,
      5,
      6,
      'CONTINUOUS',
      0,
      'ENDTAB',
      0,
      'ENDSEC',
      0,
      'SECTION',
      2,
      'ENTITIES',
      ...e,
      0,
      'ENDSEC',
      0,
      'EOF',
    ].join('\n') + '\n'
  )
}
