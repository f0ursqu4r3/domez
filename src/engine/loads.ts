/**
 * Pin-jointed 3D truss analysis for geodesic frames — direct stiffness
 * method, SI units throughout (N, m, Pa). Educational estimate: pin
 * joints, intact frame, no code load combinations. Not a substitute for
 * a structural engineer.
 */

import type { DomeModel, UnitSystem } from './types'

const G = 9.81

/** Structural clone of the composable's StrutSection (engine stays free
 * of composable imports; the shapes are structurally compatible). */
export type SectionSpec =
  | { kind: 'rect'; widthMm: number; depthMm: number }
  | { kind: 'round'; odMm: number }

/** Cross-section area, m². Round sections require a wall thickness. */
export function sectionArea(section: SectionSpec, wallMm?: number): number {
  if (section.kind === 'rect') return (section.widthMm / 1000) * (section.depthMm / 1000)
  if (wallMm === undefined) throw new Error('round section needs wallMm')
  const od = section.odMm / 1000
  const id = od - (2 * wallMm) / 1000
  return (Math.PI / 4) * (od * od - id * id)
}

/** Weak-axis second moment of area, m⁴. */
export function sectionImin(section: SectionSpec, wallMm?: number): number {
  if (section.kind === 'rect') {
    const a = section.widthMm / 1000
    const b = section.depthMm / 1000
    const big = Math.max(a, b)
    const small = Math.min(a, b)
    return (big * small ** 3) / 12
  }
  if (wallMm === undefined) throw new Error('round section needs wallMm')
  const od = section.odMm / 1000
  const id = od - (2 * wallMm) / 1000
  return (Math.PI / 64) * (od ** 4 - id ** 4)
}

export interface TrussMember {
  i: number
  j: number
  /** Axial rigidity EA, N. */
  ea: number
}

/**
 * Solve the pin-jointed truss for one or more load cases. `fixed` marks
 * fully pinned nodes. Returns per-case member axial forces (tension
 * positive), or null when the reduced stiffness matrix is not positive
 * definite — the frame is a mechanism.
 */
export function solveTruss(
  nodes: [number, number, number][],
  members: TrussMember[],
  fixed: boolean[],
  loadCases: Float64Array[],
): { forces: Float64Array[] } | null {
  const nV = nodes.length
  // Reduced DOF map: -1 for fixed.
  const map = new Int32Array(3 * nV).fill(-1)
  let nDof = 0
  for (let v = 0; v < nV; v++) {
    if (!fixed[v]) {
      map[3 * v] = nDof++
      map[3 * v + 1] = nDof++
      map[3 * v + 2] = nDof++
    }
  }
  if (nDof === 0) return { forces: loadCases.map(() => new Float64Array(members.length)) }

  // Member geometry: unit vector + stiffness.
  const geom = members.map((m) => {
    const a = nodes[m.i]
    const b = nodes[m.j]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const L = Math.hypot(dx, dy, dz)
    return { u: [dx / L, dy / L, dz / L] as const, k: m.ea / L, L }
  })

  // Assemble K (dense, symmetric).
  const K = new Float64Array(nDof * nDof)
  members.forEach((m, mi) => {
    const { u, k } = geom[mi]
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const kab = k * u[a] * u[b]
        const di = [map[3 * m.i + a], map[3 * m.j + a]]
        const dj = [map[3 * m.i + b], map[3 * m.j + b]]
        // (i,i) + (j,j) positive, (i,j) + (j,i) negative.
        if (di[0] >= 0 && dj[0] >= 0) K[di[0] * nDof + dj[0]] += kab
        if (di[1] >= 0 && dj[1] >= 0) K[di[1] * nDof + dj[1]] += kab
        if (di[0] >= 0 && dj[1] >= 0) K[di[0] * nDof + dj[1]] -= kab
        if (di[1] >= 0 && dj[0] >= 0) K[di[1] * nDof + dj[0]] -= kab
      }
    }
  })

  // Cholesky LLᵀ with a trace-scaled positivity tolerance.
  let trace = 0
  for (let i = 0; i < nDof; i++) trace += K[i * nDof + i]
  const tol = 1e-9 * (trace / nDof)
  for (let j = 0; j < nDof; j++) {
    let d = K[j * nDof + j]
    for (let k = 0; k < j; k++) d -= K[j * nDof + k] ** 2
    if (d <= tol) return null
    d = Math.sqrt(d)
    K[j * nDof + j] = d
    for (let i = j + 1; i < nDof; i++) {
      let s = K[i * nDof + j]
      for (let k = 0; k < j; k++) s -= K[i * nDof + k] * K[j * nDof + k]
      K[i * nDof + j] = s / d
    }
  }

  const forces = loadCases.map((full) => {
    // Reduce, solve LLᵀ x = f, expand, then member forces.
    const x = new Float64Array(nDof)
    for (let d = 0; d < 3 * nV; d++) if (map[d] >= 0) x[map[d]] = full[d]
    for (let i = 0; i < nDof; i++) {
      let s = x[i]
      for (let k = 0; k < i; k++) s -= K[i * nDof + k] * x[k]
      x[i] = s / K[i * nDof + i]
    }
    for (let i = nDof - 1; i >= 0; i--) {
      let s = x[i]
      for (let k = i + 1; k < nDof; k++) s -= K[k * nDof + i] * x[k]
      x[i] = s / K[i * nDof + i]
    }
    const disp = new Float64Array(3 * nV)
    for (let d = 0; d < 3 * nV; d++) if (map[d] >= 0) disp[d] = x[map[d]]
    const N = new Float64Array(members.length)
    members.forEach((m, mi) => {
      const { u, k } = geom[mi]
      let stretch = 0
      for (let a = 0; a < 3; a++) stretch += u[a] * (disp[3 * m.j + a] - disp[3 * m.i + a])
      N[mi] = k * stretch
    })
    return N
  })
  return { forces }
}

