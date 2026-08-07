import type { CutList } from '../cutlist'
import type { PackingResult } from '../packing'
import type { DomeModel } from '../types'

export interface ProjectSettings {
  frequency: number
  fraction: string
  baseMode: string
  diameter: number
  units: string
  material: string
  jointMethod: string
  endOffset: number
  increment: number
  kerf: number
  stock: { length: number; label: string }[]
}

/** Round-trippable project file: settings drive the app; derived data is
 * included for consumers that only read the file. */
export function projectJson(
  settings: ProjectSettings,
  model: DomeModel,
  cutList: CutList,
  packing: PackingResult,
): string {
  return JSON.stringify(
    {
      app: 'domez',
      version: 1,
      settings,
      derived: {
        actualFraction: model.actualFraction,
        strutTypes: model.strutTypes.map((t) => ({
          label: t.label,
          chordFactor: t.chordFactor,
          count: t.count,
          axialAngleDeg: t.axialAngleDeg,
        })),
        hubTypes: model.hubTypes.map((h) => ({
          label: h.label,
          valence: h.valence,
          pattern: h.pattern,
          isBase: h.isBase,
          count: h.count,
        })),
        cutList: cutList.rows.map((r) => ({
          label: r.label,
          quantity: r.quantity,
          cutLength: r.roundedCutLength,
          exact: r.exactCutLength,
          error: r.roundingError,
        })),
        totals: {
          struts: cutList.totalStruts,
          hubs: model.vertices.length,
          panels: model.faces.length,
          boards: packing.boardCounts,
          wasteFraction: packing.wasteFraction,
        },
      },
    },
    null,
    2,
  )
}

export function parseProjectJson(text: string): ProjectSettings | null {
  try {
    const data = JSON.parse(text)
    if (data?.app !== 'domez' || !data.settings) return null
    return data.settings as ProjectSettings
  } catch {
    return null
  }
}
