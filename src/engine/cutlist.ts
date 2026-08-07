import type { DomeModel, UnitSystem } from './types'
import { roundToIncrement } from './units'

export type JointMethodId = 'hub' | 'flattened-pipe' | 'timber-plate'

export interface JointMethod {
  id: JointMethodId
  label: string
  /** Default length removed at EACH strut end, in inches. */
  defaultEndOffset: number
  note: string
}

export const JOINT_METHODS: JointMethod[] = [
  {
    id: 'hub',
    label: 'Hub connector',
    defaultEndOffset: 2,
    note: 'Cut length = chord − 2 × hub offset. Struts bolt to a hub; offset is the hub center-to-strut-end distance.',
  },
  {
    id: 'flattened-pipe',
    label: 'Flattened pipe / conduit',
    defaultEndOffset: 0,
    note: 'Hole-to-hole distance = chord length. Add ~1 × pipe Ø per end before flattening; drill on the chord dimension.',
  },
  {
    id: 'timber-plate',
    label: 'Timber + hub plate',
    defaultEndOffset: 1.5,
    note: 'Cut length = chord − 2 × plate offset. Ends beveled at the axial angle so faces seat flush against the hub plate.',
  },
]

export interface CutListRow {
  typeId: number
  label: string
  quantity: number
  /** Exact geometric chord length, working units. */
  chordLength: number
  /** Exact cut length after joint end offsets. */
  exactCutLength: number
  /** Cut length rounded to the chosen increment. */
  roundedCutLength: number
  /** |rounded − exact| */
  roundingError: number
  axialAngleDeg: number
  dihedralMinDeg: number
  dihedralMaxDeg: number
}

export interface CutList {
  rows: CutListRow[]
  totalStruts: number
  totalLength: number
  maxRoundingError: number
  radius: number
  endOffset: number
}

export interface CutListOptions {
  /** Dome radius in working units (inches or mm). */
  radius: number
  /** Rounding increment in working units. */
  increment: number
  /** Material removed at each strut end (working units). */
  endOffset: number
  units: UnitSystem
}

export function buildCutList(model: DomeModel, opts: CutListOptions): CutList {
  const rows: CutListRow[] = model.strutTypes.map((t) => {
    const chordLength = t.chordFactor * opts.radius
    const exact = Math.max(0, chordLength - 2 * opts.endOffset)
    const rounded = roundToIncrement(exact, opts.increment)
    return {
      typeId: t.id,
      label: t.label,
      quantity: t.count,
      chordLength,
      exactCutLength: exact,
      roundedCutLength: rounded,
      roundingError: Math.abs(rounded - exact),
      axialAngleDeg: t.axialAngleDeg,
      dihedralMinDeg: t.dihedralMinDeg,
      dihedralMaxDeg: t.dihedralMaxDeg,
    }
  })
  return {
    rows,
    totalStruts: rows.reduce((n, r) => n + r.quantity, 0),
    totalLength: rows.reduce((n, r) => n + r.roundedCutLength * r.quantity, 0),
    maxRoundingError: rows.reduce((m, r) => Math.max(m, r.roundingError), 0),
    radius: opts.radius,
    endOffset: opts.endOffset,
  }
}
