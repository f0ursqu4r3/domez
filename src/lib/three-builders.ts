import * as THREE from 'three'
import type { DomeModel } from '@/engine/types'
import type { OpeningAssignments, OpeningType } from '@/engine/openings'
import type { DoorwayCut } from '@/engine/doorway'
import type { JointMethodId } from '@/engine/cutlist'
import { hubAxes } from '@/engine/hubs'
import type { RiserModel } from '@/engine/riser'
import { strutColor } from '@/engine/exports/svg'
import type { ViewMode } from '@/composables/useDomeProject'
import { panelUnits, type ClippedPanel } from '@/engine/panelClip'

/** Engine is z-up; three.js is y-up. Proper rotation (x, y, z) -> (x, z, -y). */
export const toThree = (p: readonly number[], r: number) =>
  new THREE.Vector3(p[0] * r, p[2] * r, -p[1] * r)

/** Clip a convex solid (list of convex polygon faces) by the half-space
 * (x − p0)·n ≥ 0, sealing the cut with a cap face. Shared by every
 * joint-accurate rendering path that builds boxes via boolean intersection
 * of half-spaces (mitered struts, framed-panel members). */
function clipSolid(
  faces: THREE.Vector3[][],
  p0: THREE.Vector3,
  n: THREE.Vector3,
  eps: number,
): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = []
  const capPts: THREE.Vector3[] = []
  for (const poly of faces) {
    const d = poly.map((pt) => pt.clone().sub(p0).dot(n))
    if (d.every((v) => v >= -eps)) {
      out.push(poly)
      continue
    }
    if (d.every((v) => v <= eps)) continue
    const np: THREE.Vector3[] = []
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length
      if (d[i] >= -eps) np.push(poly[i])
      if ((d[i] > eps && d[j] < -eps) || (d[i] < -eps && d[j] > eps)) {
        const ip = poly[i].clone().lerp(poly[j], d[i] / (d[i] - d[j]))
        np.push(ip)
        capPts.push(ip)
      }
    }
    if (np.length >= 3) out.push(np)
  }
  if (capPts.length >= 3) {
    const c = capPts
      .reduce((acc, pt) => acc.add(pt), new THREE.Vector3())
      .multiplyScalar(1 / capPts.length)
    const ref = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const e1 = new THREE.Vector3().crossVectors(n, ref).normalize()
    const e2 = new THREE.Vector3().crossVectors(n, e1)
    const sorted = capPts
      .map((pt) => {
        const rel = pt.clone().sub(c)
        return { pt, a: Math.atan2(rel.dot(e2), rel.dot(e1)) }
      })
      .sort((x, y) => x.a - y.a)
      .map((x) => x.pt)
    const cap: THREE.Vector3[] = []
    for (const pt of sorted) {
      if (cap.length === 0 || cap[cap.length - 1].distanceToSquared(pt) > eps * eps) {
        cap.push(pt)
      }
    }
    if (cap.length >= 3) out.push(cap)
  }
  return out
}

/** Which ring-edge index (of a closed loop `ringPts[i] → ringPts[i+1]`) a
 * clipped panel loop's edge (a, b) lies on: both endpoints within `eps` of
 * the ring edge's line AND within its param range. A non-cut loop edge is
 * either the full ring edge or a T-junction sub-piece of it (see
 * `panelClip.ts`'s loop reconstruction), never some other line — mirrors
 * `panelFrames.ts`'s `matchRingEdge`, in three.js space (an orthogonal
 * change of basis from the engine's, so distances/params agree exactly). */
