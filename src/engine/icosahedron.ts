import type { Icosphere, Vec3 } from './types'
import { cross, dot, sub, add } from './vec'

/**
 * Canonical unit icosahedron in vertex-up ("point up") orientation:
 *   v0            north pole (0, 0, 1)
 *   v1..v5        upper pentagon ring, z = 1/sqrt(5), azimuths 0, 72, ...
 *   v6..v10       lower pentagon ring, z = -1/sqrt(5), azimuths 36, 108, ...
 *   v11           south pole (0, 0, -1)
 *
 * Vertex-up orientation is what dome truncation assumes: vertices fall on
 * planar horizontal rings, so any cut along a ring yields a flat base.
 */
export function icosahedron(): Icosphere {
  const z = 1 / Math.sqrt(5)
  const r = 2 / Math.sqrt(5)
  const vertices: Vec3[] = [[0, 0, 1]]
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5
    vertices.push([r * Math.cos(a), r * Math.sin(a), z])
  }
  for (let i = 0; i < 5; i++) {
    const a = ((i * 2 + 1) * Math.PI) / 5
    vertices.push([r * Math.cos(a), r * Math.sin(a), -z])
  }
  vertices.push([0, 0, -1])

  const faces: [number, number, number][] = []
  for (let i = 0; i < 5; i++) {
    const u = 1 + i
    const un = 1 + ((i + 1) % 5)
    const l = 6 + i
    const ln = 6 + ((i + 1) % 5)
    faces.push([0, u, un]) // top cap
    faces.push([u, l, un]) // band, apex up
    faces.push([un, l, ln]) // band, apex down
    faces.push([11, ln, l]) // bottom cap
  }

  // Enforce outward winding (CCW seen from outside): normal . centroid > 0.
  for (const f of faces) {
    const [a, b, c] = f.map((i) => vertices[i])
    const n = cross(sub(b, a), sub(c, a))
    const centroid = add(add(a, b), c)
    if (dot(n, centroid) < 0) {
      const t = f[1]
      f[1] = f[2]
      f[2] = t
    }
  }
  return { vertices, faces }
}
