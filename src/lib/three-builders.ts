import * as THREE from 'three'
import type { DomeModel } from '@/engine/types'
import type { OpeningAssignments, OpeningType } from '@/engine/openings'
import type { DoorwayCut } from '@/engine/doorway'
import { strutColor } from '@/engine/exports/svg'
import type { ViewMode } from '@/composables/useDomeProject'

/** Engine is z-up; three.js is y-up. Proper rotation (x, y, z) -> (x, z, -y). */
export const toThree = (p: readonly number[], r: number) =>
  new THREE.Vector3(p[0] * r, p[2] * r, -p[1] * r)

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
}

export interface DomePickMaps {
  /** instanceId per strut-type mesh -> edgeId */
  strutMaps: Map<THREE.InstancedMesh, number[]>
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
    for (const t of model.strutTypes) {
      const keptEdges = t.edgeIds.filter((eid) => !cutEdges.has(eid))
      if (keptEdges.length === 0) continue
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(strutColor(t.id)),
        roughness: isRect ? 0.8 : 0.55,
        metalness: isRect ? 0.05 : 0.25,
      })
      const mesh = new THREE.InstancedMesh(geo, mat, keptEdges.length)
      mesh.name = `struts-${t.label}`
      const map: number[] = []
      const m = new THREE.Matrix4()
      keptEdges.forEach((eid, i) => {
        const e = model.edges[eid]
        placeStrut(
          m,
          toThree(model.vertices[e.v0].position, radius),
          toThree(model.vertices[e.v1].position, radius),
        )
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(
          i,
          eid === selEdge ? new THREE.Color('#ffffff') : new THREE.Color(strutColor(t.id)),
        )
        map.push(eid)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      pick.strutMaps.set(mesh, map)
      group.add(mesh)
    }

    // Trimmed door struts: surviving pieces from hub to buck.
    const trimmed = opts.doorway?.trimmed ?? []
    if (trimmed.length > 0) {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
        roughness: isRect ? 0.8 : 0.55,
        metalness: isRect ? 0.05 : 0.25,
      }), trimmed.length)
      mesh.name = 'struts-trimmed'
      const m = new THREE.Matrix4()
      trimmed.forEach((piece, i) => {
        placeStrut(m, toThree(piece.aUnit, radius), toThree(piece.bUnit, radius))
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(i, new THREE.Color(strutColor(piece.typeId)))
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
      // Jambs at ±width/2, from the base plane up to the header.
      addMember(
        base.clone().addScaledVector(tv, half).setY(z0 + door.height / 2),
        memberW, door.height, memberD,
      )
      addMember(
        base.clone().addScaledVector(tv, -half).setY(z0 + door.height / 2),
        memberW, door.height, memberD,
      )
      // Header across the top, spanning the rough opening plus both jambs.
      addMember(
        base.clone().setY(z0 + door.height + memberW / 2),
        door.width + 2 * memberW, memberW, memberD,
      )

      // ---- Extruded-entry closure, following the faceted shell ----
      const profile = door.closureProfile
      if (opts.closeDoorways !== false && profile) {
        const halfEnv = profile.halfWidth
        const positions: number[] = []
        // Door-local (radial, tangential, height above base) -> world.
        const P = (ur: number, t: number, h: number) =>
          u.clone().multiplyScalar(ur).addScaledVector(tv, t).setY(z0 + h)
        const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
          positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z)
        }
        // Side walls: seal between the faceted shell and the buck plane —
        // recessed side (u ≥ buck) from base to shell, projecting side
        // (u ≤ buck) from shell up to the roof.
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
              if (h0 <= 1e-6 && h1 <= 1e-6) continue
              quad(P(u0, t, 0), P(u0, t, h0), P(u1, t, h1), P(u1, t, 0))
            } else {
              if (h0 >= profile.topHeight - 1e-6 && h1 >= profile.topHeight - 1e-6) continue
              quad(
                P(u0, t, h0),
                P(u0, t, profile.topHeight),
                P(u1, t, profile.topHeight),
                P(u1, t, h1),
              )
            }
          }
        }
        // Top plane: between the roof-plane shell crossing and the buck.
        for (let i = 1; i < profile.top.length; i++) {
          const [t0, u0] = profile.top[i - 1]
          const [t1, u1] = profile.top[i]
          if (
            Math.abs(u0 - door.framePlaneDist) <= 1e-6 &&
            Math.abs(u1 - door.framePlaneDist) <= 1e-6
          )
            continue
          quad(
            P(door.framePlaneDist, t0, profile.topHeight),
            P(Math.max(u0, 1e-3), t0, profile.topHeight),
            P(Math.max(u1, 1e-3), t1, profile.topHeight),
            P(door.framePlaneDist, t1, profile.topHeight),
          )
        }
        // Face band at the buck plane (margin zone around the rough opening).
        if (halfEnv - half > 1e-6 || profile.topHeight - door.height > 1e-6) {
          const d = door.framePlaneDist
          quad(P(d, -halfEnv, 0), P(d, -halfEnv, profile.topHeight), P(d, -half, profile.topHeight), P(d, -half, 0))
          quad(P(d, half, 0), P(d, half, profile.topHeight), P(d, halfEnv, profile.topHeight), P(d, halfEnv, 0))
          quad(P(d, -half, door.height), P(d, -half, profile.topHeight), P(d, half, profile.topHeight), P(d, half, door.height))
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
            ? P(Math.max(e[1], 1e-3), e[0], profile.topHeight)
            : P(e[0], m.side * halfEnv, e[1])
        const jointPts: THREE.Vector3[] = []
        const barGeo = new THREE.BoxGeometry(1, 1, 1)
        const barMat = new THREE.MeshStandardMaterial({
          color: 0xc9873a,
          roughness: 0.6,
          metalness: 0.1,
        })
        for (const member of door.closureFraming) {
          const a = memberWorld(member, member.a)
          const b = memberWorld(member, member.b)
          const dir = b.clone().sub(a)
          const len = dir.length()
          if (len < 1e-6) continue
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
        // Buck corners are junctions too.
        jointPts.push(P(door.framePlaneDist, -half, 0), P(door.framePlaneDist, half, 0))
        jointPts.push(
          P(door.framePlaneDist, -half, door.height),
          P(door.framePlaneDist, half, door.height),
        )
        // Connector nodes at unique junctions.
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
  }

  // ---- Hubs ----
  if (showStruts) {
    const sphere = new THREE.SphereGeometry(1, 14, 10)
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dee9, roughness: 0.4, metalness: 0.55 })
    const keptVertices = model.vertices.filter((v) => !opts.doorway?.removedVertices.has(v.id))
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
      m.makeScale(hubR, hubR, hubR).setPosition(p)
      mesh.setMatrixAt(i, m)
      const color = v.id === selHub ? '#ffffff' : v.isBase ? '#f59e0b' : '#c7ced9'
      mesh.setColorAt(i, new THREE.Color(color))
      pick.hubMap.push(v.id)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    pick.hubMesh = mesh
    group.add(mesh)
  }

  // ---- Panels, one mesh per opening kind so each gets its own material ----
  if (showPanels) {
    const openings = opts.openings ?? {}
    const highlighted = new Set(opts.highlightFaces ?? [])
    const surface = opts.mode === 'surface'

    type PanelKind = 'solid' | OpeningType
    const buckets = new Map<string, { kind: PanelKind; highlight: boolean; faceIds: number[] }>()
    for (const f of model.faces) {
      if (opts.doorway?.removedFaces.has(f.id)) continue
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
  }

  return group as THREE.Group & { userData: { pick: DomePickMaps } }
}
