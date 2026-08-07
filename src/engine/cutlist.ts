import type { DomeModel, UnitSystem } from './types'
import type { DoorwayCut } from './doorway'
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
  /** 'strut' = regular type row; 'trimmed' = door-shortened pieces;
   * 'frame' = door buck members (jambs/header). */
  kind: 'strut' | 'trimmed' | 'frame'
  note?: string
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

/**
 * Build the cut list. When a doorway cut is supplied, removed and trimmed
 * struts leave the per-type counts, trimmed pieces appear as their own rows
 * (grouped by rounded length), and each door contributes buck members
 * (2 jambs + header).
 *
 * The first strutTypes.length rows are always the type rows in type order —
 * consumers index rows[edge.typeId].
 */
export function buildCutList(
  model: DomeModel,
  opts: CutListOptions,
  doorway?: DoorwayCut,
): CutList {
  const removedPerType = new Map<number, number>()
  if (doorway) {
    for (const eid of [...doorway.removedEdges, ...doorway.trimmedEdges]) {
      const typeId = model.edges[eid].typeId
      removedPerType.set(typeId, (removedPerType.get(typeId) ?? 0) + 1)
    }
  }

  const rows: CutListRow[] = model.strutTypes.map((t) => {
    const chordLength = t.chordFactor * opts.radius
    const exact = Math.max(0, chordLength - 2 * opts.endOffset)
    const rounded = roundToIncrement(exact, opts.increment)
    return {
      typeId: t.id,
      label: t.label,
      quantity: t.count - (removedPerType.get(t.id) ?? 0),
      chordLength,
      exactCutLength: exact,
      roundedCutLength: rounded,
      roundingError: Math.abs(rounded - exact),
      axialAngleDeg: t.axialAngleDeg,
      dihedralMinDeg: t.dihedralMinDeg,
      dihedralMaxDeg: t.dihedralMaxDeg,
      kind: 'strut' as const,
    }
  })

  if (doorway) {
    // Trimmed pieces, grouped by (type, rounded length). One end keeps its
    // hub cut; the other lands square on the buck, so no end offset there.
    const trimmedGroups = new Map<string, { typeId: number; rounded: number; exact: number; qty: number; doorIds: Set<string> }>()
    for (const piece of doorway.trimmed) {
      const exact = Math.max(0, piece.length - opts.endOffset)
      const rounded = roundToIncrement(exact, opts.increment)
      const key = `${piece.typeId}:${rounded.toFixed(6)}`
      const g = trimmedGroups.get(key) ?? {
        typeId: piece.typeId, rounded, exact, qty: 0, doorIds: new Set<string>(),
      }
      g.qty++
      g.doorIds.add(piece.doorId)
      trimmedGroups.set(key, g)
    }
    for (const g of [...trimmedGroups.values()].sort((a, b) => a.typeId - b.typeId || a.rounded - b.rounded)) {
      const t = model.strutTypes[g.typeId]
      rows.push({
        typeId: g.typeId,
        label: `${t.label}†`,
        quantity: g.qty,
        chordLength: g.exact + opts.endOffset,
        exactCutLength: g.exact,
        roundedCutLength: g.rounded,
        roundingError: Math.abs(g.rounded - g.exact),
        axialAngleDeg: t.axialAngleDeg,
        dihedralMinDeg: NaN,
        dihedralMaxDeg: NaN,
        kind: 'trimmed',
        note: `trimmed to ${[...g.doorIds].join(', ')} buck; hub cut one end, square cut at buck`,
      })
    }

    for (const door of doorway.doors) {
      const jamb = roundToIncrement(door.jambLength, opts.increment)
      const header = roundToIncrement(door.headerLength, opts.increment)
      rows.push(
        {
          typeId: -1,
          label: `${door.id} jamb`,
          quantity: 2,
          chordLength: door.jambLength,
          exactCutLength: door.jambLength,
          roundedCutLength: jamb,
          roundingError: Math.abs(jamb - door.jambLength),
          axialAngleDeg: 90,
          dihedralMinDeg: NaN,
          dihedralMaxDeg: NaN,
          kind: 'frame',
          note: `${door.id} buck vertical, square cuts`,
        },
        {
          typeId: -1,
          label: `${door.id} header`,
          quantity: 1,
          chordLength: door.headerLength,
          exactCutLength: door.headerLength,
          roundedCutLength: header,
          roundingError: Math.abs(header - door.headerLength),
          axialAngleDeg: 90,
          dihedralMinDeg: NaN,
          dihedralMaxDeg: NaN,
          kind: 'frame',
          note: `${door.id} rough-opening span; add framing allowance for your style`,
        },
      )

      // Closure framing: group identical part+length pieces into one row.
      const framingGroups = new Map<string, { part: string; exact: number; rounded: number; qty: number }>()
      for (const m of door.closureFraming) {
        const rounded = roundToIncrement(m.length, opts.increment)
        const key = `${m.part}:${rounded.toFixed(6)}`
        const g = framingGroups.get(key) ?? { part: m.part, exact: m.length, rounded, qty: 0 }
        g.qty += m.quantity
        framingGroups.set(key, g)
      }
      const framingNote: Record<string, string> = {
        'wall plate': `${door.id} closure wall bottom plate, square cuts`,
        'wall stud': `${door.id} closure wall stud; top lands on the shell edge`,
        'top blocking': `${door.id} closure top blocking, header to shell`,
      }
      for (const g of [...framingGroups.values()].sort(
        (a, b) => a.part.localeCompare(b.part) || b.rounded - a.rounded,
      )) {
        rows.push({
          typeId: -1,
          label: `${door.id} ${g.part}`,
          quantity: g.qty,
          chordLength: g.exact,
          exactCutLength: g.exact,
          roundedCutLength: g.rounded,
          roundingError: Math.abs(g.rounded - g.exact),
          axialAngleDeg: 90,
          dihedralMinDeg: NaN,
          dihedralMaxDeg: NaN,
          kind: 'frame',
          note: framingNote[g.part],
        })
      }
    }
  }

  return {
    rows,
    totalStruts: rows.filter((r) => r.kind !== 'frame').reduce((n, r) => n + r.quantity, 0),
    totalLength: rows.reduce((n, r) => n + r.roundedCutLength * r.quantity, 0),
    maxRoundingError: rows
      .filter((r) => r.kind === 'strut')
      .reduce((m, r) => Math.max(m, r.roundingError), 0),
    radius: opts.radius,
    endOffset: opts.endOffset,
  }
}
