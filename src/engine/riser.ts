import type { DomeModel } from './types'
import type { DoorSpec } from './doorway'

/** A stick in the riser (knee) wall under the dome's base ring. */
export interface RiserMember {
  part:
    | 'riser top plate'
    | 'riser bottom plate'
    | 'riser stud'
    | 'riser king stud'
    | 'riser trimmer'
  /** Cut length, working units. */
  length: number
  quantity: number
  /** World endpoints, engine frame (z up), working units. */
  a: [number, number, number]
  b: [number, number, number]
}

/** One flat wall panel per base-ring edge. */
export interface RiserSegment {
  /** Top corners on the base plane (world, working units). a→b is CCW around the ring. */
  a: [number, number, number]
  b: [number, number, number]
  length: number
  /** Door-opening intervals as distances along a→b. */
  openings: [number, number][]
}

export interface RiserModel {
  height: number
  perimeter: number
  segments: RiserSegment[]
  members: RiserMember[]
  jointNodes: [number, number, number][]
  jointCount: number
  /** One rect per segment (full gross rect even when a door cuts it out —
   * the opening is cut from the sheet, the sheet is still consumed). */
  sheathingRects: { w: number; h: number }[]
  grossSheathingArea: number
  openingArea: number
  netSheathingArea: number
}

export interface RiserOptions {
  /** Wall height, working units. ≤ 0 disables. */
  height: number
  /** Stud spacing o.c. (16″ / 400 mm). */
  studSpacing: number
  /** Member width for king-stud offsets, working units. */
  memberWidth: number
  /** Plate pieces / stud bays shorter than this are dropped as scrap. */
  minStubLength: number
  /** Doors that cut through the wall (windows never do). Working units. */
  doors?: DoorSpec[]
}

/** Base-ring vertex ids in CCW order viewed from +z. Empty for full spheres. */
export function orderedBaseRing(model: DomeModel): number[] {
  const nbrs = new Map<number, number[]>()
  for (const e of model.edges) {
    if (e.faceIds.length !== 1) continue
    if (!nbrs.has(e.v0)) nbrs.set(e.v0, [])
    if (!nbrs.has(e.v1)) nbrs.set(e.v1, [])
    nbrs.get(e.v0)!.push(e.v1)
    nbrs.get(e.v1)!.push(e.v0)
  }
  if (nbrs.size === 0) return []
  const start = Math.min(...nbrs.keys())
  const ring = [start]
  let prev = -1
  let cur = start
  for (;;) {
    const n = nbrs.get(cur)!
    const nxt = n[0] === prev ? n[1] : n[0]
    if (nxt === undefined || nxt === start) break
    ring.push(nxt)
    prev = cur
    cur = nxt
  }
  let area2 = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = model.vertices[ring[i]].position
    const [x1, y1] = model.vertices[ring[(i + 1) % ring.length]].position
    area2 += x0 * y1 - x1 * y0
  }
  if (area2 < 0) ring.reverse()
  return ring
}

/**
 * Build a stud-framed riser wall under the base ring: one rectangular wall
 * segment per ring edge, from the base plane down to the foundation. Doors
 * (never windows) cut rough openings through it — plates interrupt, field
 * studs clear out, and king/trimmer studs frame each side.
 *
 * Returns null when disabled (height ≤ 0), the dome has no base ring, or
 * the ring is not planar (a riser needs the leveled base).
 */
