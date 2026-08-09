import { describe, expect, it } from 'vitest'
import { gridSpec } from '../scale'

describe('floor grid spec', () => {
  it('picks clean imperial steps', () => {
    // 26 ft dome: radius 156 in, target 249.6 → 12 in gives 21 rings (>16),
    // 24 in gives 11 → step 2 ft.
    const s = gridSpec(156, 'imperial')
    expect(s.step).toBe(24)
    expect(s.rings).toBe(11)
    expect(s.radius).toBe(264)
    expect(s.radius).toBeGreaterThanOrEqual(156 * 1.6)

    // 3 ft dome: radius 18 in → finest step.
    expect(gridSpec(18, 'imperial').step).toBe(12)

    // 120 ft dome: radius 720 in → only 120 in keeps rings ≤ 16.
    const big = gridSpec(720, 'imperial')
    expect(big.step).toBe(120)
    expect(big.rings).toBe(10)
  })

  it('picks clean metric steps and caps at the largest', () => {
    // 8 m dome: radius 4000 mm, target 6400 → 500 mm gives 13 rings.
    const s = gridSpec(4000, 'metric')
    expect(s.step).toBe(500)
    expect(s.rings).toBe(13)
    expect(s.radius).toBe(6500)

    // absurd 200 m dome: even 5 m exceeds 16 rings — use it anyway.
    const huge = gridSpec(100000, 'metric')
    expect(huge.step).toBe(5000)
    expect(huge.rings).toBe(32)
    expect(huge.radius).toBe(160000)
  })
})