export interface StructureProps {
  eMPa: number
  densityKgM3: number
  sigmaTMPa: number
  sigmaCMPa: number
  wallMm?: number
}

export interface LoadInputs {
  snowKPa: number
  windKPa: number
  skinKgM2: number
  skinFactor: 1 | 2
}

export interface MemberResult {
  edgeId: number
  forceN: number
  utilization: number
  caseLabel: 'D' | 'D+S' | 'D+W'
}

export type LoadsResult =
  | {
      ok: true
      members: MemberResult[]
      reactions: { vertexId: number; fN: [number, number, number]; uplift: boolean }[]
      maxUtilization: number
      totalWeightN: number
    }
  | { ok: false; reason: 'unsupported-family' | 'mechanism' }

/** Allowable compression: crushing σc·A capped by Euler π²EI/L² over FoS 2.5. */
export function compressionCapacityN(
  props: StructureProps,
  section: SectionSpec,
  lengthM: number,
): number {
  const A = sectionArea(section, props.wallMm)
  const I = sectionImin(section, props.wallMm)
  const crush = props.sigmaCMPa * 1e6 * A
  const euler = (Math.PI ** 2 * props.eMPa * 1e6 * I) / (lengthM ** 2 * 2.5)
  return Math.min(crush, euler)
}

/**
 * Dead + snow + wind envelope for a geodesic frame. Pin joints, intact
 * frame (doorway cuts not modeled), panels as load only. Educational
 * estimate — not engineering advice.
 */
