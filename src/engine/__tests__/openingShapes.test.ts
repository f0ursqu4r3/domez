import { describe, expect, it } from 'vitest'
import {
  archTooFlat, effectiveHeight, offsetConvexOutward, openingArea,
  openingOutline, outlineBuckMembers,
} from '../openingShapes'

const isConvexCCW = (poly: [number, number][]) => {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length]
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (cross < -1e-9) return false
  }
  return true
}

describe('openingOutline', () => {
  it('rect is the four corners', () => {
    expect(openingOutline('rect', 36, 80, 0)).toEqual([[-18, 0], [18, 0], [18, 80], [-18, 80]])
  })
  it('arch has 11 vertices, equal chords 2r·sin(π/16), convex CCW', () => {
    const poly = openingOutline('arch', 36, 80, 0)
    expect(poly).toHaveLength(11)
    expect(isConvexCCW(poly)).toBe(true)
    const chord = 2 * 18 * Math.sin(Math.PI / 16)
    for (let i = 2; i < 10; i++) {
      const [a, b] = [poly[i], poly[i + 1]]
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(chord, 9)
    }
    expect(poly[2]).toEqual([18, 62])   // spring point, j = 80 - 18
    expect(poly[10]).toEqual([-18, 62])
  })
  it('arch with h exactly w/2 drops the jamb vertices (9 points)', () => {
    expect(openingOutline('arch', 36, 18, 0)).toHaveLength(9)
  })
  it('circle is a 16-gon with horizontal bottom and top edges', () => {
    const poly = openingOutline('circle', 24, 999, 36) // height ignored
    expect(poly).toHaveLength(16)
    expect(isConvexCCW(poly)).toBe(true)
    expect(poly[15][1]).toBeCloseTo(poly[0][1], 9)   // flat bottom
    expect(poly[7][1]).toBeCloseTo(poly[8][1], 9)    // flat top
    for (const [t, h] of poly) expect(Math.hypot(t, h - 48)).toBeCloseTo(12, 9) // on circle, center h=36+12
  })
  it('triangle apex sits at (0, b+h)', () => {
    expect(openingOutline('triangle', 30, 40, 36)).toEqual([[-15, 36], [15, 36], [0, 76]])
  })
})

describe('offsetConvexOutward', () => {
  it('margin 0 is the identity', () => {
    const poly = openingOutline('circle', 24, 24, 36)
    const off = offsetConvexOutward(poly, 0, 0)
    off.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(poly[i][0], 9)
      expect(p[1]).toBeCloseTo(poly[i][1], 9)
    })
  })
  it('rect with bottomMargin 0 grows sides and top only (door rule)', () => {
    const off = offsetConvexOutward(openingOutline('rect', 36, 80, 0), 1.5, 0)
    expect(off).toEqual([[-19.5, 0], [19.5, 0], [19.5, 81.5], [-19.5, 81.5]])
  })
  it('circle offset stays convex and grows every vertex radially', () => {
    const off = offsetConvexOutward(openingOutline('circle', 24, 24, 36), 1.5, 1.5)
    expect(isConvexCCW(off)).toBe(true)
    for (const [t, h] of off) expect(Math.hypot(t, h - 48)).toBeGreaterThan(12 + 1.4)
  })
})

describe('outlineBuckMembers', () => {
  it('rect window: jambs, header, sill', () => {
    const parts = outlineBuckMembers('rect', 24, 36, true)
    expect(parts.map((m) => [m.part, m.quantity])).toEqual([
      ['jamb', 2], ['header', 1], ['sill', 1],
    ])
    expect(parts.every((m) => m.miterDegA === 0 && m.miterDegB === 0)).toBe(true)
  })
  it('arch: 2 jambs + 8 segments at 11.25°', () => {
    const parts = outlineBuckMembers('arch', 36, 80, false)
    const seg = parts.find((m) => m.part === 'arch segment')!
    expect(seg.quantity).toBe(8)
    expect(seg.length).toBeCloseTo(2 * 18 * Math.sin(Math.PI / 16), 9)
    expect(seg.miterDegA).toBeCloseTo(11.25, 9)
    expect(parts.find((m) => m.part === 'jamb')!.length).toBeCloseTo(62, 9)
  })
  it('circle: 16 rim segments', () => {
    const parts = outlineBuckMembers('circle', 24, 24, true)
    expect(parts).toHaveLength(1)
    expect(parts[0].quantity).toBe(16)
    expect(parts[0].length).toBeCloseTo(24 * Math.sin(Math.PI / 16), 9)
  })
  it('triangle miters are half interior angles', () => {
    const parts = outlineBuckMembers('triangle', 30, 40, true)
    const theta = Math.atan2(40, 15)
    const base = parts.find((m) => m.part === 'base')!
    const rake = parts.find((m) => m.part === 'rake')!
    expect(base.miterDegA).toBeCloseTo((theta * 90) / Math.PI, 6) // θ/2 in degrees
    expect(rake.miterDegB).toBeCloseTo(((Math.PI - 2 * theta) * 90) / Math.PI, 6)
    expect(rake.length).toBeCloseTo(Math.hypot(15, 40), 9)
  })
})

describe('helpers', () => {
  it('effectiveHeight: circle = width', () => {
    expect(effectiveHeight('circle', 24, 99)).toBe(24)
    expect(effectiveHeight('arch', 36, 80)).toBe(80)
  })
  it('archTooFlat only for arch with h < w/2', () => {
    expect(archTooFlat('arch', 36, 17)).toBe(true)
    expect(archTooFlat('arch', 36, 18)).toBe(false)
    expect(archTooFlat('rect', 36, 1)).toBe(false)
  })
  it('openingArea per shape', () => {
    expect(openingArea('rect', 36, 80)).toBe(2880)
    expect(openingArea('circle', 24, 0)).toBeCloseTo(Math.PI * 144, 9)
    expect(openingArea('arch', 36, 80)).toBeCloseTo(36 * 62 + (Math.PI * 324) / 2, 9)
    expect(openingArea('triangle', 30, 40)).toBe(600)
  })
})
