import type { DomeModel, Vec3 } from './types'

/**
 * Outward hub axis per vertex: the normalized sum of adjacent raw face
 * normals (area-weighted by the un-normalized cross products). Mode-agnostic
 * — works for geodesic domes (≈ the radial direction) and zomes (whose
 * vertices are not on a sphere). Falls back to the normalized position when
 * a vertex has no faces.
 */
export function hubAxes(model: DomeModel): Vec3[] {
  const sums = model.vertices.map(() => [0, 0, 0] as [number, number, number])
  for (const f of model.faces) {
    const [a, b, c] = f.vertexIds.map((vi) => model.vertices[vi].position)
    const n = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ]
    for (const vi of f.vertexIds) {
      sums[vi][0] += n[0]
      sums[vi][1] += n[1]
      sums[vi][2] += n[2]
    }
  }
  return model.vertices.map((v, i) => {
    let [x, y, z] = sums[i]
    let len = Math.hypot(x, y, z)
    if (len < 1e-12) {
      ;[x, y, z] = v.position
      len = Math.hypot(x, y, z) || 1
    }
    return [x / len, y / len, z / len] as const
  })
}
