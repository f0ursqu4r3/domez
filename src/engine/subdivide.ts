import type { Icosphere, Vec3 } from './types'
import { icosahedron } from './icosahedron'
import { normalize, scale, add } from './vec'

/**
 * Class I ("alternate", Method 1) geodesic subdivision:
 * each icosahedron face is divided into frequency^2 planar triangles and the
 * grid vertices are projected onto the unit sphere. This reproduces the
 * published Domebook chord factors.
 *
 * Vertices shared between faces (corners and edge points) are deduplicated by
 * quantizing the *planar* (pre-projection) coordinates, which are bitwise
 * near-identical across faces because they are the same linear combinations
 * of the same corner vertices.
 */
export function subdivideIcosahedron(frequency: number): Icosphere {
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new Error(`frequency must be a positive integer, got ${frequency}`)
  }
  const ico = icosahedron()
  const vertices: Vec3[] = []
  const faces: [number, number, number][] = []
  const index = new Map<string, number>()

  const keyOf = (p: Vec3) =>
    `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)},${Math.round(p[2] * 1e7)}`

  const getVertex = (planar: Vec3): number => {
    const key = keyOf(planar)
    const existing = index.get(key)
    if (existing !== undefined) return existing
    const id = vertices.length
    vertices.push(normalize(planar))
    index.set(key, id)
    return id
  }

  for (const [ia, ib, ic] of ico.faces) {
    const A = ico.vertices[ia]
    const B = ico.vertices[ib]
    const C = ico.vertices[ic]
    // grid[i][j] with i + j <= frequency: point A + (B-A)(i/f) + (C-A)(j/f)
    const grid: number[][] = []
    for (let i = 0; i <= frequency; i++) {
      grid.push([])
      for (let j = 0; j <= frequency - i; j++) {
        const planar = add(
          scale(A, (frequency - i - j) / frequency),
          add(scale(B, i / frequency), scale(C, j / frequency)),
        )
        grid[i].push(getVertex(planar))
      }
    }
    for (let i = 0; i < frequency; i++) {
      for (let j = 0; j < frequency - i; j++) {
        faces.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]])
        if (j < frequency - i - 1) {
          faces.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
        }
      }
    }
  }
  return { vertices, faces }
}
