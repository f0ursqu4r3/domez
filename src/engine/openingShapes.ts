/**
 * Pure geometry for doorway/window opening shapes: outlines, convex offset,
 * and buck (rough-frame) cut lists. Door-local coordinates throughout:
 * `t` tangential (right +), `hRel` height above the base plane. `b` is the
 * opening's buck-bottom height above the base plane (`buckBottomRel`).
 */

export type OpeningShapeKind = 'rect' | 'arch' | 'circle' | 'triangle'

/** One distinct buck (rough-frame) member cut. */
export interface BuckMember {
  part: string // 'jamb' | 'header' | 'sill' | 'arch segment' | 'rim segment' | 'rake' | 'base'
  length: number
  /** Miter per end from square, degrees; 0 = square cut. */
  miterDegA: number
  miterDegB: number
  quantity: number
}

/** Arch curve is faceted into this many equal segments (spring to spring). */
export const ARCH_SEGMENTS = 8
/** Circle is faceted into this many equal segments (full turn). */
export const CIRCLE_SEGMENTS = 16

const deg = (rad: number) => (rad * 180) / Math.PI

/** Circle ignores height (= width); every other shape passes height through. */
export function effectiveHeight(shape: OpeningShapeKind, width: number, height: number): number {
  return shape === 'circle' ? width : height
}

/** True when an arch cannot exist: height < width/2. */
export function archTooFlat(shape: OpeningShapeKind, width: number, height: number): boolean {
  return shape === 'arch' && height < width / 2
}

/** Door slab area of the true shape (rect w·h, circle πr², arch w·j + πr²/2, triangle w·h/2). */
export function openingArea(shape: OpeningShapeKind, width: number, height: number): number {
  switch (shape) {
    case 'rect':
      return width * height
    case 'circle': {
      const r = width / 2
      return Math.PI * r * r
    }
    case 'arch': {
      const r = width / 2
      const j = height - r
      return width * j + (Math.PI * r * r) / 2
    }
    case 'triangle':
      return (width * height) / 2
  }
}

/** Convex CCW polygon in door-local (t, hRel-above-base). b = buckBottomRel. */
export function openingOutline(
  shape: OpeningShapeKind, width: number, height: number, b: number,
): [number, number][] {
  const halfW = width / 2
  switch (shape) {
    case 'rect':
      return [
        [-halfW, b],
        [halfW, b],
        [halfW, b + height],
        [-halfW, b + height],
      ]
    case 'triangle':
      return [
        [-halfW, b],
        [halfW, b],
        [0, b + height],
      ]
    case 'circle': {
      const r = halfW
      const cy = b + r
      const step = (2 * Math.PI) / CIRCLE_SEGMENTS
      const pts: [number, number][] = []
      for (let k = 0; k < CIRCLE_SEGMENTS; k++) {
        const theta = -Math.PI / 2 + (k + 0.5) * step
        pts.push([r * Math.cos(theta), cy + r * Math.sin(theta)])
      }
      return pts
    }
    case 'arch': {
      const r = halfW
      const j = height - r
      const pts: [number, number][] = [
        [-halfW, b],
        [halfW, b],
      ]
      if (j >= 1e-9) pts.push([halfW, b + j])
      for (let k = 1; k < ARCH_SEGMENTS; k++) {
        const ang = (k * Math.PI) / ARCH_SEGMENTS
        pts.push([r * Math.cos(ang), b + j + r * Math.sin(ang)])
      }
      if (j >= 1e-9) pts.push([-halfW, b + j])
      return pts
    }
  }
}

/** Offset each edge outward by `margin` (bottom-most horizontal edge by
 * `bottomMargin` instead), re-intersect neighbors. margin 0 → identity. */
export function offsetConvexOutward(
  poly: [number, number][], margin: number, bottomMargin: number,
): [number, number][] {
  const n = poly.length
  const normals: [number, number][] = []
  let bottomIdx = -1
  let bottomH = Infinity
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = dy / len
    const ny = -dx / len
    normals.push([nx, ny])
    if (ny < -0.99) {
      const midH = (a[1] + b[1]) / 2
      if (midH < bottomH) {
        bottomH = midH
        bottomIdx = i
      }
    }
  }
  // Offset line i: n_i·X = n_i·P_i + m_i.
  const lineC: number[] = []
  for (let i = 0; i < n; i++) {
    const [nx, ny] = normals[i]
    const m = i === bottomIdx ? bottomMargin : margin
    const a = poly[i]
    lineC.push(nx * a[0] + ny * a[1] + m)
  }
  // New vertex k = intersection of offset lines k−1 and k.
  const result: [number, number][] = []
  for (let k = 0; k < n; k++) {
    const prev = (k - 1 + n) % n
    const [n1x, n1y] = normals[prev]
    const c1 = lineC[prev]
    const [n2x, n2y] = normals[k]
    const c2 = lineC[k]
    const det = n1x * n2y - n2x * n1y
    const x = (c1 * n2y - c2 * n1y) / det
    const y = (n1x * c2 - n2x * c1) / det
    // Normalize -0 → 0 so exact-equality checks on axis-aligned edges hold.
    result.push([x || 0, y || 0])
  }
  return result
}

/** Rough-buck cut list for the opening shape. `isWindow` adds a sill (rect
 * only — other shapes are self-closing curves with no separate sill). */
export function outlineBuckMembers(
  shape: OpeningShapeKind, width: number, height: number, isWindow: boolean,
): BuckMember[] {
  switch (shape) {
    case 'rect': {
      const members: BuckMember[] = [
        { part: 'jamb', length: height, miterDegA: 0, miterDegB: 0, quantity: 2 },
        { part: 'header', length: width, miterDegA: 0, miterDegB: 0, quantity: 1 },
      ]
      if (isWindow) {
        members.push({ part: 'sill', length: width, miterDegA: 0, miterDegB: 0, quantity: 1 })
      }
      return members
    }
    case 'arch': {
      const r = width / 2
      const j = height - r
      const members: BuckMember[] = []
      if (j > 1e-9) {
        members.push({ part: 'jamb', length: j, miterDegA: 0, miterDegB: 0, quantity: 2 })
      }
      const segLen = 2 * r * Math.sin(Math.PI / (2 * ARCH_SEGMENTS))
      members.push({
        part: 'arch segment',
        length: segLen,
        miterDegA: 90 / ARCH_SEGMENTS,
        miterDegB: 90 / ARCH_SEGMENTS,
        quantity: ARCH_SEGMENTS,
      })
      return members
    }
    case 'circle': {
      const segLen = width * Math.sin(Math.PI / CIRCLE_SEGMENTS)
      return [
        {
          part: 'rim segment',
          length: segLen,
          miterDegA: 180 / CIRCLE_SEGMENTS,
          miterDegB: 180 / CIRCLE_SEGMENTS,
          quantity: CIRCLE_SEGMENTS,
        },
      ]
    }
    case 'triangle': {
      const theta = Math.atan2(height, width / 2)
      const phi = Math.PI - 2 * theta
      const thetaDeg = deg(theta)
      const phiDeg = deg(phi)
      const rakeLen = Math.hypot(width / 2, height)
      return [
        { part: 'base', length: width, miterDegA: thetaDeg / 2, miterDegB: thetaDeg / 2, quantity: 1 },
        { part: 'rake', length: rakeLen, miterDegA: thetaDeg / 2, miterDegB: phiDeg / 2, quantity: 2 },
      ]
    }
  }
}
