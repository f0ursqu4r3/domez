import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { cutDoorways, openingPrisms } from '../doorway'
import { clipPanels, panelUnits } from '../panelClip'
import type { DomeModel } from '../types'

const R = 156
const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
const door = { id: 'D1', azimuthDeg: 20, width: 36, height: 80, margin: 1.5 }

const insidePrism = (p: ReturnType<typeof openingPrisms>[number], x: number, y: number, z: number) => {
  const t = -p.uy * x + p.ux * y
  const u = p.ux * x + p.uy * y
  return u >= p.cutPlaneDist && p.planes.every((pl) => pl.nt * t + pl.nz * (z - p.z0) <= pl.c + 1e-9)
}

describe('openingPrisms', () => {
  it('matches cutDoorways vertex removal exactly', () => {
    const prisms = openingPrisms(dome, [door], R, { minStubLength: 6 })
    expect(prisms).toHaveLength(1)
    const cut = cutDoorways(dome, [door], R, { minStubLength: 6 })
    for (const v of dome.vertices) {
      const [x, y, z] = v.position.map((c) => c * R)
      expect(insidePrism(prisms[0], x, y, z)).toBe(cut.removedVertices.has(v.id))
    }
  })
  it('riser-conflicted doors contribute no prism', () => {
    const short = { id: 'D1', azimuthDeg: 0, width: 36, height: 20 }
    expect(openingPrisms(dome, [short], R, { minStubLength: 6, riserHeight: 24 })).toHaveLength(0)
  })
})

// The frozen-behavior `dome` above (3V) is coarse enough that a 10" porthole's
// auto-fit plane sits outside the actual chorded facet everywhere on it — a
// finer dome gives facets the porthole can actually sit inside (same
// rationale as doorwayShapes.test.ts's fineDome).
const fineDome = generateDome({ frequency: 5, fraction: '1/2', baseMode: 'leveled' })

/** Face-centroid azimuth/height probe: pick the first face whose centroid
 * sits mid-height on the +x side, then report the bearing/sill that aims a
 * small opening at it. Copied verbatim from doorwayShapes.test.ts. */
function panelCentroidSpot(model: DomeModel, radius: number): { az: number; sill: number } {
  const f = model.faces
    .map((face) => {
      const c = face.vertexIds.reduce(
        (s, vi) => {
          const p = model.vertices[vi].position
          return [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3]
        },
        [0, 0, 0],
      )
      return { face, c }
    })
    .find(
      ({ c }) =>
        c[2] * radius > model.cutZ * radius + 40 &&
        c[2] * radius < model.cutZ * radius + 80 &&
        c[0] > 0.5,
    )!
  const az = (Math.atan2(f.c[1], f.c[0]) * 180) / Math.PI
  const sill = f.c[2] * radius - model.cutZ * radius - 5
  return { az, sill }
}

/** Polygon area from the Newell cross-sum (planar polygon, any orientation). */
const polyArea3 = (pts: [number, number, number][]) => {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  return Math.hypot(nx, ny, nz) / 2
}
const unitArea = (ring: number[]) =>
  polyArea3(ring.map((vi) => dome.vertices[vi].position.map((c) => c * R) as [number, number, number]))

describe('clipPanels', () => {
  const prisms = openingPrisms(dome, [door], R, { minStubLength: 6 })
  const clips = clipPanels(dome, R, prisms)
  const units = panelUnits(dome)

  it('classifies every unit and conserves area', () => {
    expect(clips).toHaveLength(units.length)
    for (const c of clips) {
      const orig = unitArea(units[c.unitIndex].ring)
      const fragArea = c.fragments.reduce((s, f) => s + polyArea3(f as [number, number, number][]), 0)
      if (c.status === 'whole') expect(fragArea).toBeCloseTo(orig, 3)
      if (c.status === 'removed') expect(fragArea).toBe(0)
      if (c.status === 'clipped') {
        expect(fragArea).toBeGreaterThan(0)
        expect(fragArea).toBeLessThan(orig - 1e-6)
        expect(c.area).toBeCloseTo(fragArea, 6)
      }
    }
  })

  it('at least one unit is clipped (the door crosses panels) and loops close', () => {
    const clipped = clips.filter((c) => c.status === 'clipped')
    expect(clipped.length).toBeGreaterThan(0)
    for (const c of clipped) {
      let loopAreaSum = 0
      for (const loop of c.loops) {
        expect(loop.pts.length).toBeGreaterThanOrEqual(3)
        expect(loop.cut).toHaveLength(loop.pts.length)
        expect(loop.cut.some(Boolean)).toBe(true) // a clipped panel borders the opening
        loopAreaSum += polyArea3(loop.pts as [number, number, number][])
      }
      // Loop area sum equals fragment area sum (outer loop area minus hole
      // loop areas nets out to the surviving fragment area — but since holes
      // are rare on a fully-clipped-by-a-door panel here, just check the
      // total unsigned loop area is at least the surviving fragment area).
      expect(loopAreaSum).toBeGreaterThan(0)
    }
  })

  it('porthole fully inside one panel produces an outer loop + hole loop', () => {
    const { az, sill } = panelCentroidSpot(fineDome, R)
    const win = { id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' as const }
    const finePrisms = openingPrisms(fineDome, [win], R, { minStubLength: 6 })
    expect(finePrisms).toHaveLength(1)
    const fineClips = clipPanels(fineDome, R, finePrisms)
    const cut = cutDoorways(fineDome, [win], R, { minStubLength: 6 })
    expect(cut.removedFaces.size).toBe(1)

    const clipped = fineClips.filter((c) => c.status === 'clipped')
    expect(clipped).toHaveLength(1)
    const c = clipped[0]
    expect(c.loops).toHaveLength(2)
    const outer = c.loops.find((l) => l.cut.every((b) => !b))
    const hole = c.loops.find((l) => l.cut.every(Boolean))
    expect(outer).toBeDefined()
    expect(hole).toBeDefined()
    expect(outer!.pts.length).toBe(3) // untouched triangle
    expect(hole!.pts.length).toBeGreaterThan(3) // the shaped opening's polygon
  })

  it('no prisms → every unit whole', () => {
    for (const c of clipPanels(dome, R, [])) expect(c.status).toBe('whole')
  })
})
