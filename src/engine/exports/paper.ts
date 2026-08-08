/** Shared geometry for the printable SVG documents (1 SVG user unit =
 * 1 inch or 1 mm, so declared physical size prints true at 100%). */
export const PAPER = {
  imperial: { w: 8.5, h: 11, unit: 'in', cal: 3, calLabel: '3 in', margin: 0.5 },
  metric: { w: 210, h: 297, unit: 'mm', cal: 75, calLabel: '75 mm', margin: 12 },
} as const

export const esc = (s: string | number) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
