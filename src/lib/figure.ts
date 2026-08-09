// src/lib/figure.ts
import * as THREE from 'three'

/**
 * Right-side body outline (x, y) in normalized units — head is a separate
 * circle so the whole figure spans exactly y ∈ [0, 1]. Left side is the
 * mirror. Gingerbread contour: arms merged to the torso, feet forward.
 */
const RIGHT: [number, number][] = [
  [0.03, 0.855], // neck
  [0.15, 0.8], // shoulder
  [0.16, 0.58], // upper arm
  [0.135, 0.42], // hand
  [0.105, 0.42], // hand inner edge — tucks straight in, no re-entrant
  [0.1, 0.3], // thigh
  [0.08, 0.04], // ankle
  [0.12, 0.01], // toe
  [0.12, 0],
  [0.03, 0], // inner foot
  [0.035, 0.25], // inner leg
  [0, 0.4], // crotch (midline — not mirrored)
]

/** Flat billboard person silhouette; scale-figure group, feet at y=0. */
export function buildFigure(heightWorld: number): THREE.Group {
  const pts = [
    ...RIGHT,
    ...RIGHT.slice(0, -1)
      .reverse()
      .map(([x, y]) => [-x, y] as [number, number]),
  ]
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const material = new THREE.MeshBasicMaterial({ color: 0x64748b, side: THREE.DoubleSide })
  const body = new THREE.Mesh(new THREE.ShapeGeometry(shape), material)
  const head = new THREE.Mesh(new THREE.CircleGeometry(0.08, 24), material)
  head.position.y = 0.92 // crown lands exactly at y = 1
  const group = new THREE.Group()
  group.name = 'scale-figure'
  group.add(body, head)
  group.scale.setScalar(heightWorld)
  return group
}
