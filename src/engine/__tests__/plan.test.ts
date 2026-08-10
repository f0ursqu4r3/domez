import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { generateZome } from '../zome'
import { cutDoorways, emptyDoorwayCut } from '../doorway'
import { orderedBaseRing } from '../riser'
import { headroomRing, planSvg, ringRadiusAt } from '../exports/plan'

describe('floor plan', () => {
  const NO_DOOR = emptyDoorwayCut()
  const OPTS = { units: 'imperial' as const, radius: 156, riserHeight: 0, wallThickness: 3.5, title: 'Test' }

  it('draws the footprint and monotonic headroom rings', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const svg = planSvg(m, NO_DOOR, OPTS)
    expect(svg).toContain('data-plan-footprint')
    const r72 = headroomRing(m, 156, 0, 72)
    const r48 = headroomRing(m, 156, 0, 48)
    expect(r72.kind).toBe('ring')
    expect(r48.kind).toBe('ring')
    if (r72.kind === 'ring' && r48.kind === 'ring') {
      const zStar = m.cutZ * 156 + 72
      expect(r72.radius).toBeCloseTo(Math.sqrt(156 ** 2 - zStar ** 2), 6)
      expect(r48.radius).toBeGreaterThan(r72.radius)
    }
    expect((svg.match(/data-headroom-ring/g) ?? []).length).toBe(2)
  })

  it('riser shifts rings outward; h ≤ riser means everywhere', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const base = headroomRing(m, 156, 0, 72)
    const raised = headroomRing(m, 156, 24, 72)
    if (base.kind === 'ring' && raised.kind === 'ring') {
      expect(raised.radius).toBeGreaterThan(base.radius)
    } else {
      throw new Error('expected rings')
    }
    expect(headroomRing(m, 156, 24, 20)).toEqual({ kind: 'everywhere' })
  })

  it('marks doors and windows distinctly', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const door = { id: 'D1', azimuthDeg: 0, width: 36, height: 80 }
    const win = { id: 'W1', azimuthDeg: 90, width: 36, height: 36, sillHeight: 40 }
    const cut = cutDoorways(m, [door, win], OPTS.radius, { minStubLength: 6, studSpacing: 16 })
    expect(cut.doors[0].fits).toBe(true)
    expect(cut.doors[1].fits).toBe(true)
    const svg = planSvg(m, cut, OPTS)
    expect((svg.match(/data-door-gap/g) ?? []).length).toBe(1)
    expect((svg.match(/data-window-tick/g) ?? []).length).toBe(1)
    expect(svg).toContain('sill')
  })

  it('zome rings interpolate within the profile; tiny domes report nowhere', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
    const ring = headroomRing(z, 100, 0, 48)
    // 48″ on a 100″-radius zome: must be a ring strictly inside the base radius.
    expect(ring.kind).toBe('ring')
    if (ring.kind === 'ring') {
      expect(ring.radius).toBeGreaterThan(0)
      expect(ring.radius).toBeLessThan(100 * z.unitBaseRadius + 1e-6)
    }
    const tiny = generateDome({ frequency: 2, fraction: '3/8', baseMode: 'natural' })
    expect(headroomRing(tiny, 40, 0, 72).kind).toBe('nowhere')
    const svgTiny = planSvg(tiny, NO_DOOR, { ...OPTS, radius: 40 })
    expect(svgTiny).toContain('nowhere')
  })

  it('natural zigzag rims produce a full footprint polygon', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    const svg = planSvg(m, NO_DOOR, OPTS)
    const ring = orderedBaseRing(m)
    expect(ring.length).toBeGreaterThan(0)
    expect(svg).toContain('data-plan-footprint')
  })

  it('ringRadiusAt stays within the base ring at any azimuth (C1)', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const R = 156
    const ringIds = orderedBaseRing(m)
    const outerPts: [number, number][] = ringIds.map((vi) => {
      const p = m.vertices[vi].position
      return [p[0] * R, p[1] * R]
    })
    const n = outerPts.length
    const vertexRadii = outerPts.map(([x, y]) => Math.hypot(x, y))
    // Upper bound: for a straight edge, distance-from-origin is convex along
    // the segment, so its max on the segment is at an endpoint — the global
    // max is therefore bounded by the farthest vertex.
    const max = Math.max(...vertexRadii)
    // Lower bound: the closest approach of the origin to each edge segment
    // (clamped to the segment) — ringRadiusAt can never return less than the
    // nearest such approach across all edges.
    let min = Math.min(...vertexRadii)
    for (let i = 0; i < n; i++) {
      const [x0, y0] = outerPts[i]
      const [x1, y1] = outerPts[(i + 1) % n]
      const ex = x1 - x0
      const ey = y1 - y0
      const len2 = ex * ex + ey * ey
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(x0 * ex + y0 * ey) / len2)) : 0
      min = Math.min(min, Math.hypot(x0 + t * ex, y0 + t * ey))
    }
    for (const az of [0, 5, 12, 90]) {
      const r = ringRadiusAt(az, outerPts)
      expect(r).toBeGreaterThanOrEqual(min - 1e-6)
      expect(r).toBeLessThanOrEqual(max + 1e-6)
    }
  })

  it('headroom ring clamps to the footprint instead of poking past it (I1)', () => {
    const m = generateDome({ frequency: 3, fraction: '5/8', baseMode: 'leveled' })
    const R = 156
    expect(headroomRing(m, R, 0, 48)).toEqual({ kind: 'everywhere' })
    const outcome72 = headroomRing(m, R, 0, 72)
    if (outcome72.kind === 'ring') {
      expect(outcome72.radius).toBeLessThan(m.unitBaseRadius * R)
    }
  })

  it('dimension extension ticks have real length, never a zero-length line (I2)', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const svg = planSvg(m, NO_DOOR, OPTS)
    const dimGroupMatch = svg.match(/<g data-dim="1">([\s\S]*?)<\/g>/)
    expect(dimGroupMatch).not.toBeNull()
    const group = dimGroupMatch![1]
    const lineRe = /<line[^>]*x1="([-\d.]+)"[^>]*y1="([-\d.]+)"[^>]*x2="([-\d.]+)"[^>]*y2="([-\d.]+)"/g
    const lines = [...group.matchAll(lineRe)]
    expect(lines.length).toBeGreaterThan(0)
    for (const [, x1, y1, x2, y2] of lines) {
      expect(x1 === x2 && y1 === y2).toBe(false)
    }
  })
})
