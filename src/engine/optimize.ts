import type { DomeModel, UnitSystem } from './types'
import { buildCutList, type JointMethodId } from './cutlist'
import { cutDoorways, emptyDoorwayCut, type DoorSpec, type DoorwayCut } from './doorway'
import { buildRiser } from './riser'
import { buildPanelFrames } from './panelFrames'
import { packCuts, type StockLength } from './packing'
import { workingToDiameter } from './units'

export interface OptimizeOptions {
  /** Search range in working units (inches or mm). */
  minDiameter: number
  maxDiameter: number
  /** Diameter step for the scan, working units. */
  step: number
  /** Cut rounding increment, working units. */
  increment: number
  endOffset: number
  kerf: number
  stock: StockLength[]
  units: UnitSystem
  /** Weight on rounding error vs material waste, 0..1 (1 = only error). */
  errorWeight?: number
  /** Parametric doorways (fixed physical size across candidate diameters). */
  doors?: DoorSpec[]
  /** Scrap threshold for trimmed door struts, working units. */
  minStubLength?: number
  /** Closure framing stud spacing, forwarded to the doorway cut. */
  studSpacing?: number
  /** Riser wall height, working units (0/omitted = none). Portal dims are
   * floor-referenced when set; riser framing joins each candidate's takeoff. */
  riserHeight?: number
  /** Riser member width for king-stud offsets, working units. */
  riserMemberWidth?: number
  /** Active joint method — when 'framed-panel', each candidate is scored on
   * its frame member takeoff instead of plain strut rows. */
  jointId?: JointMethodId
  /** Fixed doorway cut (topology only — its removed/trimmed edge and face
   * ids don't depend on radius) used to omit panels when scoring
   * 'framed-panel' candidates. */
  doorway?: DoorwayCut
}

export interface OptimizeCandidate {
  /** Diameter in working units. */
  diameter: number
  /** Diameter in input units (feet or meters). */
  diameterDisplay: number
  maxRoundingError: number
  meanRoundingError: number
  wasteFraction: number
  boardsNeeded: number
  score: number
}

export interface OptimizeResult {
  best: OptimizeCandidate | null
  top: OptimizeCandidate[]
  evaluated: number
}

/**
 * Scan a diameter range and score each candidate on how cleanly its strut
 * lengths round to the cut increment and how little stock is wasted.
 * The dome model is generated once; each candidate only rescales chords.
 */
export function optimizeDiameter(model: DomeModel, opts: OptimizeOptions): OptimizeResult {
  const wErr = opts.errorWeight ?? 0.6
  const wWaste = 1 - wErr
  const halfIncrement = opts.increment / 2
  const candidates: OptimizeCandidate[] = []

  const n = Math.max(1, Math.round((opts.maxDiameter - opts.minDiameter) / opts.step))
  for (let i = 0; i <= n; i++) {
    const diameter = opts.minDiameter + i * opts.step
    const doorway =
      opts.doors && opts.doors.length > 0
        ? cutDoorways(model, opts.doors, diameter / 2, {
            minStubLength: opts.minStubLength ?? 0,
            studSpacing: opts.studSpacing,
            riserHeight: opts.riserHeight,
          })
        : undefined
    const riser =
      (opts.riserHeight ?? 0) > 0
        ? buildRiser(model, diameter / 2, {
            height: opts.riserHeight!,
            studSpacing: opts.units === 'imperial' ? 16 : 400,
            memberWidth: opts.riserMemberWidth ?? (opts.units === 'imperial' ? 1.5 : 38),
            minStubLength: opts.minStubLength ?? 0,
            doors: opts.doors,
          })
        : undefined
    const candidateRadius = diameter / 2
    const framePlan =
      opts.jointId === 'framed-panel'
        ? buildPanelFrames(model, candidateRadius, opts.units, opts.doorway ?? emptyDoorwayCut())
        : null
    const cutList = buildCutList(
      model,
      {
        radius: candidateRadius,
        increment: opts.increment,
        endOffset: opts.endOffset,
        units: opts.units,
        jointId: opts.jointId,
      },
      doorway,
      riser,
      framePlan,
    )
    const packing = packCuts(cutList, { kerf: opts.kerf, stock: opts.stock })
    const meanError =
      cutList.rows.reduce((s, r) => s + r.roundingError, 0) / Math.max(1, cutList.rows.length)
    // Normalize error against the worst possible (half the increment).
    const errScore = halfIncrement > 0 ? cutList.maxRoundingError / halfIncrement : 0
    const score =
      wErr * errScore + wWaste * packing.wasteFraction + (packing.unplaceable.length > 0 ? 1000 : 0)
    candidates.push({
      diameter,
      diameterDisplay: workingToDiameter(diameter, opts.units),
      maxRoundingError: cutList.maxRoundingError,
      meanRoundingError: meanError,
      wasteFraction: packing.wasteFraction,
      boardsNeeded: packing.boards.length,
      score,
    })
  }
  candidates.sort((a, b) => a.score - b.score)
  return { best: candidates[0] ?? null, top: candidates.slice(0, 5), evaluated: candidates.length }
}
