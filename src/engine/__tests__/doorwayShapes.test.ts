import { describe, expect, it } from 'vitest'
import { generateDome } from '../dome'
import { cutDoorways } from '../doorway'

const R = 156
const dome = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
const door = { id: 'D1', azimuthDeg: 20, width: 36, height: 80, margin: 1.5 }
const win = { id: 'W1', azimuthDeg: 120, width: 24, height: 36, sillHeight: 36, margin: 1.5 }

describe('rect characterization (frozen behavior)', () => {
  const CASES = [
    { riser: 0, removedEdges: 1, trimmedEdges: 12, trimmedPieces: 12, removedFaces: 12,
      removedVertices: 2, trimLenSum: 463.966, d: { framePlaneDist: 112.2985, sideArea: 3417.081,
      topArea: 240.9, faceArea: 298.5, framing: 14, joints: 27, hubs: 1 },
      w: { framePlaneDist: 120.1472, sideArea: 701.148, topArea: 162.942, botArea: 522.612,
      framing: 13, joints: 23, hubs: 1 } },
    { riser: 24, removedEdges: 1, trimmedEdges: 8, trimmedPieces: 10, removedFaces: 7,
      removedVertices: 1, trimLenSum: 361.8666, d: { framePlaneDist: 130.9969, sideArea: 1061.549,
      topArea: 110.141, faceArea: 226.5, framing: 7, joints: 15, hubs: 1 },
      w: { framePlaneDist: 136.384, sideArea: 347.892, topArea: 67.442, botArea: 287.237,
      framing: 8, joints: 16, hubs: 0 } },
  ]
  for (const c of CASES) {
    it(`riser ${c.riser}: counts, areas and trim lengths are unchanged`, () => {
      const cut = cutDoorways(dome, [door, win], R, {
        minStubLength: 6, studSpacing: 16, riserHeight: c.riser,
      })
      const [d, w] = cut.doors
      expect(cut.removedEdges.size).toBe(c.removedEdges)
      expect(cut.trimmedEdges.size).toBe(c.trimmedEdges)
      expect(cut.trimmed.length).toBe(c.trimmedPieces)
      expect(cut.removedFaces.size).toBe(c.removedFaces)
      expect(cut.removedVertices.size).toBe(c.removedVertices)
      expect(cut.trimmed.reduce((s, t) => s + t.length, 0)).toBeCloseTo(c.trimLenSum, 3)
      expect(d.fits && w.fits).toBe(true)
      expect(d.framePlaneDist).toBeCloseTo(c.d.framePlaneDist, 3)
      expect(d.closureSideArea).toBeCloseTo(c.d.sideArea, 2)
      expect(d.closureTopArea).toBeCloseTo(c.d.topArea, 2)
      expect(d.closureFaceArea).toBeCloseTo(c.d.faceArea, 2)
      expect(d.closureFraming.length).toBe(c.d.framing)
      expect(d.closureJointCount).toBe(c.d.joints)
      expect(d.removedHubCount).toBe(c.d.hubs)
      expect(w.framePlaneDist).toBeCloseTo(c.w.framePlaneDist, 3)
      expect(w.closureSideArea).toBeCloseTo(c.w.sideArea, 2)
      expect(w.closureTopArea).toBeCloseTo(c.w.topArea, 2)
      expect(w.closureBottomArea).toBeCloseTo(c.w.botArea, 2)
      expect(w.closureFraming.length).toBe(c.w.framing)
      expect(w.closureJointCount).toBe(c.w.joints)
      expect(w.removedHubCount).toBe(c.w.hubs)
    })
  }
})

describe('shaped cuts', () => {
  it('a circle window crossing struts trims/removes fewer than its bounding rect', () => {
    const circle = { id: 'W1', azimuthDeg: 15, width: 40, height: 40, sillHeight: 48, shape: 'circle' as const }
    const rect = { ...circle, shape: 'rect' as const }
    const cutC = cutDoorways(dome, [circle], R, { minStubLength: 6 })
    const cutR = cutDoorways(dome, [rect], R, { minStubLength: 6 })
    const touchedC = cutC.removedEdges.size + cutC.trimmedEdges.size
    const touchedR = cutR.removedEdges.size + cutR.trimmedEdges.size
    expect(touchedC).toBeGreaterThan(0)
    expect(touchedC).toBeLessThanOrEqual(touchedR)
    expect(cutC.doors[0].fits).toBe(true)
  })
  it('a small circle inside one panel cuts nothing and removes that panel', () => {
    // The frozen-behavior dome above (3V) is coarse enough that a 10"
    // porthole's auto-fit plane (sized to clear the IDEAL sphere at its
    // farthest corner) sits outside the actual chorded facet everywhere on
    // it — a property of that low frequency, not of this shape logic. A
    // finer dome gives facets the porthole can actually sit inside.
    const fineDome = generateDome({ frequency: 5, fraction: '1/2', baseMode: 'leveled' })
    // Face centroid azimuth/height probe: pick the first face whose centroid
    // sits mid-height on the +x side, then aim a small porthole at it.
    const f = fineDome.faces.map((face) => {
      const c = face.vertexIds.reduce(
        (s, vi) => {
          const p = fineDome.vertices[vi].position
          return [s[0] + p[0] / 3, s[1] + p[1] / 3, s[2] + p[2] / 3]
        }, [0, 0, 0])
      return { face, c }
    }).find(({ c }) => c[2] * R > fineDome.cutZ * R + 40 && c[2] * R < fineDome.cutZ * R + 80 && c[0] > 0.5)!
    const az = (Math.atan2(f.c[1], f.c[0]) * 180) / Math.PI
    const sill = f.c[2] * R - fineDome.cutZ * R - 5
    const cut = cutDoorways(fineDome, [{ id: 'W1', azimuthDeg: az, width: 10, height: 10, sillHeight: sill, shape: 'circle' }], R, { minStubLength: 6 })
    expect(cut.removedEdges.size + cut.trimmedEdges.size).toBe(0)
    expect(cut.removedFaces.size).toBe(1)
  })
  it('arch too flat refuses to fit', () => {
    const cut = cutDoorways(dome, [{ id: 'D1', azimuthDeg: 0, width: 36, height: 17, shape: 'arch' }], R, { minStubLength: 6 })
    expect(cut.doors[0].fits).toBe(false)
    expect(cut.removedEdges.size + cut.trimmedEdges.size + cut.trimmed.length).toBe(0)
  })
  it('generalized fit equals the legacy formula for rects', () => {
    const spec = { id: 'D1', azimuthDeg: 0, width: 36, height: 80 }
    const z0 = dome.cutZ * R
    const legacy = Math.sqrt(R * R - Math.max((z0 + 80) ** 2, z0 ** 2) - 18 * 18)
    const cut = cutDoorways(dome, [spec], R, { minStubLength: 6 })
    expect(cut.doors[0].framePlaneDist).toBeCloseTo(legacy, 9)
  })
})
