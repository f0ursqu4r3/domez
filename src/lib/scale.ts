import type { UnitSystem } from '@/engine/types'

export interface GridSpec {
  /** Ring spacing, working units. */
  step: number
  /** Outer radius — a whole multiple of step. */
  radius: number
  rings: number
}

const STEPS: Record<UnitSystem, number[]> = {
  imperial: [12, 24, 60, 120], // 1, 2, 5, 10 ft
  metric: [500, 1000, 2000, 5000], // 0.5, 1, 2, 5 m
}

/**
 * Ring layout for the floor grid: the smallest clean real-unit step that
 * covers radius × 1.6 in at most 16 rings (largest step regardless if
 * even it exceeds 16), outer ring on a whole multiple of the step.
 */
export function gridSpec(radius: number, units: UnitSystem): GridSpec {
  const target = radius * 1.6
  const steps = STEPS[units]
  const step = steps.find((s) => Math.ceil(target / s) <= 16) ?? steps[steps.length - 1]
  const rings = Math.ceil(target / step)
  return { step, radius: rings * step, rings }
}
