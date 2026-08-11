import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { cutDoorways, openingPrisms } from '../doorway'

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
