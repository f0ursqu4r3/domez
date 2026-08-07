import * as THREE from 'three'
import type { DomeModel } from '@/engine/types'
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
}

export interface DomePickMaps {
  /** instanceId per strut-type mesh -> edgeId */
  strutMaps: Map<THREE.InstancedMesh, number[]>
  hubMesh: THREE.InstancedMesh | null
  hubMap: number[]
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
  const pick: DomePickMaps = { strutMaps: new Map(), hubMesh: null, hubMap: [] }
  group.userData.pick = pick

  const explodeDist = opts.mode === 'exploded' ? opts.explode * radius * 0.45 : 0
  const strutR = Math.max(radius * 0.0045, 0.02 * radius * 0.1)
  const hubR = strutR * 2.6

  const selEdge = opts.selection?.kind === 'strut' ? opts.selection.edgeId : -1
  const selHub = opts.selection?.kind === 'hub' ? opts.selection.vertexId : -1

  const showStruts = opts.mode !== 'surface'
  const showPanels = opts.mode !== 'frame'

  // ---- Struts ----
  if (showStruts) {
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1)
    for (const t of model.strutTypes) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(strutColor(t.id)),
        roughness: 0.55,
        metalness: 0.25,
      })
      const mesh = new THREE.InstancedMesh(cyl, mat, t.count)
      mesh.name = `struts-${t.label}`
      const map: number[] = []
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      t.edgeIds.forEach((eid, i) => {
        const e = model.edges[eid]
        const a = toThree(model.vertices[e.v0].position, radius)
        const b = toThree(model.vertices[e.v1].position, radius)
        const mid = a.clone().add(b).multiplyScalar(0.5)
        if (explodeDist > 0) mid.add(mid.clone().normalize().multiplyScalar(explodeDist))
        const dir = b.clone().sub(a)
        q.setFromUnitVectors(UP, dir.clone().normalize())
        s.set(strutR, dir.length(), strutR)
        m.compose(mid, q, s)
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
      if (explodeDist > 0) p.add(p.clone().normalize().multiplyScalar(explodeDist * 1.15))
      m.makeScale(hubR, hubR, hubR).setPosition(p)
      mesh.setMatrixAt(i, m)
      const color =
        v.id === selHub ? '#ffffff' : v.isBase ? '#f59e0b' : '#c7ced9'
      mesh.setColorAt(i, new THREE.Color(color))
      pick.hubMap.push(v.id)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    pick.hubMesh = mesh
    group.add(mesh)
  }

  // ---- Panels ----
  if (showPanels) {
    const positions: number[] = []
    const normals: number[] = []
    for (const f of model.faces) {
      const pts = f.vertexIds.map((vi) => toThree(model.vertices[vi].position, radius))
      const centroid = pts[0].clone().add(pts[1]).add(pts[2]).multiplyScalar(1 / 3)
      const offset =
        explodeDist > 0 ? centroid.clone().normalize().multiplyScalar(explodeDist * 0.8) : null
      // (x,z,-y) is a proper rotation: engine's outward CCW winding survives.
      const tri = [pts[0], pts[1], pts[2]]
      const n = new THREE.Vector3()
        .subVectors(tri[1], tri[0])
        .cross(new THREE.Vector3().subVectors(tri[2], tri[0]))
        .normalize()
      for (const p of tri) {
        const q = offset ? p.clone().add(offset) : p
        positions.push(q.x, q.y, q.z)
        normals.push(n.x, n.y, n.z)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1c2735,
      roughness: 0.85,
      metalness: 0.05,
      transparent: opts.mode !== 'surface',
      opacity: opts.mode === 'surface' ? 1 : 0.42,
      side: THREE.DoubleSide,
      depthWrite: opts.mode === 'surface',
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'panels'
    group.add(mesh)
  }

  return group as THREE.Group & { userData: { pick: DomePickMaps } }
}