export function buildRiser(
  model: DomeModel,
  radius: number,
  opts: RiserOptions,
): RiserModel | null {
  if (opts.height <= 0) return null
  const ring = orderedBaseRing(model)
  if (ring.length < 3) return null
  const zTop = model.cutZ * radius
  for (const vi of ring) {
    if (Math.abs(model.vertices[vi].position[2] * radius - zTop) > 1e-6 * radius) return null
  }
  const h = opts.height
  const zBot = zTop - h
  const doors = (opts.doors ?? []).filter((d) => !((d.sillHeight ?? 0) > 0))

  /** Intervals of a segment inside a door's rough-opening strip
   * (|tangential| ≤ width/2 on the door's near side). Merged, sorted. */
  const openingIntervals = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    L: number,
  ): [number, number][] => {
    const raw: [number, number][] = []
    for (const d of doors) {
      const az = (d.azimuthDeg * Math.PI) / 180
      const ux = Math.cos(az)
      const uy = Math.sin(az)
      let s0 = 0
      let s1 = 1
      const clip = (fa: number, fb: number, lo: number, hi: number): boolean => {
        const df = fb - fa
        if (Math.abs(df) < 1e-12) return fa >= lo && fa <= hi
        let t0 = (lo - fa) / df
        let t1 = (hi - fa) / df
        if (t0 > t1) [t0, t1] = [t1, t0]
        s0 = Math.max(s0, t0)
        s1 = Math.min(s1, t1)
        return s1 > s0
      }
      const tA = -uy * ax + ux * ay
      const tB = -uy * bx + ux * by
      const uA = ux * ax + uy * ay
      const uB = ux * bx + uy * by
      if (!clip(tA, tB, -d.width / 2, d.width / 2)) continue
      if (!clip(uA, uB, 0, 1e12)) continue
      if (s1 - s0 > 1e-9) raw.push([s0 * L, s1 * L])
    }
    raw.sort((x, y) => x[0] - y[0])
    const merged: [number, number][] = []
    for (const iv of raw) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1])
      else merged.push([...iv] as [number, number])
    }
    return merged
  }

  const members: RiserMember[] = []
  const segments: RiserSegment[] = []
  const sheathingRects: { w: number; h: number }[] = []
  let perimeter = 0
  let openingArea = 0

  // Corner studs: one per hub, shared by both adjacent segments.
  for (const vi of ring) {
    const x = model.vertices[vi].position[0] * radius
    const y = model.vertices[vi].position[1] * radius
    members.push({ part: 'riser stud', length: h, quantity: 1, a: [x, y, zBot], b: [x, y, zTop] })
  }

  for (let i = 0; i < ring.length; i++) {
    const p0 = model.vertices[ring[i]].position
    const p1 = model.vertices[ring[(i + 1) % ring.length]].position
    const ax = p0[0] * radius
    const ay = p0[1] * radius
    const bx = p1[0] * radius
    const by = p1[1] * radius
    const L = Math.hypot(bx - ax, by - ay)
    const dx = (bx - ax) / L
    const dy = (by - ay) / L
    perimeter += L
    const at = (d: number): [number, number] => [ax + dx * d, ay + dy * d]

    const openings = openingIntervals(ax, ay, bx, by, L)
    segments.push({ a: [ax, ay, zTop], b: [bx, by, zTop], length: L, openings })
    sheathingRects.push({ w: L, h })
    for (const [d0, d1] of openings) openingArea += (d1 - d0) * h

    // Plates: full span minus openings, both planes. The top plate interrupts
    // too — the doorway is taller than the wall, so a continuous top plate
    // would cross it; the door buck carries continuity.
    const kept: [number, number][] = []
    let cursor = 0
    for (const [d0, d1] of openings) {
      if (d0 > cursor + 1e-9) kept.push([cursor, d0])
      cursor = Math.max(cursor, d1)
    }
    if (cursor < L - 1e-9) kept.push([cursor, L])
    for (const [d0, d1] of kept) {
      if (d1 - d0 < opts.minStubLength) continue
      const [x0, y0] = at(d0)
      const [x1, y1] = at(d1)
      members.push({
        part: 'riser top plate',
        length: d1 - d0,
        quantity: 1,
        a: [x0, y0, zTop],
        b: [x1, y1, zTop],
      })
      members.push({
        part: 'riser bottom plate',
        length: d1 - d0,
        quantity: 1,
        a: [x0, y0, zBot],
        b: [x1, y1, zBot],
      })
    }

    // Field studs on centers, skipping opening zones (± memberWidth for the
    // trimmer) and the corner-stud neighborhood at the segment end.
    for (let d = opts.studSpacing; d <= L - opts.minStubLength; d += opts.studSpacing) {
      const inOpening = openings.some(
        ([d0, d1]) => d > d0 - opts.memberWidth && d < d1 + opts.memberWidth,
      )
      if (inOpening) continue
      const [x, y] = at(d)
      members.push({ part: 'riser stud', length: h, quantity: 1, a: [x, y, zBot], b: [x, y, zTop] })
    }

    // King + trimmer studs framing each opening edge that lands on this
    // segment (edges at the very corner defer to the corner stud).
    for (const [d0, d1] of openings) {
      for (const [dEdge, dir] of [
        [d0, -1],
        [d1, 1],
      ] as const) {
        if (dEdge < opts.minStubLength || dEdge > L - opts.minStubLength) continue
        const [tx, ty] = at(dEdge)
        members.push({
          part: 'riser trimmer',
          length: h,
          quantity: 1,
          a: [tx, ty, zBot],
          b: [tx, ty, zTop],
        })
        const [kx, ky] = at(dEdge + dir * opts.memberWidth)
        members.push({
          part: 'riser king stud',
          length: h,
          quantity: 1,
          a: [kx, ky, zBot],
          b: [kx, ky, zTop],
        })
      }
    }
  }

  // Joints: deduped member endpoints (0.5-working-unit grid, as closures use).
  const seen = new Set<string>()
  const jointNodes: [number, number, number][] = []
  for (const m of members) {
    for (const p of [m.a, m.b]) {
      const key = `${Math.round(p[0] * 2)}:${Math.round(p[1] * 2)}:${Math.round(p[2] * 2)}`
      if (seen.has(key)) continue
      seen.add(key)
      jointNodes.push(p)
    }
  }

  const gross = perimeter * h
  return {
    height: h,
    perimeter,
    segments,
    members,
    jointNodes,
    jointCount: jointNodes.length,
    sheathingRects,
    grossSheathingArea: gross,
    openingArea,
    netSheathingArea: gross - openingArea,
  }
}
