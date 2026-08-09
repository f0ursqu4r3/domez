# Loads View (Truss Analysis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Loads view for geodesic domes — direct-stiffness truss solve of dead/snow/wind cases, per-strut utilization colors in 3D, a Loads data tab, and a per-member CSV.

**Architecture:** `src/engine/loads.ts` holds a reusable `solveTruss` (dense Cholesky, multi-RHS) and `analyzeLoads` (family guard → loads → solve → envelope → capacities → reactions). Materials gain `structure` properties. The composable exposes `state.loadInputs`, a lazy `loadsResult` computed, and the `'loads'` view mode; three-builders colors the existing instanced struts from the result; a new Loads tab presents inputs/results/disclaimer.

**Tech Stack:** Vue 3 + TypeScript, three.js, vitest (bun). Engine stays dependency-free; SI units internally.

## Global Constraints

- Engine must not import from `src/composables/` — `loads.ts` declares its own structural `SectionSpec` type (same shape as `StrutSection`: `{ kind: 'rect'; widthMm; depthMm } | { kind: 'round'; odMm }`).
- Sign convention: tension positive. g = 9.81. FoS for Euler buckling = 2.5, pinned-pinned (K = 1). Working→meters: imperial × 0.0254, metric × 0.001.
- Family guard fires on `model.rhombi || model.polys` (before any math). Cholesky pivot tolerance: `1e-9 × (trace(K)/nDof)`.
- Defaults: `loadInputs = { snowKPa: 0.96, windKPa: 0.96, skinKgM2: 8.5 }`. Colors: tension gray `0x6b7280` → blue `0x3b82f6`, compression gray → red `0xef4444`, utilization > 1 magenta `0xd946ef`.
- Structure props (spec table): lumber-2x4 & lumber-2x2 `{ eMPa: 11000, densityKgM3: 500, sigmaTMPa: 5, sigmaCMPa: 7 }`; emt-34 adds `wallMm: 1.07`, pvc-1 `{ eMPa: 2800, densityKgM3: 1400, sigmaTMPa: 10, sigmaCMPa: 10, wallMm: 3.38 }`, steel-tube-1 `{ eMPa: 200000, densityKgM3: 7850, sigmaTMPa: 150, sigmaCMPa: 150, wallMm: 1.5 }`; emt-34 E/density/sigmas = steel values (200000/7850/150/150).
- `bun run build` and `bun run test` must pass before every commit; gate on exit codes (`cmd > /tmp/x.out 2>&1; RC=$?; …; [ $RC -eq 0 ] && git commit …`). Baseline 117 tests.
- Tab order after this feature: Parts, Openings, Loads, Materials, Build.

---

### Task 1: Section helpers + truss solver core

**Files:**
- Create: `src/engine/loads.ts`
- Test: `src/engine/__tests__/loads.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SectionSpec`, `sectionArea(section, wallMm?): number` (m²), `sectionImin(section, wallMm?): number` (m⁴), `TrussMember { i: number; j: number; ea: number }`, `solveTruss(nodes: [number,number,number][], members: TrussMember[], fixed: boolean[], loadCases: Float64Array[]): { forces: Float64Array[] } | null` (per-case member axial forces, tension +; null = mechanism). Task 2 builds `analyzeLoads` on these.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/__tests__/loads.test.ts
import { describe, expect, it } from 'vitest'
import { sectionArea, sectionImin, solveTruss } from '../loads'

describe('section properties', () => {
  it('computes rect and tube properties in SI', () => {
    // 2×4: 38 × 89 mm
    expect(sectionArea({ kind: 'rect', widthMm: 38, depthMm: 89 })).toBeCloseTo(0.038 * 0.089, 9)
    expect(sectionImin({ kind: 'rect', widthMm: 38, depthMm: 89 })).toBeCloseTo(
      (0.089 * 0.038 ** 3) / 12,
      12,
    )
    // EMT ¾″: OD 23.4, wall 1.07 → ID 21.26 mm
    const od = 0.0234
    const id = 0.02126
    expect(sectionArea({ kind: 'round', odMm: 23.4 }, 1.07)).toBeCloseTo(
      (Math.PI / 4) * (od * od - id * id),
      10,
    )
    expect(sectionImin({ kind: 'round', odMm: 23.4 }, 1.07)).toBeCloseTo(
      (Math.PI / 64) * (od ** 4 - id ** 4),
      14,
    )
    expect(() => sectionArea({ kind: 'round', odMm: 23.4 })).toThrow()
  })
})

