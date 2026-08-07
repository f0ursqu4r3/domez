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

      // ---- Extruded-entry closure: seal the shell back to the buck ----
      if (opts.closeDoorways !== false) {
        const zTop = z0 + door.height
        const positions: number[] = []
        const pushQuadStrip = (
          inner: (s: number) => THREE.Vector3,
          outer: (s: number) => THREE.Vector3,
          segments: number,
        ) => {
          for (let i = 0; i < segments; i++) {
            const s0 = i / segments
            const s1 = (i + 1) / segments
            const a0 = inner(s0)
            const a1 = inner(s1)
            const b0 = outer(s0)
            const b1 = outer(s1)
            positions.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z)
            positions.push(a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z)
          }
        }
        const shellU = (z: number, t: number) =>
          Math.max(door.framePlaneDist, Math.sqrt(Math.max(0, radius * radius - z * z - t * t)))
        // Side walls at ±width/2, base plane to header height.
        for (const side of [-1, 1]) {
          const t = side * half
          pushQuadStrip(
            (s) =>
              u.clone().multiplyScalar(door.framePlaneDist).addScaledVector(tv, t).setY(z0 + s * door.height),
            (s) =>
              u.clone().multiplyScalar(shellU(z0 + s * door.height, t)).addScaledVector(tv, t).setY(z0 + s * door.height),
            10,
          )
        }
        // Flat top at header height, out to the sphere.
        pushQuadStrip(
          (s) =>
            u.clone().multiplyScalar(door.framePlaneDist).addScaledVector(tv, -half + s * door.width).setY(zTop),
          (s) =>
            u.clone().multiplyScalar(shellU(zTop, -half + s * door.width)).addScaledVector(tv, -half + s * door.width).setY(zTop),
          12,
        )
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

        // Closure stick framing: plates, studs, top blocking.
        for (const member of door.closureFraming) {
          if (member.part === 'wall plate') {
            for (const side of [-1, 1]) {
              addMember(
                u.clone().multiplyScalar(member.at + member.length / 2)
                  .addScaledVector(tv, side * half)
                  .setY(z0 + memberW / 2),
                memberW, memberW, member.length,
              )
            }
          } else if (member.part === 'wall stud') {
            for (const side of [-1, 1]) {
              addMember(
                u.clone().multiplyScalar(member.at)
                  .addScaledVector(tv, side * half)
                  .setY(z0 + member.length / 2),
                memberW, member.length, memberD,
              )
            }
          } else {
            addMember(
              u.clone().multiplyScalar(door.framePlaneDist + member.length / 2)
                .addScaledVector(tv, member.at)
                .setY(zTop - memberW / 2),
              memberW, memberW, member.length,
            )
          }
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
        for (const p of pts) {
          const q = offset ? p.clone().add(offset) : p
          positions.push(q.x, q.y, q.z)
          normals.push(n.x, n.y, n.z)
        }
        faceMap.push(fid)
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
