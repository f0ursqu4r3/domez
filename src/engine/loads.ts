/**
 * Pin-jointed 3D truss analysis for geodesic frames — direct stiffness
 * method, SI units throughout (N, m, Pa). Educational estimate: pin
 * joints, intact frame, no code load combinations. Not a substitute for
 * a structural engineer.
 */

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