describe('truss solver', () => {
  it('matches the textbook square-pyramid truss', () => {
    // NOTE: a 3D two-bar "textbook" truss is ill-posed here — the apex has
    // zero stiffness out of plane, so K is legitimately singular. The
    // pyramid constrains all three apex DOF.
    const nodes: [number, number, number][] = [
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
      [0, 0, 1],
    ]
    const members = [0, 1, 2, 3].map((i) => ({ i, j: 4, ea: 1e6 }))
    const load = new Float64Array(15)
    load[4 * 3 + 2] = -1000 // apex, -z
    const res = solveTruss(nodes, members, [true, true, true, true, false], [load])
    expect(res).not.toBeNull()
    // Leg length √3, vertical component 1/√3: 4N/√3 = −1000 → N = −433.0
    for (let m = 0; m < 4; m++) {
      expect(res!.forces[0][m]).toBeCloseTo((-1000 * Math.sqrt(3)) / 4, 2)
    }
    // An unconstrained direction anywhere means mechanism — a two-bar
    // planar truss in 3D must be REJECTED, not silently solved.
    expect(
      solveTruss(
        [
          [-1, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
        [
          { i: 0, j: 2, ea: 1e6 },
          { i: 1, j: 2, ea: 1e6 },
        ],
        [true, true, false],
        [new Float64Array(9)],
      ),
    ).toBeNull()
  })

  it('matches the tripod and reports mechanisms', () => {
    const nodes: [number, number, number][] = [0, 1, 2]
      .map((k) => (2 * Math.PI * k) / 3)
      .map((a) => [Math.cos(a), Math.sin(a), 0] as [number, number, number])
    nodes.push([0, 0, 1])
    const members = [0, 1, 2].map((i) => ({ i, j: 3, ea: 1e6 }))
    const load = new Float64Array(12)
    load[3 * 3 + 2] = -1000
    const res = solveTruss(nodes, members, [true, true, true, false], [load])
    expect(res).not.toBeNull()
    // Each leg: 3 N (1/√2) = −1000 → N = −471.40
    for (let m = 0; m < 3; m++) {
      expect(res!.forces[0][m]).toBeCloseTo(-1000 * (Math.sqrt(2) / 3), 2)
    }
    // No supports at all → singular → mechanism.
    expect(solveTruss(nodes, members, [false, false, false, false], [load])).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test 2>&1 | tail -8`
Expected: FAIL — cannot resolve `../loads`.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/loads.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test 2>&1 | tail -5`
Expected: PASS, 120 tests (117 + 3).

- [ ] **Step 5: Commit**

```bash
bun run test > /tmp/t.out 2>&1; RC=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && git add src/engine/loads.ts src/engine/__tests__/loads.test.ts && git commit -m "feat: truss solver core — sections, stiffness assembly, Cholesky

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Load cases, envelope, capacities — `analyzeLoads`

**Files:**
- Modify: `src/engine/loads.ts` (append)
- Test: `src/engine/__tests__/loads.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's helpers; `DomeModel`, `UnitSystem` from `./types`; `generateDome`/`generateZome`/`generateGoldberg` in tests.
- Produces (exact shapes from the spec):

```ts
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
export function compressionCapacityN(props: StructureProps, section: SectionSpec, lengthM: number): number
export function analyzeLoads(
  model: DomeModel,
  radiusWorking: number,
  units: UnitSystem,
  section: SectionSpec,
  props: StructureProps,
  inputs: LoadInputs,
): LoadsResult
```

- [ ] **Step 1: Write the failing tests (append to loads.test.ts)**

Add imports at the top of the test file: `analyzeLoads, compressionCapacityN` from `../loads`; `generateDome` from `../generate` (check the actual module name via the existing engine test file's imports — it imports the geodesic generator already; reuse that exact import); `generateZome` from `../zome`; `generateGoldberg` from `../goldberg`.

```ts
const FIR = { eMPa: 11000, densityKgM3: 500, sigmaTMPa: 5, sigmaCMPa: 7 }
const SECT = { kind: 'rect', widthMm: 38, depthMm: 89 } as const
const INPUTS = { snowKPa: 0.96, windKPa: 0.96, skinKgM2: 8.5, skinFactor: 1 as const }

describe('analyzeLoads on a geodesic dome', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })

  it('satisfies vertical equilibrium under dead load alone', () => {
    const res = analyzeLoads(model, 156, 'imperial', SECT, FIR, {
      snowKPa: 0,
      windKPa: 0,
      skinKgM2: 8.5,
      skinFactor: 1,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const sumRz = res.reactions.reduce((s, r) => s + r.fN[2], 0)
    expect(Math.abs(sumRz - res.totalWeightN) / res.totalWeightN).toBeLessThan(1e-6)
    expect(res.reactions.every((r) => !r.uplift)).toBe(true)
  })

  it('puts crown struts in compression and reports sane utilizations', () => {
    const res = analyzeLoads(model, 156, 'imperial', SECT, FIR, INPUTS)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const zTop = Math.max(...model.vertices.map((v) => v.position[2]))
    const crown = model.edges.filter(
      (e) =>
        (model.vertices[e.v0].position[2] + model.vertices[e.v1].position[2]) / 2 > 0.9 * zTop,
    )
    expect(crown.length).toBeGreaterThan(0)
    for (const e of crown) expect(res.members[e.id].forceN).toBeLessThan(0)
    expect(res.maxUtilization).toBeGreaterThan(0)
    expect(Number.isFinite(res.maxUtilization)).toBe(true)
  })

  it('snow governs when snow dwarfs wind; wind breaks symmetry', () => {
    const snowy = analyzeLoads(model, 156, 'imperial', SECT, FIR, {
      snowKPa: 5,
      windKPa: 0.05,
      skinKgM2: 8.5,
      skinFactor: 1,
    })
    expect(snowy.ok).toBe(true)
    if (!snowy.ok) return
    const worst = [...snowy.members].sort((a, b) => b.utilization - a.utilization)[0]
    expect(worst.caseLabel).toBe('D+S')
    for (const m of snowy.members) expect(['D', 'D+S', 'D+W']).toContain(m.caseLabel)

    const windy = analyzeLoads(model, 156, 'imperial', SECT, FIR, {
      snowKPa: 0,
      windKPa: 2,
      skinKgM2: 8.5,
      skinFactor: 1,
    })
    expect(windy.ok).toBe(true)
    if (!windy.ok) return
    // Wind along +x: forces across one strut type must spread (windward ≠ leeward).
    const byType = new Map<number, number[]>()
    for (const e of model.edges) {
      if (!byType.has(e.typeId)) byType.set(e.typeId, [])
      byType.get(e.typeId)!.push(windy.members[e.id].forceN)
    }
    const spreads = [...byType.values()].map((f) => Math.max(...f) - Math.min(...f))
    expect(Math.max(...spreads)).toBeGreaterThan(1)
  })

  it('Euler capacity falls with the square of length', () => {
    const c1 = compressionCapacityN(FIR, SECT, 1)
    const c2 = compressionCapacityN(FIR, SECT, 2)
    // Both Euler-governed for a 2×4 at these lengths.
    expect(c2).toBeCloseTo(c1 / 4, 1)
    // Short column caps at crushing σc·A.
    const short = compressionCapacityN(FIR, SECT, 0.2)
    expect(short).toBeCloseTo(7e6 * 0.038 * 0.089, 3)
  })

  it('reports a mechanism when nothing is anchored', () => {
    const floating = {
      ...model,
      vertices: model.vertices.map((v) => ({ ...v, isBase: false })),
    }
    const res = analyzeLoads(floating, 156, 'imperial', SECT, FIR, INPUTS)
    expect(res).toEqual({ ok: false, reason: 'mechanism' })
  })

  it('declines zome and goldberg families honestly', () => {
    const zome = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
    const gold = generateGoldberg({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    expect(analyzeLoads(zome, 156, 'imperial', SECT, FIR, INPUTS)).toEqual({
      ok: false,
      reason: 'unsupported-family',
    })
    expect(analyzeLoads(gold, 156, 'imperial', SECT, FIR, INPUTS)).toEqual({
      ok: false,
      reason: 'unsupported-family',
    })
  })
})
```

Note: `generateZome`'s exact params object — copy the call shape from the existing engine test file (it constructs zomes already); same for `generateDome`/`generateGoldberg`. Adjust ONLY the import/params syntax to match those existing tests, never the assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test 2>&1 | tail -8`
Expected: FAIL — `analyzeLoads` not exported.

- [ ] **Step 3: Write the implementation (append to loads.ts)**

```ts
import type { DomeModel, UnitSystem } from './types'

const G = 9.81

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
  const capT = props.sigmaTMPa * 1e6 * A
  const memberResults: MemberResult[] = model.edges.map((e, ei) => {
    let best = 0
    let bestCase: 'D' | 'D+S' | 'D+W' = 'D'
    cases.forEach((c, ci) => {
      const N = solved.forces[ci][ei]
      if (Math.abs(N) > Math.abs(best)) {
        best = N
        bestCase = c.label
      }
    })
    const cap = best >= 0 ? capT : compressionCapacityN(props, section, lengths[ei])
    return {
      edgeId: e.id,
      forceN: best,
      utilization: cap > 0 ? Math.abs(best) / cap : Infinity,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test 2>&1 | tail -5`
Expected: PASS, 126 tests (120 + 6).

- [ ] **Step 5: Commit**

```bash
bun run test > /tmp/t.out 2>&1; RC=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && git add src/engine/loads.ts src/engine/__tests__/loads.test.ts && git commit -m "feat: dead/snow/wind load cases, envelope, capacities, reactions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Material structure props, state, persistence, CSV

**Files:**
- Modify: `src/composables/useDomeProject.ts`
- Modify: `src/engine/exports/csv.ts`
- Modify: `src/engine/exports/json.ts`
- Test: `src/engine/__tests__/loads.test.ts` (append 1 CSV test)

**Interfaces:**
- Consumes: `analyzeLoads`, `LoadsResult`, `StructureProps` (Task 2).
- Produces: `MaterialDef.structure: StructureProps`; `state.loadInputs { snowKPa; windKPa; skinKgM2 }`; `ViewMode` includes `'loads'`; composable exports computed `loadsResult` and `exporters.loadsCsv`; `loadsCsv(model, result, radiusWorking, units): string` in csv.ts.

- [ ] **Step 1: CSV test (append to loads.test.ts)**

```ts
import { loadsCsv } from '../exports/csv'

describe('loads CSV', () => {
  it('emits one row per edge with imperial forces in lbf', () => {
    const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const res = analyzeLoads(model, 156, 'imperial', SECT, FIR, INPUTS)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const csv = loadsCsv(model, res, 156, 'imperial')
    const rows = csv.trim().split('\n')
    expect(rows.length).toBe(1 + model.edges.length)
    expect(rows[0]).toContain('lbf')
    expect(rows[1].split(',').length).toBe(7)
  })
})
```

Run to confirm it fails (loadsCsv not exported), then implement.

- [ ] **Step 2: `loadsCsv` in `src/engine/exports/csv.ts`**

```ts
import type { LoadsResult } from '../loads'

/** Per-member loads: force, sense, utilization, governing case. */
export function loadsCsv(
  model: DomeModel,
  result: LoadsResult,
  radiusWorking: number,
  units: UnitSystem,
): string {
  if (!result.ok) return ''
  const toForce = units === 'imperial' ? 0.224809 : 1
  const fUnit = units === 'imperial' ? 'lbf' : 'N'
  const lines = [`edge,type,length,force_${fUnit},sense,utilization_pct,case`]
  for (const m of result.members) {
    const e = model.edges[m.edgeId]
    lines.push(
      [
        m.edgeId,
        model.strutTypes[e.typeId].label,
        formatLength(e.chordFactor * radiusWorking, units),
        (Math.abs(m.forceN) * toForce).toFixed(1),
        m.forceN >= 0 ? 'T' : 'C',
        (m.utilization * 100).toFixed(1),
        m.caseLabel,
      ].join(','),
    )
  }
  return lines.join('\n')
}
```

(`formatLength` and the `DomeModel`/`UnitSystem` imports already exist in csv.ts — reuse them. If `formatLength` output contains commas/quotes it doesn't — it's `12 3/4″`-style; check one output and wrap in quotes only if needed.)

- [ ] **Step 3: Composable wiring in `useDomeProject.ts`**

1. `MaterialDef` gains `structure: StructureProps` (import type from `@/engine/loads`); add the Global Constraints table's values to all five MATERIALS entries.
2. `ViewMode` union adds `'loads'`; the restorePersisted validation array `['assembly', 'frame', 'surface', 'exploded']` adds `'loads'`.
3. State: `loadInputs: { snowKPa: 0.96, windKPa: 0.96, skinKgM2: 8.5 }` in the interface + defaults; persistedSlice adds `loadInputs: { ...state.loadInputs }`; restorePersisted (validated, mirroring other numeric restores):
```ts
const li = p.loadInputs as Record<string, unknown> | undefined
if (li && typeof li === 'object') {
  state.loadInputs.snowKPa = num(li.snowKPa, (n) => n >= 0) ?? state.loadInputs.snowKPa
  state.loadInputs.windKPa = num(li.windKPa, (n) => n >= 0) ?? state.loadInputs.windKPa
  state.loadInputs.skinKgM2 = num(li.skinKgM2, (n) => n >= 0) ?? state.loadInputs.skinKgM2
}
```
resetProject restores the three defaults.
4. Computed (place near the other derived computeds):
```ts
const loadsResult = computed(() =>
  analyzeLoads(model.value, radius.value, state.units, material.value.section, material.value.structure, {
    ...state.loadInputs,
    skinFactor: state.panelPlacement === 'both' ? 2 : 1,
  }),
)
```
5. Exporter `loadsCsv` following the existing exporter pattern (download helper with `fileStem`):
```ts
loadsCsv: () => {
  const r = loadsResult.value
  if (!r.ok) return
  download(`${fileStem.value}-loads.csv`, loadsCsv(model.value, r, radius.value, state.units), 'text/csv')
},
```
(match the composable's actual download-helper name/signature — read the adjacent exporters and copy their call shape exactly; the import of `loadsCsv` from csv.ts may need aliasing, e.g. `loadsCsv as loadsCsvExport`, since the exporter key shares the name.)
6. Export `loadsResult` from the composable's return object.
7. `src/engine/exports/json.ts`: `ProjectSettings` gains `loadInputs?: { snowKPa: number; windKPa: number; skinKgM2: number }`; the composable's json exporter writes `loadInputs: { ...state.loadInputs }` and `loadProjectFile` restores it with the same validation as restorePersisted (mirror how `prices` flows through settings→restore).

- [ ] **Step 4: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: build clean, 127 tests.

- [ ] **Step 5: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/composables/useDomeProject.ts src/engine/exports/csv.ts src/engine/exports/json.ts src/engine/__tests__/loads.test.ts && git commit -m "feat: material structure props, load inputs state, loads CSV

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rendering — loads view mode

**Files:**
- Modify: `src/lib/three-builders.ts`
- Modify: `src/components/DomeViewer.vue`
- Modify: `src/components/ViewModeBar.vue`
- Modify: `src/components/StrutLegend.vue`

**Interfaces:**
- Consumes: `loadsResult` computed (Task 3); `state.viewMode === 'loads'`.
- Produces: `BuildOptions.loads?: { forceN: number; utilization: number }[]` (edge-indexed); exported `loadColor(forceN, utilization): THREE.Color` from three-builders.

- [ ] **Step 1: three-builders**

1. Add to `BuildOptions`: `loads?: { forceN: number; utilization: number }[]`.
2. Export the color mapping (near strut helpers):
```ts
/** Loads-view strut color: tension → blue, compression → red, over → magenta. */
export function loadColor(forceN: number, utilization: number): THREE.Color {
  if (utilization > 1) return new THREE.Color(0xd946ef)
  const t = Math.min(Math.max(utilization, 0), 1)
  const base = new THREE.Color(0x6b7280)
  const target = new THREE.Color(forceN >= 0 ? 0x3b82f6 : 0xef4444)
  return base.lerp(target, t)
}
```
3. In `buildDomeGroup`, treat `'loads'` like `'assembly'` for geometry (no explode: explodeDist already keys on `mode === 'exploded'`; joint-accurate/true-size path must not trigger — the viewer passes `strutSection: undefined` in loads mode). In the per-type InstancedMesh strut loop (the `mesh.setColorAt` call at the selection-highlight line), when `opts.mode === 'loads' && opts.loads`:
   - material color becomes white (`0xffffff`) so instance colors render exactly;
   - `setColorAt(i, eid === selEdge ? new THREE.Color('#ffffff') : loadColor(opts.loads[eid].forceN, opts.loads[eid].utilization))`.
4. Panels: skip panel meshes entirely in loads mode (`if (opts.mode !== 'loads')` around the panel-building block) — utilization colors must not be obscured. Hubs render as in assembly.

- [ ] **Step 2: ViewModeBar** — add `{ value: 'loads', label: 'Loads' }` to the modes array.

- [ ] **Step 3: DomeViewer** — destructure `loadsResult` from the composable; in `rebuildDome()` pass:
```ts
    strutSection: state.trueSize && state.viewMode !== 'loads' ? strutSectionWorking.value : undefined,
    loads:
      state.viewMode === 'loads' && loadsResult.value.ok
        ? loadsResult.value.members.map((m) => ({ forceN: m.forceN, utilization: m.utilization }))
        : undefined,
```
(`loadsResult.value.members` is edge-ordered — index === edgeId.) The existing `watch` that triggers `rebuildDome` on state changes must also fire on `loadsResult` changes while in loads view — check the watch list; if it watches `model`/`state` deeply it already re-runs; otherwise add `loadsResult` to the watched sources.

- [ ] **Step 4: StrutLegend** — when `state.viewMode === 'loads'`, render the utilization legend instead of strut types:

```html
  <div v-if="state.viewMode === 'loads'" class="flex flex-col gap-1.5 rounded-lg border border-border bg-card/90 p-2.5 backdrop-blur-sm text-[10px]">
    <div class="uppercase tracking-widest text-muted-foreground">Utilization</div>
    <div class="flex items-center gap-1.5">
      <div class="h-2 w-20 rounded-sm" style="background: linear-gradient(to right, #6b7280, #3b82f6)"></div>
      <span>tension 0→100%</span>
    </div>
    <div class="flex items-center gap-1.5">
      <div class="h-2 w-20 rounded-sm" style="background: linear-gradient(to right, #6b7280, #ef4444)"></div>
      <span>compression 0→100%</span>
    </div>
    <div class="flex items-center gap-1.5">
      <div class="size-2 rounded-sm" style="background: #d946ef"></div>
      <span>over capacity</span>
    </div>
  </div>
```
Wrap the existing type list in the `v-else` branch. Match the component's actual root structure — read it first and keep its container classes.

- [ ] **Step 5: Verify build + tests, commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
bun run test > /tmp/t.out 2>&1; RC2=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && [ $RC2 -eq 0 ] && git add src/lib/three-builders.ts src/components/DomeViewer.vue src/components/ViewModeBar.vue src/components/StrutLegend.vue && git commit -m "feat: loads view mode — utilization-colored struts + legend

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Loads tab + export button

**Files:**
- Create: `src/components/panels/LoadsTab.vue`
- Modify: `src/App.vue` (5th tab, position 3)
- Modify: `src/components/panels/ExportPanel.vue` (conditional Loads CSV)

**Interfaces:**
- Consumes: `loadsResult`, `state.loadInputs`, `exporters.loadsCsv` (Task 3), `CollapsibleSection`.
- Produces: `LoadsTab.vue` default export.

- [ ] **Step 1: LoadsTab.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TriangleAlert } from '@lucide/vue'

const project = useDomeProject()
const { state, model, loadsResult, radius } = project

const imperial = computed(() => state.units === 'imperial')
// Stored SI (kPa, kg/m²); displayed psf / lb·ft² in imperial.
const PSF_PER_KPA = 20.8854
const LBFT2_PER_KGM2 = 0.204816
const pressureField = (key: 'snowKPa' | 'windKPa') =>
  computed({
    get: () =>
      Number(
        (imperial.value ? state.loadInputs[key] * PSF_PER_KPA : state.loadInputs[key]).toFixed(2),
      ),
    set: (v: number) => {
      if (v >= 0) state.loadInputs[key] = imperial.value ? v / PSF_PER_KPA : v
    },
  })
const snow = pressureField('snowKPa')
const wind = pressureField('windKPa')
const skin = computed({
  get: () =>
    Number(
      (imperial.value
        ? state.loadInputs.skinKgM2 * LBFT2_PER_KGM2
        : state.loadInputs.skinKgM2
      ).toFixed(2),
    ),
  set: (v: number) => {
    if (v >= 0) state.loadInputs.skinKgM2 = imperial.value ? v / LBFT2_PER_KGM2 : v
  },
})
const pUnit = computed(() => (imperial.value ? 'psf' : 'kPa'))
const dUnit = computed(() => (imperial.value ? 'lb/ft²' : 'kg/m²'))

const force = (n: number) =>
  imperial.value ? `${Math.abs(n * 0.224809).toFixed(0)} lbf` : `${Math.abs(n).toFixed(0)} N`

const worst = computed(() => {
  const r = loadsResult.value
  if (!r.ok) return []
  return [...r.members].sort((a, b) => b.utilization - a.utilization).slice(0, 10)
})
const upliftCount = computed(() => {
  const r = loadsResult.value
  return r.ok ? r.reactions.filter((x) => x.uplift).length : 0
})
const maxReaction = computed(() => {
  const r = loadsResult.value
  return r.ok ? Math.max(...r.reactions.map((x) => Math.abs(x.fN[2]))) : 0
})
const utilClass = (u: number) =>
  u >= 1 ? 'text-destructive' : u >= 0.7 ? 'text-amber-500' : 'text-emerald-500'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:load-inputs" title="Load inputs" class="px-4">
      <FieldGroup class="gap-4 pt-1">
        <div class="flex gap-3">
          <Field class="flex-1">
            <FieldLabel>Snow ({{ pUnit }})</FieldLabel>
            <Input v-model.number="snow" type="number" min="0" step="1" class="font-mono" />
          </Field>
          <Field class="flex-1">
            <FieldLabel>Wind ({{ pUnit }})</FieldLabel>
            <Input v-model.number="wind" type="number" min="0" step="1" class="font-mono" />
          </Field>
        </div>
        <Field>
          <FieldLabel>Panel skin ({{ dUnit }})</FieldLabel>
          <Input v-model.number="skin" type="number" min="0" step="0.1" class="font-mono" />
        </Field>
      </FieldGroup>
    </CollapsibleSection>

    <Separator class="my-3" />

    <CollapsibleSection id="right:load-results" title="Results" class="px-4">
      <Alert v-if="!loadsResult.ok && loadsResult.reason === 'unsupported-family'">
        <TriangleAlert />
        <AlertTitle>Pin-frame is a mechanism</AlertTitle>
        <AlertDescription>
          A pin-jointed {{ state.mode === 'zome' ? 'zome' : 'hex/pent' }} frame is not rigid — the
          panels (stressed skin) carry the shape. Frame-only numbers would be meaningless; skin
          analysis is out of scope.
        </AlertDescription>
      </Alert>
      <Alert v-else-if="!loadsResult.ok" variant="destructive">
        <TriangleAlert />
        <AlertTitle>Not self-supporting</AlertTitle>
        <AlertDescription>
          The frame is not self-supporting as a pin-jointed truss.
        </AlertDescription>
      </Alert>
      <template v-else>
        <div class="grid grid-cols-3 gap-2">
          <div
            class="rounded-md border px-3 py-2"
            :class="
              loadsResult.maxUtilization >= 1
                ? 'border-destructive/60 bg-destructive/5'
                : loadsResult.maxUtilization >= 0.7
                  ? 'border-amber-500/50 bg-amber-500/5'
                  : 'border-border bg-card'
            "
          >
            <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Max util</div>
            <div class="font-mono text-lg">
              {{ (loadsResult.maxUtilization * 100).toFixed(0) }}%
            </div>
          </div>
          <div class="rounded-md border border-border bg-card px-3 py-2">
            <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Weight</div>
            <div class="font-mono text-lg">{{ force(loadsResult.totalWeightN) }}</div>
          </div>
          <div class="rounded-md border border-border bg-card px-3 py-2">
            <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Uplift</div>
            <div class="font-mono text-lg">{{ upliftCount }} hubs</div>
          </div>
        </div>

        <div class="mt-3 flex flex-col gap-1">
          <h4 class="text-xs uppercase tracking-widest text-muted-foreground">Worst members</h4>
          <div
            v-for="m in worst"
            :key="m.edgeId"
            class="grid grid-cols-[3rem_1fr_5rem_4rem_3rem] items-baseline gap-2 rounded-md border border-border px-2.5 py-1 font-mono text-[11px]"
          >
            <span class="font-semibold">{{ model.strutTypes[model.edges[m.edgeId].typeId].label }}</span>
            <span class="text-muted-foreground">
              {{ formatLength(model.edges[m.edgeId].chordFactor * radius, state.units) }}
            </span>
            <span>{{ force(m.forceN) }} {{ m.forceN >= 0 ? 'T' : 'C' }}</span>
            <span :class="utilClass(m.utilization)">{{ (m.utilization * 100).toFixed(0) }}%</span>
            <span class="text-muted-foreground">{{ m.caseLabel }}</span>
          </div>
        </div>

        <p class="mt-2 text-xs text-muted-foreground">
          Max base reaction {{ force(maxReaction) }} vertical ·
          {{ upliftCount > 0 ? `${upliftCount} hubs need hold-down anchors` : 'no uplift' }}
        </p>
        <p v-if="state.materialId === 'pvc-1'" class="mt-1 text-xs text-amber-500">
          PVC creeps under sustained load — treat capacity as short-term only.
        </p>
      </template>
    </CollapsibleSection>

    <Separator class="my-3" />

    <p class="px-4 text-xs text-muted-foreground leading-relaxed">
      Educational estimate. Pin joints, intact frame (openings not modeled — door bucks must
      restore the cut members' load path), simplified wind, no code load combinations. Not a
      substitute for a structural engineer.
    </p>
  </div>
</template>
```

- [ ] **Step 2: App.vue** — import `LoadsTab`, add `<TabsTrigger value="loads" class="text-xs">Loads</TabsTrigger>` after Openings, and a matching `<TabsContent value="loads" class="min-h-0 flex-1"><ScrollArea class="h-full"><LoadsTab /></ScrollArea></TabsContent>`.

- [ ] **Step 3: ExportPanel.vue** — in the Fabrication group's computed items, after the mitered conditional add:
```ts
      ...(state.mode === 'geodesic'
        ? [
            {
              label: 'Loads CSV',
              desc: 'per-strut forces + utilization',
              icon: FileSpreadsheet,
              run: exporters.loadsCsv,
            },
          ]
        : []),
```

- [ ] **Step 4: Verify build + tests, commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
bun run test > /tmp/t.out 2>&1; RC2=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && [ $RC2 -eq 0 ] && git add src/components/panels/LoadsTab.vue src/App.vue src/components/panels/ExportPanel.vue && git commit -m "feat: Loads tab — inputs, worst members, reactions, disclaimer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live verification

**Files:** none (browser; fix-forward commits if needed).

- [ ] **Step 1:** Reload the preview. Geodesic 3V 1/2, Douglas Fir 2×4, 26 ft.
- [ ] **Step 2:** Switch view mode to Loads — struts color-shift (base ring vs crown differ); legend swaps to utilization gradients; screenshot.
- [ ] **Step 3:** Loads tab: inputs show ~20 psf / ~20 psf / ~1.7 lb/ft² imperial; results show max util, worst members, reactions. Crank snow to 100 psf → utilizations jump, over-capacity members go magenta in 3D; screenshot.
- [ ] **Step 4:** Switch material to EMT — results recompute (steel: lower utilization at same spans expected for tension, buckling may govern long members).
- [ ] **Step 5:** Switch structure to Zome and Hex/Pent — Loads tab and view show the mechanism disclosure, no numbers, no console errors.
- [ ] **Step 6:** Units → metric: pressures display in kPa, forces in N. Loads CSV downloads with rows for every edge.
- [ ] **Step 7:** Reload → loadInputs persist; project JSON export contains loadInputs; reset restores defaults.
- [ ] **Step 8:** Selection still works in loads view (click a strut → InspectorCard).
- [ ] **Step 9:** Any fixes: commit gated on build+tests.
