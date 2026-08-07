import * as THREE from 'three'
import type { DomeModel } from '@/engine/types'
import type { OpeningAssignments, OpeningType } from '@/engine/openings'
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
  if (showStruts) {
    const isRect = section?.kind === 'rect'
    const geo = isRect
      ? new THREE.BoxGeometry(1, 1, 1)
      : new THREE.CylinderGeometry(1, 1, 1, section ? 16 : 8, 1)
    for (const t of model.strutTypes) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(strutColor(t.id)),
        roughness: isRect ? 0.8 : 0.55,
        metalness: isRect ? 0.05 : 0.25,
      })
      const mesh = new THREE.InstancedMesh(geo, mat, t.count)
      mesh.name = `struts-${t.label}`
      const map: number[] = []
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      const xAxis = new THREE.Vector3()
      const yAxis = new THREE.Vector3()
      const zAxis = new THREE.Vector3()
      t.edgeIds.forEach((eid, i) => {
        const e = model.edges[eid]
        const a = toThree(model.vertices[e.v0].position, radius)
        const b = toThree(model.vertices[e.v1].position, radius)
        const mid = a.clone().add(b).multiplyScalar(0.5)
        if (explodeDist > 0) mid.add(mid.clone().normalize().multiplyScalar(explodeDist))
        const dir = b.clone().sub(a)
        if (isRect && section.kind === 'rect') {
          // Board basis: length along the edge, depth (the wide face's normal
          // span) radial, width tangent to the surface.
          yAxis.copy(dir).normalize()
          zAxis
            .copy(mid)
            .normalize()
            .addScaledVector(yAxis, -yAxis.dot(mid.clone().normalize()))
            .normalize()
          xAxis.crossVectors(yAxis, zAxis)
          m.makeBasis(
            xAxis.multiplyScalar(section.width),
            yAxis.clone().multiplyScalar(dir.length()),
            zAxis.clone().multiplyScalar(section.depth),
          )
          m.setPosition(mid)
        } else {
          q.setFromUnitVectors(UP, dir.clone().normalize())
          s.set(strutR, dir.length(), strutR)
          m.compose(mid, q, s)
        }
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
  }

  // ---- Hubs ----
  if (showStruts) {
    const sphere = new THREE.SphereGeometry(1, 14, 10)
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dee9, roughness: 0.4, metalness: 0.55 })
    const mesh = new THREE.InstancedMesh(sphere, mat, model.vertices.length)
    mesh.name = 'hubs'
    const m = new THREE.Matrix4()
    model.vertices.forEach((v, i) => {
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