function matchRingEdgeIdx(
  ringPts: THREE.Vector3[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  eps: number,
): number | undefined {
  const nV = ringPts.length
  for (let i = 0; i < nV; i++) {
    const ra = ringPts[i]
    const rb = ringPts[(i + 1) % nV]
    const dir = rb.clone().sub(ra)
    const segLenSq = dir.lengthSq()
    if (segLenSq < 1e-18) continue
    const paramAndDist = (p: THREE.Vector3) => {
      const t = p.clone().sub(ra).dot(dir) / segLenSq
      const c = ra.clone().addScaledVector(dir, t)
      return { t, dist: p.distanceTo(c) }
    }
    const pa = paramAndDist(a)
    const pb = paramAndDist(b)
    if (pa.dist > eps || pb.dist > eps) continue
    if (pa.t < -1e-6 || pa.t > 1 + 1e-6 || pb.t < -1e-6 || pb.t > 1 + 1e-6) continue
    return i
  }
  return undefined
}

export interface BuildOptions {
  mode: ViewMode
  /** 0..1, only used in exploded mode. */
  explode: number
  selection?: { kind: 'strut'; edgeId: number } | { kind: 'hub'; vertexId: number } | null
  /** Real strut cross-section in working units. When set, struts render
   * dimensionally accurate: rectangular boards (depth oriented radially,
   * as timber domes are built) or round tube at true OD. */
  strutSection?:
    { kind: 'rect'; width: number; depth: number } | { kind: 'round'; diameter: number }
  /** Panel opening assignments: faceId -> window | door | vent. */
  openings?: OpeningAssignments
  /** Face ids to render highlighted (opening group hover/selection). */
  highlightFaces?: number[]
  /** Parametric doorway cuts: removed geometry is skipped, trimmed struts
   * render as their surviving pieces, and each door gets its buck frame. */
  doorway?: DoorwayCut
  /** Render the extruded-entry closure sealing the shell back to each buck
   * (side walls + top from the buck plane out to the sphere). Default true. */
  closeDoorways?: boolean
  /** Which strut face the skin panels mount to. Default 'outside'. */
  panelPlacement?: 'outside' | 'inside' | 'both'
  /** Stud-framed riser wall under the base ring (world working-unit coords). */
  riser?: RiserModel | null
  /** Joint method for joint-accurate rendering. Only takes effect together
   * with strutSection (True size): struts shorten to cut length and each
   * hub renders as the real joint — spoked hub, timber plate, or
   * flattened-pipe tab stack. */
  jointId?: JointMethodId
  /** Material removed per strut end, working units (drives hub/plate gaps). */
  endOffset?: number
  /** Loads-view per-strut force + utilization, edge-indexed (index === edgeId). */
  loads?: { forceN: number; utilization: number }[]
  /** Panel-vs-opening clip results, index-aligned with `panelUnits(model)`
   * (see `engine/panelClip.ts`). Drives framed-panel members and skin/
   * surface rendering for clipped/removed units. Undefined falls back to
   * the pre-clip behavior (whole-panel-only, gated by `doorway.removedFaces`). */
  panelClips?: ClippedPanel[]
}

/** Loads-view strut color: tension → blue, compression → red, over → magenta. */
export function loadColor(forceN: number, utilization: number): THREE.Color {
  if (utilization > 1) return new THREE.Color(0xd946ef)
  const t = Math.min(Math.max(utilization, 0), 1)
  const base = new THREE.Color(0x6b7280)
  const target = new THREE.Color(forceN >= 0 ? 0x3b82f6 : 0xef4444)
  return base.lerp(target, t)
}

export interface DomePickMaps {
  /** instanceId per strut-type mesh -> edgeId */
  strutMaps: Map<THREE.InstancedMesh, number[]>
  /** triangle index per merged beveled-strut mesh -> edgeId (joint mode). */
  strutFaceMaps: Map<THREE.Mesh, number[]>
  hubMesh: THREE.InstancedMesh | null
  hubMap: number[]
  /** triangle index per panel mesh -> faceId */
  panelMaps: Map<THREE.Mesh, number[]>
}

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Build the dome as a three.js Group:
 *  - one InstancedMesh of cylinders per strut type (its tape color)
 *  - one InstancedMesh of spheres for hubs (base hubs tinted)
 *  - one Mesh for the triangular panels
 * Exploded mode pushes every element outward from the dome center.
 */
export function buildDomeGroup(
  model: DomeModel,
  radius: number,
  opts: BuildOptions,
): THREE.Group & { userData: { pick: DomePickMaps } } {
  const group = new THREE.Group()
  const pick: DomePickMaps = {
    strutMaps: new Map(),
    strutFaceMaps: new Map(),
    hubMesh: null,
    hubMap: [],
    panelMaps: new Map(),
  }
  group.userData.pick = pick

  const explodeDist = opts.mode === 'exploded' ? opts.explode * radius * 0.45 : 0
  const section = opts.strutSection
  const strutR =
    section?.kind === 'round'
      ? section.diameter / 2
      : Math.max(radius * 0.0045, 0.02 * radius * 0.1)
  const hubR =
    section === undefined
      ? strutR * 2.6
      : section.kind === 'rect'
        ? Math.max(section.width, section.depth) * 0.72
        : section.diameter * 1.35

  const selEdge = opts.selection?.kind === 'strut' ? opts.selection.edgeId : -1
  const selHub = opts.selection?.kind === 'hub' ? opts.selection.vertexId : -1

  // ---- Joint-accurate mode: True size + a joint method ----
  const jointMode = section !== undefined && opts.jointId !== undefined
  const sectionW = section ? (section.kind === 'rect' ? section.width : section.diameter) : 0
  const sectionD = section ? (section.kind === 'rect' ? section.depth : section.diameter) : 0
  const endOffset = Math.max(0, opts.endOffset ?? 0)
  /** How far each strut end pulls back from the vertex in joint mode. */
  const endPull = !jointMode
    ? 0
    : opts.jointId === 'flattened-pipe'
      ? sectionW * 1.5 // tube body stops where the flattened tab begins
      : opts.jointId === 'mitered'
        ? 0 // full chord — ends meet at the vertex
        : endOffset
  const axes = jointMode ? hubAxes(model) : null
  const axisThree = (vid: number) => {
    const a = axes![vid]
    return new THREE.Vector3(a[0], a[2], -a[1])
  }
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xd8dee9,
    roughness: 0.4,
    metalness: 0.55,
  })
  const bevelStruts = jointMode && opts.jointId === 'timber-plate' && section?.kind === 'rect'
  const miterStruts = jointMode && opts.jointId === 'mitered' && section?.kind === 'rect'
  // Framed-panel: no hubs/struts/plates — every panel is its own doubled
  // mitered frame, rendered per-panel/per-edge below instead of per-strut.
  const framedPanel = jointMode && opts.jointId === 'framed-panel'
  // Per-vertex fan of incident strut directions (three-space), for the
  // neighbor seam planes of the mitered joint.
  const fans = miterStruts
    ? model.vertices.map((v) => {
        const axis = axisThree(v.id)
        const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
        const e1 = new THREE.Vector3().crossVectors(axis, ref).normalize()
        const e2 = new THREE.Vector3().crossVectors(axis, e1)
        return v.edgeIds
          .map((eid) => {
            const e = model.edges[eid]
            const other = e.v0 === v.id ? e.v1 : e.v0
            const d = toThree(model.vertices[other].position, radius)
              .sub(toThree(v.position, radius))
              .normalize()
            return { eid, d, ang: Math.atan2(d.dot(e2), d.dot(e1)) }
          })
          .sort((x, y) => x.ang - y.ang)
      })
    : null
  const seamNormals = (vid: number, eid: number): THREE.Vector3[] => {
    const fan = fans![vid]
    const k = fan.findIndex((f) => f.eid === eid)
    if (fan.length < 2) return []
    const d = fan[k].d
    return [fan[(k + 1) % fan.length].d, fan[(k - 1 + fan.length) % fan.length].d].map((dn) =>
      d.clone().sub(dn).normalize(),
    )
  }

  const showStruts = opts.mode !== 'surface'
  const showPanels = opts.mode !== 'frame'

  // ---- Struts ----
  const isRect = section?.kind === 'rect'
  // Shared placement: strut geometry between two world points, exploded
  // offset applied, rect boards oriented depth-radial.
  const placeStrut = (m: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3) => {
    const mid = a.clone().add(b).multiplyScalar(0.5)
    if (explodeDist > 0) mid.add(mid.clone().normalize().multiplyScalar(explodeDist))
    const dir = b.clone().sub(a)
    if (isRect && section && section.kind === 'rect') {
      const yAxis = dir.clone().normalize()
      const radial = mid.clone().normalize()
      const zAxis = radial.clone().addScaledVector(yAxis, -yAxis.dot(radial)).normalize()
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)
      m.makeBasis(
        xAxis.multiplyScalar(section.width),
        yAxis.multiplyScalar(dir.length()),
        zAxis.multiplyScalar(section.depth),
      )
      m.setPosition(mid)
    } else {
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
      m.compose(mid, q, new THREE.Vector3(strutR, dir.length(), strutR))
    }
  }

  const cutEdges = new Set<number>([
    ...(opts.doorway?.removedEdges ?? []),
    ...(opts.doorway?.trimmedEdges ?? []),
  ])

  if (showStruts) {
    const geo = isRect
      ? new THREE.BoxGeometry(1, 1, 1)
      : new THREE.CylinderGeometry(1, 1, 1, section ? 16 : 8, 1)
    /** Shortened endpoints in joint mode (clamped to keep some body). */
    const jointEnds = (a: THREE.Vector3, b: THREE.Vector3) => {
      if (endPull <= 0) return [a, b] as const
      const dir = b.clone().sub(a)
      const len = dir.length()
      const pull = Math.min(endPull, len * 0.33)
      dir.normalize()
      return [a.clone().addScaledVector(dir, pull), b.clone().addScaledVector(dir, -pull)] as const
    }
    if (!framedPanel) for (const t of model.strutTypes) {
      const keptEdges = t.edgeIds.filter((eid) => !cutEdges.has(eid))
      if (keptEdges.length === 0) continue
      if ((bevelStruts || miterStruts) && section && section.kind === 'rect') {
        // Merged custom geometry. Timber-plate: hexahedra with end faces cut
        // perpendicular to each hub's axis (the axial bevel). Mitered: each
        // board is a convex box extended past the vertices and CLIPPED by
        // its neighbor seam half-spaces — exact mating for any hub, however
        // asymmetric the fan.
        const positions: number[] = []
        const faceMap: number[] = []
        const w2 = section.width / 2
        const d2 = section.depth / 2
        const pushPoly = (poly: THREE.Vector3[], eid: number, explode: THREE.Vector3) => {
          for (let i = 2; i < poly.length; i++) {
            for (const pt of [poly[0], poly[i - 1], poly[i]]) {
              positions.push(pt.x + explode.x, pt.y + explode.y, pt.z + explode.z)
            }
            faceMap.push(eid)
          }
        }
        for (const eid of keptEdges) {
          const e = model.edges[eid]
          const a3 = toThree(model.vertices[e.v0].position, radius)
          const b3 = toThree(model.vertices[e.v1].position, radius)
          const dir = b3.clone().sub(a3)
          const len = dir.length()
          dir.normalize()
          const mid = a3.clone().add(b3).multiplyScalar(0.5)
          const explode =
            explodeDist > 0
              ? mid.clone().normalize().multiplyScalar(explodeDist)
              : new THREE.Vector3()
          const radial = mid.clone().normalize()
          const zAxis = radial.clone().addScaledVector(dir, -dir.dot(radial)).normalize()
          const xAxis = new THREE.Vector3().crossVectors(dir, zAxis)

          if (miterStruts) {
            // Box extended past both vertices, then clipped by each end's
            // seam half-spaces (fallback: a flat butt cut at the vertex).
            const ext = Math.min(len * 0.3, section.width * 2.5)
            const corner = (endPt: THREE.Vector3, sx: number, sz: number) =>
              endPt
                .clone()
                .addScaledVector(xAxis, sx * w2)
                .addScaledVector(zAxis, sz * d2)
            const aE = a3.clone().addScaledVector(dir, -ext)
            const bE = b3.clone().addScaledVector(dir, ext)
            const A = [corner(aE, 1, 1), corner(aE, -1, 1), corner(aE, -1, -1), corner(aE, 1, -1)]
            const B = [corner(bE, 1, 1), corner(bE, -1, 1), corner(bE, -1, -1), corner(bE, 1, -1)]
            let solid: THREE.Vector3[][] = [
              [A[0], A[3], A[2], A[1]],
              [B[0], B[1], B[2], B[3]],
              [A[0], B[0], B[1], A[1]],
              [A[1], B[1], B[2], A[2]],
              [A[2], B[2], B[3], A[3]],
              [A[3], B[3], B[0], A[0]],
            ]
            const eps = len * 1e-7
            for (const [vertexPos, vid, into] of [
              [a3, e.v0, dir],
              [b3, e.v1, dir.clone().negate()],
            ] as const) {
              const seams = seamNormals(vid, eid)
              const planes = seams.length > 0 ? seams : [into.clone()]
              for (const n of planes) {
                // Keep the half-space containing the strut body.
                const oriented =
                  mid.clone().sub(vertexPos).dot(n) < 0 ? n.clone().negate() : n.clone()
                solid = clipSolid(solid, vertexPos, oriented, eps)
              }
            }
            for (const poly of solid) pushPoly(poly, eid, explode)
            continue
          }

          // Timber-plate: hexahedron, end faces ⊥ the hub axis at the
          // pulled-back end points.
          const pull = Math.min(endOffset, len * 0.33)
          const aP = a3.clone().addScaledVector(dir, pull)
          const bP = b3.clone().addScaledVector(dir, -pull)
          const endCorners = (endPt: THREE.Vector3, vid: number) => {
            const corners: THREE.Vector3[] = []
            const axis = axisThree(vid)
            const denom = axis.dot(dir)
            for (const [sx, sz] of [
              [1, 1],
              [-1, 1],
              [-1, -1],
              [1, -1],
            ] as const) {
              const c0 = endPt
                .clone()
                .addScaledVector(xAxis, sx * w2)
                .addScaledVector(zAxis, sz * d2)
              let tShift = Math.abs(denom) > 0.05 ? axis.dot(endPt.clone().sub(c0)) / denom : 0
              tShift = Math.max(-section.width * 3, Math.min(section.width * 3, tShift))
              corners.push(c0.addScaledVector(dir, tShift))
            }
            return corners
          }
          const A = endCorners(aP, e.v0)
          const B = endCorners(bP, e.v1)
          pushPoly([A[0], A[3], A[2], A[1]], eid, explode)
          pushPoly([B[0], B[1], B[2], B[3]], eid, explode)
          for (let i = 0; i < 4; i++) {
            pushPoly([A[i], B[i], B[(i + 1) % 4], A[(i + 1) % 4]], eid, explode)
          }
        }
        const bgeo = new THREE.BufferGeometry()
        bgeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        bgeo.computeVertexNormals()
        const mesh = new THREE.Mesh(
          bgeo,
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(strutColor(t.id)),
            roughness: 0.8,
            metalness: 0.05,
            side: THREE.DoubleSide,
          }),
        )
        mesh.name = `struts-beveled-${t.label}`
        pick.strutFaceMaps.set(mesh, faceMap)
        group.add(mesh)
        continue
      }
      const loadsMode = opts.mode === 'loads' && opts.loads !== undefined
      const mat = new THREE.MeshStandardMaterial({
        color: loadsMode ? 0xffffff : new THREE.Color(strutColor(t.id)),
        roughness: isRect ? 0.8 : 0.55,
        metalness: isRect ? 0.05 : 0.25,
      })
      const mesh = new THREE.InstancedMesh(geo, mat, keptEdges.length)
      mesh.name = `struts-${t.label}`
      const map: number[] = []
      const m = new THREE.Matrix4()
      keptEdges.forEach((eid, i) => {
        const e = model.edges[eid]
        const [pa, pb] = jointEnds(
          toThree(model.vertices[e.v0].position, radius),
          toThree(model.vertices[e.v1].position, radius),
        )
        placeStrut(m, pa, pb)
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(
          i,
          eid === selEdge
            ? new THREE.Color('#ffffff')
            : loadsMode
              ? loadColor(opts.loads![eid].forceN, opts.loads![eid].utilization)
              : new THREE.Color(strutColor(t.id)),
        )
        map.push(eid)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      pick.strutMaps.set(mesh, map)
      group.add(mesh)
    }

    // Trimmed door struts: surviving pieces from hub to buck. Framed-panel
    // has no struts at all (every joint is a doubled seam of frame members,
    // built below) — the orphan stick mesh would otherwise render alongside
    // the members with no strut hardware to attach to.
    const trimmed = opts.doorway?.trimmed ?? []
    if (!framedPanel && trimmed.length > 0) {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
        roughness: isRect ? 0.8 : 0.55,
        metalness: isRect ? 0.05 : 0.25,
      }), trimmed.length)
      mesh.name = 'struts-trimmed'
      const m = new THREE.Matrix4()
      trimmed.forEach((piece, i) => {
        placeStrut(m, toThree(piece.aUnit, radius), toThree(piece.bUnit, radius))
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(
          i,
          opts.mode === 'loads'
            ? new THREE.Color(0x6b7280)
            : new THREE.Color(strutColor(piece.typeId)),
        )
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      group.add(mesh)
    }

    // Door bucks: two jambs + header per door, at the frame plane.
    for (const door of opts.doorway?.doors ?? []) {
      if (!door.fits) continue
      const az = (door.azimuthDeg * Math.PI) / 180
      // Engine axes: u radial, t tangent; convert to three (x, z, -y).
      const u = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az))
      const tv = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az))
      const z0 = model.cutZ * radius
      const memberW = section
        ? section.kind === 'rect'
          ? section.width
          : section.diameter
        : Math.max(strutR * 2, radius * 0.012)
      const memberD = section && section.kind === 'rect' ? section.depth : memberW
      const mat = new THREE.MeshStandardMaterial({ color: 0xc9873a, roughness: 0.6, metalness: 0.1 })
      const boxGeo = new THREE.BoxGeometry(1, 1, 1)
      const addMember = (center: THREE.Vector3, sx: number, sy: number, sz: number) => {
        const mesh = new THREE.Mesh(boxGeo, mat)
        // Basis: x along tangent, y up, z along radial.
        const mtx = new THREE.Matrix4().makeBasis(
          tv.clone().multiplyScalar(sx),
          new THREE.Vector3(0, sy, 0),
          u.clone().multiplyScalar(sz),
        )
        mtx.setPosition(center)
        mesh.applyMatrix4(mtx)
        mesh.name = `door-${door.id}`
        group.add(mesh)
      }
      const base = u.clone().multiplyScalar(door.framePlaneDist)
      const half = door.width / 2
      // Jambs at ±width/2 span the full opening — through the riser for
      // doors (buckBottomRel < 0 when the floor sits below the base plane).
      const bLo = door.buckBottomRel
      const bHi = door.buckTopRel
      const sillH = door.sillHeight ?? 0
      const worldUp = new THREE.Vector3(0, 1, 0)
      // Door-local (radial, tangential, height above base) -> world. Shared
      // by the shaped buck path and both closure blocks below.
      const P = (ur: number, t: number, h: number) =>
        u.clone().multiplyScalar(ur).addScaledVector(tv, t).setY(z0 + h)
      // Framing bar geometry/material and joint bookkeeping, shared between
      // the rect closure bars and the shaped tunnel bars (a door only ever
      // takes one of those two paths, so there's no cross-talk).
      const jointPts: THREE.Vector3[] = []
      const barGeo = new THREE.BoxGeometry(1, 1, 1)
      const barMat = new THREE.MeshStandardMaterial({
        color: 0xc9873a,
        roughness: 0.6,
        metalness: 0.1,
      })
      const addBar = (a: THREE.Vector3, b: THREE.Vector3) => {
        const dir = b.clone().sub(a)
        const len = dir.length()
        if (len < 1e-6) return
        const bar = new THREE.Mesh(barGeo, barMat)
        const yAxis = dir.clone().normalize()
        // Any perpendicular works for a square section.
        const ref = Math.abs(yAxis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
        const xAxis = new THREE.Vector3().crossVectors(yAxis, ref).normalize()
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis)
        const mtx = new THREE.Matrix4().makeBasis(
          xAxis.multiplyScalar(memberW),
          yAxis.multiplyScalar(len),
          zAxis.multiplyScalar(Math.min(memberD, memberW * 1.5)),
        )
        mtx.setPosition(a.clone().add(b).multiplyScalar(0.5))
        bar.applyMatrix4(mtx)
        bar.name = `door-framing-${door.id}`
        group.add(bar)
        jointPts.push(a, b)
      }

      if (door.shape === 'rect' || !door.shape) {
        addMember(
          base.clone().addScaledVector(tv, half).setY(z0 + (bLo + bHi) / 2),
          memberW, bHi - bLo, memberD,
        )
        addMember(
          base.clone().addScaledVector(tv, -half).setY(z0 + (bLo + bHi) / 2),
          memberW, bHi - bLo, memberD,
        )
        // Header across the top, spanning the rough opening plus both jambs.
        addMember(
          base.clone().setY(z0 + bHi + memberW / 2),
          door.width + 2 * memberW, memberW, memberD,
        )
        // Window sill member under the opening.
        if (sillH > 0) {
          addMember(
            base.clone().setY(z0 + bLo - memberW / 2),
            door.width + 2 * memberW, memberW, memberD,
          )
        }
      } else {
        // Shaped buck: one box member per outline edge, centered on the edge
        // midpoint at the frame plane. Skip the flat bottom edge for
        // floor-standing doors — the opening continues down through the
        // riser/floor there, same rule the rect path uses (no sill member
        // when sillH === 0).
        const outline = door.outline
        const n = outline.length
        for (let i = 0; i < n; i++) {
          const [t0, h0] = outline[i]
          const [t1, h1] = outline[(i + 1) % n]
          if (
            sillH === 0 &&
            Math.abs(h0 - door.buckBottomRel) < 1e-6 &&
            Math.abs(h1 - door.buckBottomRel) < 1e-6
          )
            continue
          const dt = t1 - t0
          const dh = h1 - h0
          const edgeLen = Math.hypot(dt, dh)
          if (edgeLen < 1e-9) continue
          const dirT = dt / edgeLen
          const dirH = dh / edgeLen
          // In-plane edge direction and its in-plane perpendicular — tv and
          // worldUp are orthonormal, so any unit combination of them is too
          // (the buck plane contains both, since it's radial-normal).
          const xDir = tv.clone().multiplyScalar(dirT).add(worldUp.clone().multiplyScalar(dirH))
          const yDir = tv.clone().multiplyScalar(-dirH).add(worldUp.clone().multiplyScalar(dirT))
          const center = P(door.framePlaneDist, (t0 + t1) / 2, (h0 + h1) / 2)
          const mesh = new THREE.Mesh(boxGeo, mat)
          const mtx = new THREE.Matrix4().makeBasis(
            xDir.multiplyScalar(edgeLen),
            yDir.multiplyScalar(memberW),
            u.clone().multiplyScalar(memberD),
          )
          mtx.setPosition(center)
          mesh.applyMatrix4(mtx)
          mesh.name = `door-${door.id}`
          group.add(mesh)
        }
      }

      // ---- Extruded-entry closure, following the faceted shell ----
      const profile = door.closureProfile
      if (opts.closeDoorways !== false && profile) {
        const halfEnv = profile.halfWidth
        const positions: number[] = []
        const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
          positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z)
        }
        // Side walls: seal between the faceted shell and the buck plane —
        // recessed side (u ≥ buck) from the band floor to the shell,
        // projecting side (u ≤ buck) from the shell up to the band top.
        const zLo = profile.lowHeight
        const zHi = profile.topHeight
        for (const [side, wall] of [
          [1, profile.wallPos],
          [-1, profile.wallNeg],
        ] as const) {
          const t = side * halfEnv
          for (let i = 1; i < wall.length; i++) {
            const [u0, h0] = wall[i - 1]
            const [u1, h1] = wall[i]
            const mid = (u0 + u1) / 2
            if (mid >= door.framePlaneDist) {
              if (h0 <= zLo + 1e-6 && h1 <= zLo + 1e-6) continue
              quad(P(u0, t, zLo), P(u0, t, h0), P(u1, t, h1), P(u1, t, zLo))
            } else {
              if (h0 >= zHi - 1e-6 && h1 >= zHi - 1e-6) continue
              quad(P(u0, t, h0), P(u0, t, zHi), P(u1, t, zHi), P(u1, t, h1))
            }
          }
        }
        // Horizontal planes: roof, and the sill apron for windows.
        const planeStrips = (planeProfile: [number, number][], h: number) => {
          for (let i = 1; i < planeProfile.length; i++) {
            const [t0, u0] = planeProfile[i - 1]
            const [t1, u1] = planeProfile[i]
            if (
              Math.abs(u0 - door.framePlaneDist) <= 1e-6 &&
              Math.abs(u1 - door.framePlaneDist) <= 1e-6
            )
              continue
            quad(
              P(door.framePlaneDist, t0, h),
              P(Math.max(u0, 1e-3), t0, h),
              P(Math.max(u1, 1e-3), t1, h),
              P(door.framePlaneDist, t1, h),
            )
          }
        }
        planeStrips(profile.top, zHi)
        if (profile.bottom.length > 0) planeStrips(profile.bottom, zLo)
        // Face band at the buck plane (margin zone around the rough opening).
        const buckLo = bLo
        const buckHi = bHi
        if (halfEnv - half > 1e-6 || zHi - buckHi > 1e-6 || buckLo - zLo > 1e-6) {
          const d = door.framePlaneDist
          quad(P(d, -halfEnv, zLo), P(d, -halfEnv, zHi), P(d, -half, zHi), P(d, -half, zLo))
          quad(P(d, half, zLo), P(d, half, zHi), P(d, halfEnv, zHi), P(d, halfEnv, zLo))
          if (zHi - buckHi > 1e-6) {
            quad(P(d, -half, buckHi), P(d, -half, zHi), P(d, half, zHi), P(d, half, buckHi))
          }
          if (buckLo - zLo > 1e-6) {
            quad(P(d, -half, zLo), P(d, -half, buckLo), P(d, half, buckLo), P(d, half, zLo))
          }
        }
        if (positions.length > 0) {
          const closureGeo = new THREE.BufferGeometry()
          closureGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
          closureGeo.computeVertexNormals()
          const closure = new THREE.Mesh(
            closureGeo,
            new THREE.MeshStandardMaterial({
              color: 0xc9873a,
              roughness: 0.75,
              metalness: 0.05,
              transparent: opts.mode !== 'surface',
              opacity: opts.mode === 'surface' ? 1 : 0.5,
              side: THREE.DoubleSide,
              depthWrite: opts.mode === 'surface',
            }),
          )
          closure.name = `door-closure-${door.id}`
          group.add(closure)
        }

        // Closure stick framing: every member runs between its endpoints —
        // plates, studs, shell-edge rakes, roof blocking and edges — so the
        // frame reads as connected sticks.
        const memberWorld = (m: (typeof door.closureFraming)[number], e: [number, number]) =>
          m.side === 0
            ? P(
                Math.max(e[1], 1e-3),
                e[0],
                m.part.startsWith('sill') ? profile.lowHeight : profile.topHeight,
              )
            : P(e[0], m.side * halfEnv, e[1])
        for (const member of door.closureFraming) {
          addBar(memberWorld(member, member.a), memberWorld(member, member.b))
        }
        // Buck corners are junctions too.
        jointPts.push(P(door.framePlaneDist, -half, bLo), P(door.framePlaneDist, half, bLo))
        jointPts.push(
          P(door.framePlaneDist, -half, bHi),
          P(door.framePlaneDist, half, bHi),
        )
      }

      // ---- Shaped-opening tunnel closure: quads between consecutive
      // stations of each margined-polygon-edge strip, plus the same stick
      // framing/joint treatment as the rect path above. ----
      if (opts.closeDoorways !== false && door.closureTunnel) {
        const d = door.framePlaneDist
        const positions: number[] = []
        const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, dd: THREE.Vector3) => {
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
          positions.push(a.x, a.y, a.z, c.x, c.y, c.z, dd.x, dd.y, dd.z)
        }
        for (const strip of door.closureTunnel) {
          const stations = strip.uShell.length
          const stationPt = (s: number): [number, number] => [
            strip.a[0] + ((strip.b[0] - strip.a[0]) * s) / (stations - 1),
            strip.a[1] + ((strip.b[1] - strip.a[1]) * s) / (stations - 1),
          ]
          for (let s = 0; s < stations - 1; s++) {
            const us = strip.uShell[s]
            const us1 = strip.uShell[s + 1]
            if (Math.abs(us - d) < 1e-6 && Math.abs(us1 - d) < 1e-6) continue
            const [t0, h0] = stationPt(s)
            const [t1, h1] = stationPt(s + 1)
            quad(
              P(Math.min(d, us), t0, h0),
              P(Math.max(d, us), t0, h0),
              P(Math.max(d, us1), t1, h1),
              P(Math.min(d, us1), t1, h1),
            )
          }
        }
        if (positions.length > 0) {
          const closureGeo = new THREE.BufferGeometry()
          closureGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
          closureGeo.computeVertexNormals()
          const closure = new THREE.Mesh(
            closureGeo,
            new THREE.MeshStandardMaterial({
              color: 0xc9873a,
              roughness: 0.75,
              metalness: 0.05,
              transparent: opts.mode !== 'surface',
              opacity: opts.mode === 'surface' ? 1 : 0.5,
              side: THREE.DoubleSide,
              depthWrite: opts.mode === 'surface',
            }),
          )
          closure.name = `door-closure-${door.id}`
          group.add(closure)
        }

        // Shaped closure framing: the same stick-framing loop as the rect
        // path, but endpoints resolve via ua/ub (the radial extent, carried
        // separately from the door-local a/b since shaped members use it
        // for tangential+height rather than side-plane offsets).
        for (const member of door.closureFraming) {
          addBar(
            P(member.ua ?? d, member.a[0], member.a[1]),
            P(member.ub ?? d, member.b[0], member.b[1]),
          )
        }
      }

      // Connector nodes at unique junctions (rect buck corners + framing
      // ends, or shaped framing ends — whichever branch above ran).
      const seen = new Set<string>()
      const jointGeo = new THREE.SphereGeometry(1, 10, 8)
      const jointMat = new THREE.MeshStandardMaterial({
        color: 0xd8dee9,
        roughness: 0.4,
        metalness: 0.55,
      })
      for (const p of jointPts) {
        const key = `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}:${Math.round(p.z * 2)}`
        if (seen.has(key)) continue
        seen.add(key)
        const joint = new THREE.Mesh(jointGeo, jointMat)
        joint.scale.setScalar(Math.max(memberW * 0.7, radius * 0.004))
        joint.position.copy(p)
        joint.name = `door-joint-${door.id}`
        group.add(joint)
      }
    }
  }

  // ---- Framed-panel members: doubled seams via convex clipping ----
  // Panel units + clip results come straight from the engine
  // (`panelUnits`/`opts.panelClips`, index-aligned per the shared contract
  // in `engine/panelClip.ts`) — no local re-derivation to keep in sync.
  if (showStruts && framedPanel && section) {
    const units = panelUnits(model)
    // Undefined `panelClips` (a caller that hasn't wired Task 3/4 through
    // yet) falls back to the pre-clip binary test: every unit is either
    // untouched ('whole') or fully inside a doorway removal ('removed'),
    // exactly the old `kept` filter's behavior.
    const clips: ClippedPanel[] =
      opts.panelClips ??
      units.map((u, i): ClippedPanel => ({
        unitIndex: i,
        ring: u.ring,
        faceIds: u.faceIds,
        status: u.faceIds.some((fid) => opts.doorway?.removedFaces.has(fid)) ? 'removed' : 'whole',
        fragments: [],
        loops: [],
        area: 0,
      }))

    const edgeByKey = new Map<string, number>()
    model.edges.forEach((e) =>
      edgeByKey.set(`${Math.min(e.v0, e.v1)}:${Math.max(e.v0, e.v1)}`, e.id),
    )
    const baseZ = model.vertices.filter((v) => v.isBase).map((v) => v.position[2])
    const leveledBase = baseZ.length > 0 && Math.max(...baseZ) - Math.min(...baseZ) < 1e-6

    // Pass 1: per-unit outward normal (Newell over the ORIGINAL ring — the
    // panel's plane doesn't move when it's clipped) for every non-removed
    // unit, plus its centroid (used directly by the whole-panel path;
    // clipped loops use their own local centroid in Pass 2 instead).
    interface UnitPlane {
      pts3: THREE.Vector3[]
      normal: THREE.Vector3
      centroid: THREE.Vector3
    }
    const unitPlanes: (UnitPlane | undefined)[] = units.map((u, i) => {
      if (clips[i].status === 'removed') return undefined
      const pts3 = u.ring.map((vid) => toThree(model.vertices[vid].position, radius))
      let nx = 0
      let ny = 0
      let nz = 0
      for (let k = 0; k < pts3.length; k++) {
        const a = pts3[k]
        const b = pts3[(k + 1) % pts3.length]
        nx += (a.y - b.y) * (a.z + b.z)
        ny += (a.z - b.z) * (a.x + b.x)
        nz += (a.x - b.x) * (a.y + b.y)
      }
      const normal = new THREE.Vector3(nx, ny, nz).normalize()
      const centroid = pts3
        .reduce((s, p) => s.add(p), new THREE.Vector3())
        .multiplyScalar(1 / pts3.length)
      if (normal.dot(centroid) < 0) normal.negate() // outward from the dome center (world origin)
      return { pts3, normal, centroid }
    })
    const edgeIdFor = (va: number, vb: number): number | undefined =>
      edgeByKey.get(`${Math.min(va, vb)}:${Math.max(va, vb)}`)

    const thickness = sectionW // rect: width; round: OD — in-plane, inward from the edge line
    const depth = sectionD // rect: depth; round: OD — out-of-plane, inward along −normal
    const ext = thickness * 1.5
    const typeBuckets = new Map<number, { positions: number[]; faceMap: number[] }>()
    const pushMember = (
      typeId: number,
      poly: THREE.Vector3[],
      eid: number,
      explode: THREE.Vector3,
    ) => {
      let bucket = typeBuckets.get(typeId)
      if (!bucket) {
        bucket = { positions: [], faceMap: [] }
        typeBuckets.set(typeId, bucket)
      }
      for (let i = 2; i < poly.length; i++) {
        for (const pt of [poly[0], poly[i - 1], poly[i]]) {
          bucket.positions.push(pt.x + explode.x, pt.y + explode.y, pt.z + explode.z)
        }
        bucket.faceMap.push(eid)
      }
    }

    // One member solid per LOOP edge — a whole panel's single outer ring,
    // or every loop (outer islands + holes) of a clipped panel — flush with
    // the edge line and panel surface, `thickness` inward in-plane and
    // `depth` inward along −normal, corners mitered against this loop's own
    // neighboring edges, seam-planed against the model edge's other kept
    // panel(s) when it resolves to a real (non-cut) interior edge.
    // `eidOf(i)` returns the model edge id for loop edge i, -1 when the
    // edge lies on an opening cut (no model edge, default panel color), or
    // undefined to skip that edge entirely (the whole-panel path's ring
    // edges always resolve, so this is purely defensive there).
    const buildMember = (
      normal: THREE.Vector3,
      loopPts: THREE.Vector3[],
      loopCentroid: THREE.Vector3,
      isHole: boolean,
      eidOf: (i: number) => number | undefined,
    ) => {
      const n = loopPts.length
      for (let i = 0; i < n; i++) {
        const eid = eidOf(i)
        if (eid === undefined) continue
        const edge = eid >= 0 ? model.edges[eid] : undefined
        const a3 = loopPts[i]
        const b3 = loopPts[(i + 1) % n]
        const edgeLen = a3.distanceTo(b3)
        if (edgeLen < 1e-9) continue
        const eps = Math.max(edgeLen * 1e-7, Math.min(thickness, depth) * 1e-6)
        const edgeDir = b3.clone().sub(a3).normalize()
        const edgeMid = a3.clone().add(b3).multiplyScalar(0.5)
        const inward = new THREE.Vector3().crossVectors(normal, edgeDir).normalize()
        // Outer loops (CCW viewed from outside): `inward` should point
        // toward the loop's own material, i.e. toward its centroid — same
        // test as the legacy whole-panel code. Hole loops wind CW, so the
        // SAME cross product already points INTO the void along their
        // edges; the member must sit on the panel-material side (outside
        // the hole), so the flip test is inverted: point AWAY from the
        // hole's own centroid instead.
        const pointsTowardCentroid = inward.dot(loopCentroid.clone().sub(edgeMid)) >= 0
        if (pointsTowardCentroid === isHole) inward.negate()
        const explode =
          explodeDist > 0
            ? edgeMid.clone().normalize().multiplyScalar(explodeDist)
            : new THREE.Vector3()

        // Box cross-section: flush with the edge line and panel surface,
        // extending `thickness` inward in-plane and `depth` inward along
        // −normal; length extended past both corners for the miters below.
        const corner = (pt: THREE.Vector3, uSel: 0 | 1, wSel: 0 | 1) =>
          pt
            .clone()
            .addScaledVector(inward, uSel * thickness)
            .addScaledVector(normal, -wSel * depth)
        const aE = a3.clone().addScaledVector(edgeDir, -ext)
        const bE = b3.clone().addScaledVector(edgeDir, ext)
        const A = [corner(aE, 0, 0), corner(aE, 1, 0), corner(aE, 1, 1), corner(aE, 0, 1)]
        const B = [corner(bE, 0, 0), corner(bE, 1, 0), corner(bE, 1, 1), corner(bE, 0, 1)]
        let solid: THREE.Vector3[][] = [
          [A[0], A[3], A[2], A[1]],
          [B[0], B[1], B[2], B[3]],
          [A[0], B[0], B[1], A[1]],
          [A[1], B[1], B[2], A[2]],
          [A[2], B[2], B[3], A[3]],
          [A[3], B[3], B[0], A[0]],
        ]
        // Interior reference point, guaranteed inside the un-clipped solid,
        // for orienting every half-space test below.
        const refPt = edgeMid
          .clone()
          .addScaledVector(inward, thickness / 2)
          .addScaledVector(normal, -depth / 2)

        // (a) Corner-bisector half-spaces: this loop's own two edges meet
        // at each corner and miter against each other, exactly like the
        // mitered-strut fan (plane normal = own edge dir − neighbor dir).
        const prevPt = loopPts[(i - 1 + n) % n]
        const nextPt = loopPts[(i + 2) % n]
        const cornerClip = (vertexPos: THREE.Vector3, dThis: THREE.Vector3, dOther: THREE.Vector3) => {
          const cn = dThis.clone().sub(dOther)
          if (cn.lengthSq() < 1e-12) return
          cn.normalize()
          if (refPt.clone().sub(vertexPos).dot(cn) < 0) cn.negate()
          solid = clipSolid(solid, vertexPos, cn, eps)
        }
        cornerClip(a3, edgeDir, prevPt.clone().sub(a3).normalize())
        cornerClip(b3, edgeDir.clone().negate(), nextPt.clone().sub(b3).normalize())

        if (edge && edge.faceIds.length === 2) {
          // (b) Interior edge: seam plane through the edge line, spanned by
          // the edge direction and the average outward normal of the (up
          // to two) kept panels sharing it.
          const normals = edgeNormals.get(eid) ?? [normal]
          const avg = normals
            .reduce((s, nn) => s.add(nn), new THREE.Vector3())
            .multiplyScalar(1 / normals.length)
          if (avg.lengthSq() > 1e-12) {
            avg.normalize()
            const sn = new THREE.Vector3().crossVectors(edgeDir, avg)
            if (sn.lengthSq() > 1e-12) {
              sn.normalize()
              if (refPt.clone().sub(a3).dot(sn) < 0) sn.negate()
              solid = clipSolid(solid, a3, sn, eps)
            }
          }
        } else if (leveledBase) {
          // (c) Boundary/cut edge on a leveled base: clip to the foundation
          // plane so the extended member doesn't poke through the floor.
          solid = clipSolid(
            solid,
            new THREE.Vector3(0, model.cutZ * radius, 0),
            new THREE.Vector3(0, 1, 0),
            eps,
          )
        }

        const typeId = eid >= 0 ? model.edges[eid].typeId : -1
        for (const poly of solid) pushMember(typeId, poly, eid, explode)
      }
    }

    const diameterCache = new Map<number, number>()
    const unitDiameter = (ui: number, pts3: THREE.Vector3[]): number => {
      const cached = diameterCache.get(ui)
      if (cached !== undefined) return cached
      let d = 0
      for (let a = 0; a < pts3.length; a++) {
        for (let b = a + 1; b < pts3.length; b++) d = Math.max(d, pts3[a].distanceTo(pts3[b]))
      }
      const result = d || 1e-6
      diameterCache.set(ui, result)
      return result
    }

    // Pre-pass: for every clipped unit, resolve each loop's non-cut edges to
    // a model edge id ONCE (via `matchRingEdgeIdx`) and register that unit's
    // normal into `edgeNormals` for exactly the edges it still has — NOT its
    // full original ring, which could include edges the opening consumed
    // entirely. Getting this order-independent (every unit's contribution
    // recorded before ANY unit builds a member) matters: a whole panel's own
    // interior-seam average (part (b) in `buildMember`) must see every
    // touching panel's normal regardless of which one happens to iterate
    // first below.
    interface LoopData {
      loopPts: THREE.Vector3[]
      loopCentroid: THREE.Vector3
      isHole: boolean
      eids: number[]
    }
    const edgeNormals = new Map<number, THREE.Vector3[]>()
    const pushEdgeNormal = (eid: number, normal: THREE.Vector3) => {
      const arr = edgeNormals.get(eid)
      if (arr) arr.push(normal)
      else edgeNormals.set(eid, [normal])
    }
    const clippedLoopData = new Map<number, LoopData[]>()
    for (let ui = 0; ui < units.length; ui++) {
      const clip = clips[ui]
      const plane = unitPlanes[ui]
      if (!plane) continue
      const ring = units[ui].ring
      if (clip.status === 'whole') {
        const nR = ring.length
        for (let k = 0; k < nR; k++) {
          const eid = edgeIdFor(ring[k], ring[(k + 1) % nR])
          if (eid !== undefined) pushEdgeNormal(eid, plane.normal)
        }
        continue
      }
      if (clip.status !== 'clipped') continue
      const eps = 1e-6 * unitDiameter(ui, plane.pts3)
      const loopsData: LoopData[] = []
      for (const loop of clip.loops) {
        const loopPts = loop.pts.map((p) => new THREE.Vector3(p[0], p[2], -p[1]))
        const nL = loopPts.length
        if (nL < 3) continue
        const loopCentroid = loopPts
          .reduce((s, p) => s.add(p), new THREE.Vector3())
          .multiplyScalar(1 / nL)
        const isHole = loop.cut.every(Boolean)
        const eids: number[] = new Array(nL)
        for (let k = 0; k < nL; k++) {
          if (loop.cut[k]) {
            eids[k] = -1
            continue
          }
          const idx = matchRingEdgeIdx(plane.pts3, loopPts[k], loopPts[(k + 1) % nL], eps)
          const eid = idx === undefined ? undefined : edgeIdFor(ring[idx], ring[(idx + 1) % ring.length])
          eids[k] = eid ?? -1
          if (eid !== undefined) pushEdgeNormal(eid, plane.normal)
        }
        loopsData.push({ loopPts, loopCentroid, isHole, eids })
      }
      clippedLoopData.set(ui, loopsData)
    }

    // Pass 2: whole panels render exactly as before (their ring path);
    // clipped panels render every loop of every surviving island.
    for (let ui = 0; ui < units.length; ui++) {
      const clip = clips[ui]
      const plane = unitPlanes[ui]
      if (!plane || clip.status === 'removed') continue
      if (clip.status === 'whole') {
        const ring = units[ui].ring
        const nR = ring.length
        buildMember(plane.normal, plane.pts3, plane.centroid, false, (i) =>
          edgeIdFor(ring[i], ring[(i + 1) % nR]),
        )
        continue
      }
      for (const ld of clippedLoopData.get(ui) ?? []) {
        buildMember(plane.normal, ld.loopPts, ld.loopCentroid, ld.isHole, (i) => ld.eids[i])
      }
    }

    for (const [typeId, bucket] of typeBuckets) {
      if (bucket.positions.length === 0) continue
      const bgeo = new THREE.BufferGeometry()
      bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3))
      bgeo.computeVertexNormals()
      const mesh = new THREE.Mesh(
        bgeo,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(strutColor(typeId)),
          roughness: 0.8,
          metalness: 0.05,
          side: THREE.DoubleSide,
        }),
      )
      mesh.name = `frame-members-${typeId}`
      pick.strutFaceMaps.set(mesh, bucket.faceMap)
      group.add(mesh)
    }
  }

  // ---- Hubs ----
  // Framed-panel has no hub hardware at all — every joint is a doubled seam
  // of panel-frame members, bolted directly to its neighbor.
  if (showStruts && !framedPanel) {
    const sphere = new THREE.SphereGeometry(1, 14, 10)
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dee9, roughness: 0.4, metalness: 0.55 })
    const keptVertices = model.vertices.filter((v) => !opts.doorway?.removedVertices.has(v.id))
    // In joint mode the spheres shrink into the joint geometry — they stay
    // as the raycast targets that carry the hub pick map.
    const pickR = jointMode ? hubR * (opts.jointId === 'mitered' ? 0.35 : 0.55) : hubR
    const mesh = new THREE.InstancedMesh(sphere, mat, keptVertices.length)
    mesh.name = 'hubs'
    const m = new THREE.Matrix4()
    keptVertices.forEach((v, i) => {
      const p = toThree(v.position, radius)
      if (explodeDist > 0)
        p.add(
          p
            .clone()
            .normalize()
            .multiplyScalar(explodeDist * 1.15),
        )
      m.makeScale(pickR, pickR, pickR).setPosition(p)
      mesh.setMatrixAt(i, m)
      const color = v.id === selHub ? '#ffffff' : v.isBase ? '#f59e0b' : '#c7ced9'
      mesh.setColorAt(i, new THREE.Color(color))
      pick.hubMap.push(v.id)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    pick.hubMesh = mesh
    group.add(mesh)

    // ---- Joint-accurate hub geometry ----
    if (jointMode && section) {
      const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16)
      const boxGeo = new THREE.BoxGeometry(1, 1, 1)
      const orientAlong = (obj: THREE.Mesh, axis: THREE.Vector3) => {
        obj.quaternion.setFromUnitVectors(UP, axis)
      }
      for (const v of keptVertices) {
        if (opts.jointId === 'mitered') break
        const pos = toThree(v.position, radius)
        const explode =
          explodeDist > 0
            ? pos
                .clone()
                .normalize()
                .multiplyScalar(explodeDist * 1.15)
            : new THREE.Vector3()
        const axis = axisThree(v.id)
        const dirs: THREE.Vector3[] = []
        for (const eid of v.edgeIds) {
          if (opts.doorway?.removedEdges.has(eid)) continue
          const e = model.edges[eid]
          const other = e.v0 === v.id ? e.v1 : e.v0
          dirs.push(
            toThree(model.vertices[other].position, radius).sub(pos).normalize(),
          )
        }
        const at = (p: THREE.Vector3, obj: THREE.Mesh) => {
          obj.position.copy(p).add(explode)
          obj.name = 'joint'
          group.add(obj)
        }

        if (opts.jointId === 'hub') {
          const core = new THREE.Mesh(cylGeo, steelMat)
          core.scale.set(sectionW * 0.7, sectionW * 2.4, sectionW * 0.7)
          orientAlong(core, axis)
          at(pos, core)
          const spokeLen = Math.max(endOffset, sectionW * 0.5)
          for (const d of dirs) {
            const spoke =
              section.kind === 'round'
                ? new THREE.Mesh(cylGeo, steelMat)
                : new THREE.Mesh(boxGeo, steelMat)
            if (section.kind === 'round') {
              spoke.scale.set(sectionW * 0.62, spokeLen, sectionW * 0.62)
            } else {
              spoke.scale.set(sectionW * 1.15, spokeLen, sectionD * 1.15)
            }
            spoke.quaternion.setFromUnitVectors(UP, d)
            at(pos.clone().addScaledVector(d, spokeLen / 2), spoke)
          }
        } else if (opts.jointId === 'timber-plate') {
          const t = sectionW * 0.16
          const r = Math.max(endOffset * 1.9, sectionW * 1.2)
          const plate = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, t, Math.max(dirs.length, 5)),
            steelMat,
          )
          orientAlong(plate, axis)
          at(pos.clone().addScaledVector(axis, sectionD / 2 + t / 2), plate)
        } else if (opts.jointId === 'flattened-pipe') {
          const od = sectionW
          const tabT = od * 0.15
          const tabW = od * 1.57
          const tabL = od * 1.5 + od * 0.35
          dirs.forEach((d, i) => {
            const side = new THREE.Vector3().crossVectors(axis, d)
            if (side.lengthSq() < 1e-9) side.set(1, 0, 0)
            side.normalize()
            const flatAxis = new THREE.Vector3().crossVectors(d, side).normalize()
            const tab = new THREE.Mesh(boxGeo, steelMat)
            const mtx = new THREE.Matrix4().makeBasis(
              side.clone().multiplyScalar(tabW),
              d.clone().multiplyScalar(tabL),
              flatAxis.clone().multiplyScalar(tabT),
            )
            const center = pos
              .clone()
              .addScaledVector(d, (od * 1.5 - od * 0.35) / 2)
              .addScaledVector(axis, (i - (dirs.length - 1) / 2) * tabT)
              .add(explode)
            mtx.setPosition(center)
            tab.applyMatrix4(mtx)
            tab.name = 'joint'
            group.add(tab)
          })
          const boltLen = dirs.length * tabT + od * 1.2
          const bolt = new THREE.Mesh(cylGeo, steelMat)
          bolt.scale.set(od * 0.19, boltLen, od * 0.19)
          orientAlong(bolt, axis)
          at(pos, bolt)
          for (const side of [1, -1]) {
            const washer = new THREE.Mesh(cylGeo, steelMat)
            washer.scale.set(od * 0.45, od * 0.08, od * 0.45)
            orientAlong(washer, axis)
            at(pos.clone().addScaledVector(axis, (side * boltLen) / 2), washer)
          }
        }
      }
    }
  }

  // ---- Riser wall: sheathing quads, framing bars, joints ----
  if (opts.riser) {
    // Riser coords are already world working units; same axis rotation as toThree.
    const r3 = (p: [number, number, number]) => new THREE.Vector3(p[0], p[2], -p[1])
    const h = opts.riser.height
    const memberW = section
      ? section.kind === 'rect'
        ? section.width
        : section.diameter
      : Math.max(strutR * 2, radius * 0.012)
    const memberD = section && section.kind === 'rect' ? section.depth : memberW
    if (showStruts) {
      const barGeo = new THREE.BoxGeometry(1, 1, 1)
      const barMat = new THREE.MeshStandardMaterial({ color: 0xc9873a, roughness: 0.6, metalness: 0.1 })
      for (const m of opts.riser.members) {
        const a = r3(m.a)
        const b = r3(m.b)
        const dir = b.clone().sub(a)
        const len = dir.length()
        if (len < 1e-6) continue
        const yAxis = dir.clone().normalize()
        const ref = Math.abs(yAxis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
        const xAxis = new THREE.Vector3().crossVectors(yAxis, ref).normalize()
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis)
        const bar = new THREE.Mesh(barGeo, barMat)
        const mtx = new THREE.Matrix4().makeBasis(
          xAxis.multiplyScalar(memberW),
          yAxis.multiplyScalar(len),
          zAxis.multiplyScalar(Math.min(memberD, memberW * 1.5)),
        )
        mtx.setPosition(a.clone().add(b).multiplyScalar(0.5))
        bar.applyMatrix4(mtx)
        bar.name = 'riser-framing'
        group.add(bar)
      }
      const jointGeo = new THREE.SphereGeometry(1, 10, 8)
      const jointMat = new THREE.MeshStandardMaterial({ color: 0xd8dee9, roughness: 0.4, metalness: 0.55 })
      for (const p of opts.riser.jointNodes) {
        const joint = new THREE.Mesh(jointGeo, jointMat)
        joint.scale.setScalar(Math.max(memberW * 0.7, radius * 0.004))
        joint.position.copy(r3(p))
        joint.name = 'riser-joint'
        group.add(joint)
      }
    }
    if (opts.mode !== 'frame') {
      const positions: number[] = []
      const strutDepth = section
        ? section.kind === 'rect'
          ? section.depth
          : section.diameter
        : strutR * 2
      const skins =
        opts.panelPlacement === 'inside'
          ? [-strutDepth / 2]
          : opts.panelPlacement === 'both'
            ? [strutDepth / 2, -strutDepth / 2]
            : [strutDepth / 2]
      for (const seg of opts.riser.segments) {
        // Kept sheathing intervals = segment minus door openings.
        const kept: [number, number][] = []
        let cursor = 0
        for (const [d0, d1] of seg.openings) {
          if (d0 > cursor + 1e-9) kept.push([cursor, d0])
          cursor = Math.max(cursor, d1)
        }
        if (cursor < seg.length - 1e-9) kept.push([cursor, seg.length])
        const dx = (seg.b[0] - seg.a[0]) / seg.length
        const dy = (seg.b[1] - seg.a[1]) / seg.length
        // Outward horizontal normal (away from the axis).
        let nx = dy
        let ny = -dx
        if (nx * (seg.a[0] + seg.b[0]) + ny * (seg.a[1] + seg.b[1]) < 0) {
          nx = -nx
          ny = -ny
        }
        for (const [d0, d1] of kept) {
          for (const skin of skins) {
            const P = (d: number, z: number) =>
              new THREE.Vector3(seg.a[0] + dx * d + nx * skin, z, -(seg.a[1] + dy * d + ny * skin))
            const zT = seg.a[2]
            const zB = zT - h
            const q = [P(d0, zB), P(d0, zT), P(d1, zT), P(d1, zB)]
            positions.push(q[0].x, q[0].y, q[0].z, q[1].x, q[1].y, q[1].z, q[2].x, q[2].y, q[2].z)
            positions.push(q[0].x, q[0].y, q[0].z, q[2].x, q[2].y, q[2].z, q[3].x, q[3].y, q[3].z)
          }
        }
      }
      if (positions.length > 0) {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geo.computeVertexNormals()
        const surface = opts.mode === 'surface'
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: 0x1c2735,
            roughness: 0.85,
            metalness: 0.05,
            transparent: !surface,
            opacity: surface ? 1 : 0.42,
            side: THREE.DoubleSide,
            depthWrite: surface,
          }),
        )
        mesh.name = 'riser-sheathing'
        group.add(mesh)
      }
    }
  }

  // ---- Panels, one mesh per opening kind so each gets its own material ----
  // Skipped entirely in loads mode: utilization colors must not be obscured.
  if (showPanels && opts.mode !== 'loads') {
    const openings = opts.openings ?? {}
    const highlighted = new Set(opts.highlightFaces ?? [])
    const surface = opts.mode === 'surface'

    type PanelKind = 'solid' | OpeningType
    // Per-unit clip status, keyed by face id: 'whole' units render exactly
    // as before (per triangle, below); 'clipped' units render their
    // surviving fragments as their own mesh afterward; 'removed' render
    // nothing. Falls back to the legacy removedFaces-only filter (every
    // face effectively 'whole' unless doorway-removed) when the caller
    // hasn't wired `panelClips` through.
    const clipByFace = new Map<number, ClippedPanel>()
    if (opts.panelClips) {
      for (const c of opts.panelClips) for (const fid of c.faceIds) clipByFace.set(fid, c)
    }
    const faceHidden = (fid: number): boolean =>
      opts.panelClips
        ? (clipByFace.get(fid)?.status ?? 'whole') !== 'whole'
        : (opts.doorway?.removedFaces.has(fid) ?? false)

    const buckets = new Map<string, { kind: PanelKind; highlight: boolean; faceIds: number[] }>()
    for (const f of model.faces) {
      if (faceHidden(f.id)) continue
      const kind: PanelKind = openings[f.id] ?? 'solid'
      const highlight = highlighted.has(f.id)
      const key = `${kind}:${highlight}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { kind, highlight, faceIds: [] }
        buckets.set(key, bucket)
      }
      bucket.faceIds.push(f.id)
    }

    const materialFor = (kind: PanelKind, highlight: boolean): THREE.MeshStandardMaterial => {
      const spec = {
        solid: { color: 0x1c2735, opacity: surface ? 1 : 0.42, roughness: 0.85, metalness: 0.05 },
        window: {
          color: 0x8ecbff,
          opacity: surface ? 0.45 : 0.22,
          roughness: 0.15,
          metalness: 0.3,
        },
        door: { color: 0xc9873a, opacity: surface ? 1 : 0.8, roughness: 0.7, metalness: 0.05 },
        vent: { color: 0x7fe0b2, opacity: surface ? 0.35 : 0.12, roughness: 0.4, metalness: 0.1 },
      }[kind]
      const transparent = spec.opacity < 1
      return new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: spec.roughness,
        metalness: spec.metalness,
        transparent,
        opacity: spec.opacity,
        side: THREE.DoubleSide,
        depthWrite: !transparent,
        emissive: highlight ? 0xffffff : 0x000000,
        emissiveIntensity: highlight ? 0.35 : 0,
      })
    }

    // Skin placement: panels sit on the outside face of the struts, the
    // inside face, or both (two skins).
    const strutDepth = section ? (section.kind === 'rect' ? section.depth : section.diameter) : strutR * 2
    const skinOffsets =
      opts.panelPlacement === 'inside'
        ? [-(strutDepth / 2)]
        : opts.panelPlacement === 'both'
          ? [strutDepth / 2, -(strutDepth / 2)]
          : [strutDepth / 2]

    for (const bucket of buckets.values()) {
      const positions: number[] = []
      const normals: number[] = []
      const faceMap: number[] = []
      for (const fid of bucket.faceIds) {
        const f = model.faces[fid]
        const pts = f.vertexIds.map((vi) => toThree(model.vertices[vi].position, radius))
        const centroid = pts[0]
          .clone()
          .add(pts[1])
          .add(pts[2])
          .multiplyScalar(1 / 3)
        const offset =
          explodeDist > 0
            ? centroid
                .clone()
                .normalize()
                .multiplyScalar(explodeDist * 0.8)
            : null
        // (x,z,-y) is a proper rotation: engine's outward CCW winding survives.
        const n = new THREE.Vector3()
          .subVectors(pts[1], pts[0])
          .cross(new THREE.Vector3().subVectors(pts[2], pts[0]))
          .normalize()
        for (const skin of skinOffsets) {
          for (const p of pts) {
            const q = p.clone().addScaledVector(n, skin)
            if (offset) q.add(offset)
            positions.push(q.x, q.y, q.z)
            normals.push(n.x, n.y, n.z)
          }
          faceMap.push(fid)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
      const mesh = new THREE.Mesh(geo, materialFor(bucket.kind, bucket.highlight))
      mesh.name = `panels-${bucket.kind}${bucket.highlight ? '-hl' : ''}`
      pick.panelMaps.set(mesh, faceMap)
      group.add(mesh)
    }

    // ---- Clipped units: fan-triangulated surviving fragments ----
    // One mesh per unit, named for its index — non-pickable (no entry in
    // `pick.panelMaps`; a clipped fragment isn't a whole face, so there's
    // no single faceId to report back on raycast).
    if (opts.panelClips) {
      for (const c of opts.panelClips) {
        if (c.status !== 'clipped' || c.fragments.length === 0) continue
        const kind: PanelKind = openings[c.faceIds[0]] ?? 'solid'
        const highlight = c.faceIds.some((fid) => highlighted.has(fid))
        const positions: number[] = []
        for (const frag of c.fragments) {
          if (frag.length < 3) continue
          const pts = frag.map((p) => new THREE.Vector3(p[0], p[2], -p[1]))
          // Fragments are convex and CCW viewed from outside the dome (see
          // `panelClip.ts`) — same normal formula as the whole-face loop
          // above, no outward-flip correction needed.
          const n = new THREE.Vector3()
            .subVectors(pts[1], pts[0])
            .cross(new THREE.Vector3().subVectors(pts[2], pts[0]))
            .normalize()
          const centroid = pts
            .reduce((s, p) => s.add(p), new THREE.Vector3())
            .multiplyScalar(1 / pts.length)
          const offset =
            explodeDist > 0
              ? centroid.clone().normalize().multiplyScalar(explodeDist * 0.8)
              : null
          for (const skin of skinOffsets) {
            const skinned = pts.map((p) => {
              const q = p.clone().addScaledVector(n, skin)
              if (offset) q.add(offset)
              return q
            })
            for (let i = 2; i < skinned.length; i++) {
              for (const pt of [skinned[0], skinned[i - 1], skinned[i]]) {
                positions.push(pt.x, pt.y, pt.z)
              }
            }
          }
        }
        if (positions.length === 0) continue
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geo.computeVertexNormals()
        const mesh = new THREE.Mesh(geo, materialFor(kind, highlight))
        mesh.name = `panel-clipped-${c.unitIndex}`
        group.add(mesh)
      }
    }
  }

  return group as THREE.Group & { userData: { pick: DomePickMaps } }
}
