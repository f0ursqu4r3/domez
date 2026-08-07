import type { UnitSystem } from './types'

/** All engine lengths flow through here as inches (imperial) or mm (metric). */

export const FEET_TO_INCHES = 12
export const METERS_TO_MM = 1000

export interface RoundingIncrement {
  /** Increment size in working units (inches or mm). */
  value: number
  label: string
}

export const IMPERIAL_INCREMENTS: RoundingIncrement[] = [
  { value: 1 / 32, label: '1/32″' },
  { value: 1 / 16, label: '1/16″' },
  { value: 1 / 8, label: '1/8″' },
  { value: 1 / 4, label: '1/4″' },
]

export const METRIC_INCREMENTS: RoundingIncrement[] = [
  { value: 0.5, label: '0.5 mm' },
  { value: 1, label: '1 mm' },
  { value: 5, label: '5 mm' },
]

export function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment
}

/** 37.375 -> "37 3/8″". Reduces the fraction; whole inches when exact. */
export function formatInchesFractional(inches: number, maxDenominator = 32): string {
  const sign = inches < 0 ? '-' : ''
  const abs = Math.abs(inches)
  let whole = Math.floor(abs)
  let num = Math.round((abs - whole) * maxDenominator)
  let den = maxDenominator
  if (num === maxDenominator) {
    whole += 1
    num = 0
  }
  while (num > 0 && num % 2 === 0 && den % 2 === 0) {
    num /= 2
    den /= 2
  }
  if (num === 0) return `${sign}${whole}″`
  if (whole === 0) return `${sign}${num}/${den}″`
  return `${sign}${whole} ${num}/${den}″`
}

/** Feet-and-inches summary for long dimensions: 316.5″ -> 26′ 4 1/2″ */
export function formatFeetInches(inches: number, maxDenominator = 32): string {
  const feet = Math.floor(inches / 12)
  const rest = inches - feet * 12
  if (feet === 0) return formatInchesFractional(rest, maxDenominator)
  return `${feet}′ ${formatInchesFractional(rest, maxDenominator)}`
}

export function formatMm(mm: number, decimals = 1): string {
  return `${mm.toFixed(decimals)} mm`
}

export function formatMeters(mm: number): string {
  return `${(mm / METERS_TO_MM).toFixed(3)} m`
}

/** Format a length in working units for the given system. */
export function formatLength(value: number, units: UnitSystem, opts?: { long?: boolean }): string {
  if (units === 'imperial') {
    return opts?.long ? formatFeetInches(value) : formatInchesFractional(value)
  }
  return opts?.long ? formatMeters(value) : formatMm(value)
}

/** Diameter input (feet or meters) to working units (inches or mm). */
export function diameterToWorking(diameter: number, units: UnitSystem): number {
  return units === 'imperial' ? diameter * FEET_TO_INCHES : diameter * METERS_TO_MM
}

export function workingToDiameter(value: number, units: UnitSystem): number {
  return units === 'imperial' ? value / FEET_TO_INCHES : value / METERS_TO_MM
}
