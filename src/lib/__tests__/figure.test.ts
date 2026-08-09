import { describe, expect, it } from 'vitest'
import { figureOutline } from '../figure'

// Proper segment intersection (excluding shared endpoints).
function segsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

describe('scale figure outline', () => {
  it('is a simple polygon spanning feet 0 to neck 0.855', () => {
    const pts = figureOutline()
    const n = pts.length
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue // closing edge adjacency
        expect(
          segsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]),
          `edge ${i} crosses edge ${j}`,
        ).toBe(false)
      }
    }
    const ys = pts.map(([, y]) => y)
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBeCloseTo(0.855, 6)
  })
})
