import type { DomeModel } from './types'
import { hubAxes } from './hubs'
import { cross, dot, normalize, sub } from './vec'

/** Compound-cut spec for one strut end in a mitered (hubless) build. */
export interface MiterEnd {
  vertexId: number
  /** Cheek half-angle against the counterclockwise neighbor (around the
   * hub axis), degrees — the picture-frame rule: miter = half the corner. */
  leftSeamDeg: number
  /** Cheek half-angle against the clockwise neighbor, degrees. */
  rightSeamDeg: number
  /** Strut climb out of the hub's tangent plane, degrees. */
  tiltDeg: number
}

/**
 * Per-edge compound-cut angles for the mitered hubless joint: at each hub,
 * struts are sorted around the hub axis and each end is cut against its two
 * neighbors on the perpendicular-bisector (seam) planes. The angles depend
 * on the hub a strut lands in, not just its type — hence per end.
 */
export function miterCuts(model: DomeModel): [MiterEnd, MiterEnd][] {
  const axes = hubAxes(model)

  // Per-vertex fan of incident struts, sorted by angle around the axis.
  const fans = model.vertices.map((v) => {
    const a = axes[v.id]
    const ref: readonly [number, number, number] = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
    const e1 = normalize(cross(a, ref))
    const e2 = cross(a, e1)
    return v.edgeIds
      .map((eid) => {
        const e = model.edges[eid]
        const other = e.v0 === v.id ? e.v1 : e.v0
        const d = normalize(sub(model.vertices[other].position, v.position))
        return { eid, d, ang: Math.atan2(dot(d, e2), dot(d, e1)) }
      })
      .sort((x, y) => x.ang - y.ang)
  })

  const seam = (di: readonly number[], dj: readonly number[]) =>
    (Math.acos(
      Math.max(-1, Math.min(1, di[0] * dj[0] + di[1] * dj[1] + di[2] * dj[2])),
    ) *
      180) /
    Math.PI /
    2

  const endFor = (vid: number, eid: number): MiterEnd => {
    const fan = fans[vid]
    const k = fan.findIndex((f) => f.eid === eid)
    const d = fan[k].d
    const n = fan.length
    const a = axes[vid]
    return {
      vertexId: vid,
      leftSeamDeg: n > 1 ? seam(d, fan[(k + 1) % n].d) : 0,
      rightSeamDeg: n > 1 ? seam(d, fan[(k - 1 + n) % n].d) : 0,
      tiltDeg: (Math.asin(Math.min(1, Math.abs(dot(d, a)))) * 180) / Math.PI,
    }
  }

  return model.edges.map((e) => [endFor(e.v0, e.id), endFor(e.v1, e.id)])
}