export function analyzeLoads(
  model: DomeModel,
  radiusWorking: number,
  units: UnitSystem,
  section: SectionSpec,
  props: StructureProps,
  inputs: LoadInputs,
): LoadsResult {
  if (model.rhombi || model.polys) return { ok: false, reason: 'unsupported-family' }

  const toM = units === 'imperial' ? 0.0254 : 0.001
  const R = radiusWorking * toM
  const nV = model.vertices.length
  const nodes = model.vertices.map(
    (v) => [v.position[0] * R, v.position[1] * R, v.position[2] * R] as [number, number, number],
  )
  const A = sectionArea(section, props.wallMm)
  const E = props.eMPa * 1e6
  const members = model.edges.map((e) => ({ i: e.v0, j: e.v1, ea: E * A }))
  const lengths = model.edges.map((e) => {
    const a = nodes[e.v0]
    const b = nodes[e.v1]
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  })

  // Face geometry: area + outward normal (flip against the dome center).
  const zs = nodes.map((p) => p[2])
  const center: [number, number, number] = [0, 0, (Math.min(...zs) + Math.max(...zs)) / 2]
  const faceGeo = model.faces.map((f) => {
    const [a, b, c] = f.vertexIds.map((vi) => nodes[vi])
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    let nx = ab[1] * ac[2] - ab[2] * ac[1]
    let ny = ab[2] * ac[0] - ab[0] * ac[2]
    let nz = ab[0] * ac[1] - ab[1] * ac[0]
    const twice = Math.hypot(nx, ny, nz)
    const area = twice / 2
    nx /= twice
    ny /= twice
    nz /= twice
    const cen = [
      (a[0] + b[0] + c[0]) / 3 - center[0],
      (a[1] + b[1] + c[1]) / 3 - center[1],
      (a[2] + b[2] + c[2]) / 3 - center[2],
    ]
    if (nx * cen[0] + ny * cen[1] + nz * cen[2] < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    return { area, n: [nx, ny, nz] as const, corners: f.vertexIds }
  })

  // ---- Load vectors (full DOF space) ----
  const dead = new Float64Array(3 * nV)
  let totalWeightN = 0
  model.edges.forEach((e, ei) => {
    const w = props.densityKgM3 * A * lengths[ei] * G
    totalWeightN += w
    dead[3 * e.v0 + 2] -= w / 2
    dead[3 * e.v1 + 2] -= w / 2
  })
  for (const f of faceGeo) {
    const w = f.area * inputs.skinKgM2 * inputs.skinFactor * G
    totalWeightN += w
    for (const vi of f.corners) dead[3 * vi + 2] -= w / 3
  }
  const snow = new Float64Array(3 * nV)
  for (const f of faceGeo) {
    if (f.n[2] <= 0) continue
    const F = inputs.snowKPa * 1000 * f.area * f.n[2]
    for (const vi of f.corners) snow[3 * vi + 2] -= F / 3
  }
  const wind = new Float64Array(3 * nV)
  for (const f of faceGeo) {
    const dot = f.n[0] // ŵ = +x
    if (dot <= 0) continue
    const F = inputs.windKPa * 1000 * f.area * dot
    for (const vi of f.corners) {
      wind[3 * vi] -= (F / 3) * f.n[0]
      wind[3 * vi + 1] -= (F / 3) * f.n[1]
      wind[3 * vi + 2] -= (F / 3) * f.n[2]
    }
  }

  const cases: { label: 'D' | 'D+S' | 'D+W'; f: Float64Array }[] = [
    { label: 'D', f: dead },
    { label: 'D+S', f: dead.map((v, i) => v + snow[i]) as Float64Array },
    { label: 'D+W', f: dead.map((v, i) => v + wind[i]) as Float64Array },
  ]

  const fixed = model.vertices.map((v) => v.isBase)
  const solved = solveTruss(nodes, members, fixed, cases.map((c) => c.f))
  if (!solved) return { ok: false, reason: 'mechanism' }

  // ---- Envelope + capacities ----
  // Envelope by utilization, not by max |N|: Euler compression capacity is
  // far below tension capacity for slender members, so the case with the
  // larger force is not necessarily the case that governs. For each case
  // compute u = N ≥ 0 ? |N|/capT : |N|/capC(length), then keep the case
  // with the largest u.
  const capT = props.sigmaTMPa * 1e6 * A
  const memberResults: MemberResult[] = model.edges.map((e, ei) => {
    const capC = compressionCapacityN(props, section, lengths[ei])
    let best = 0
    let bestU = -Infinity
    let bestCase: 'D' | 'D+S' | 'D+W' = 'D'
    cases.forEach((c, ci) => {
      const N = solved.forces[ci][ei]
      const cap = N >= 0 ? capT : capC
      const u = cap > 0 ? Math.abs(N) / cap : Infinity
      if (u > bestU) {
        bestU = u
        best = N
        bestCase = c.label
      }
    })
    return {
      edgeId: e.id,
      forceN: best,
      utilization: bestU,
      caseLabel: bestCase,
    }
  })

  // ---- Reactions per support: R = −applied − Σ N·û(support→other), per
  // case; report the case with the largest |vertical|, uplift if any case
  // pulls the hub upward off the foundation (R_z < 0). ----
  const incident = new Map<number, number[]>()
  model.edges.forEach((e, ei) => {
    for (const v of [e.v0, e.v1]) {
      if (!incident.has(v)) incident.set(v, [])
      incident.get(v)!.push(ei)
    }
  })
  const reactions = model.vertices
    .filter((v) => v.isBase)
    .map((v) => {
      let best: [number, number, number] = [0, 0, 0]
      let uplift = false
      cases.forEach((c, ci) => {
        const r: [number, number, number] = [
          -c.f[3 * v.id],
          -c.f[3 * v.id + 1],
          -c.f[3 * v.id + 2],
        ]
        for (const ei of incident.get(v.id) ?? []) {
          const e = model.edges[ei]
          const other = e.v0 === v.id ? e.v1 : e.v0
          const a = nodes[v.id]
          const b = nodes[other]
          const L = lengths[ei]
          const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L]
          const N = solved.forces[ci][ei]
          r[0] -= N * u[0]
          r[1] -= N * u[1]
          r[2] -= N * u[2]
        }
        if (r[2] < -1e-9) uplift = true
        if (Math.abs(r[2]) > Math.abs(best[2])) best = r
      })
      return { vertexId: v.id, fN: best, uplift }
    })

  return {
    ok: true,
    members: memberResults,
    reactions,
    maxUtilization: Math.max(...memberResults.map((m) => m.utilization)),
    totalWeightN,
  }
}
