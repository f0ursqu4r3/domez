# Mitered Hubless Joint Method Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth joint method — mitered hubless — with real per-end compound-cut angles (engine + CSV export) and true-size rendering of struts meeting each other directly.

**Architecture:** `miterCuts(model)` computes per-edge-end seam half-angles and tilt from `hubAxes` + sorted neighbor directions. The method plugs into `JOINT_METHODS` (all validation flows automatically), a new `miterCsv` exporter surfaces the per-end data, and the existing joint-accurate rendering path gains a mitered branch (full chord, ends cut per-corner to the nearer neighbor seam plane, no hub geometry).

**Tech Stack:** Vue 3 + TypeScript, Three.js, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-08-07-mitered-hubless-design.md`

## Global Constraints

- Tests `bunx vitest run src/engine/__tests__/engine.test.ts`; build `bun run build`.
- Seam plane between adjacent struts i, j: through the vertex, normal `normalize(d̂ᵢ − d̂ⱼ)`; cheek half-angle = `acos(clamp(d̂ᵢ·d̂ⱼ, −1, 1)) / 2` in degrees.
- Mitered = endOffset 0; cut list unchanged; angles live in the miter CSV (per end, not per type).
- Rendering: rect sections only get mitered ends; round sections render full-chord square; NO hub geometry in mitered mode.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `miterCuts` engine

**Files:**
- Create: `src/engine/miter.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**

```ts
export interface MiterEnd {
  vertexId: number
  leftSeamDeg: number
  rightSeamDeg: number
  tiltDeg: number
}
export function miterCuts(model: DomeModel): [MiterEnd, MiterEnd][] // indexed by edge id
```

- [ ] **Step 1: Failing tests**

```ts
describe('miter cuts', () => {
  it('computes symmetric seams at the 1V apex', () => {
    const m = generateDome({ frequency: 1, fraction: '5/8' })
    const cuts = miterCuts(m)
    expect(cuts.length).toBe(m.edges.length)
    // Apex = valence-5 vertex whose neighbors are the upper pentagon.
    const apex = m.vertices.reduce((a, b) => (a.position[2] > b.position[2] ? a : b))
    const apexEnds = m.edges
      .filter((e) => e.v0 === apex.id || e.v1 === apex.id)
      .map((e) => cuts[e.id][e.v0 === apex.id ? 0 : 1])
    expect(apexEnds.length).toBe(5)
    // Perfect 5-fold symmetry: all seams equal, left = right.
    for (const end of apexEnds) {
      expect(end.vertexId).toBe(apex.id)
      expect(end.leftSeamDeg).toBeCloseTo(apexEnds[0].leftSeamDeg, 6)
      expect(end.rightSeamDeg).toBeCloseTo(end.leftSeamDeg, 6)
      expect(end.leftSeamDeg).toBeGreaterThan(10)
      expect(end.leftSeamDeg).toBeLessThan(45)
    }
    // Verify one seam against a direct angle computation.
    const dirs = m.edges
      .filter((e) => e.v0 === apex.id || e.v1 === apex.id)
      .map((e) => {
        const other = e.v0 === apex.id ? e.v1 : e.v0
        const p = m.vertices[other].position
        const a = apex.position
        const d = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
        const l = Math.hypot(d[0], d[1], d[2])
        return [d[0] / l, d[1] / l, d[2] / l]
      })
    let minAngle = Infinity
    for (let i = 1; i < dirs.length; i++) {
      const c = dirs[0][0] * dirs[i][0] + dirs[0][1] * dirs[i][1] + dirs[0][2] * dirs[i][2]
      minAngle = Math.min(minAngle, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI)
    }
    expect(apexEnds[0].leftSeamDeg).toBeCloseTo(minAngle / 2, 6)
  })

  it('tilt tracks the axial angle and zome apex is symmetric', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cuts = miterCuts(m)
    for (const e of m.edges.slice(0, 20)) {
      const t = m.strutTypes[e.typeId]
      for (const end of cuts[e.id]) {
        expect(Math.abs(end.tiltDeg - (90 - t.axialAngleDeg))).toBeLessThan(6)
      }
    }
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 3, baseMode: 'natural' })
    const zc = miterCuts(z)
    const apex = z.vertices.reduce((a, b) => (a.position[2] > b.position[2] ? a : b))
    const apexEnds = z.edges
      .filter((e) => e.v0 === apex.id || e.v1 === apex.id)
      .map((e) => zc[e.id][e.v0 === apex.id ? 0 : 1])
    expect(apexEnds.length).toBe(8)
    for (const end of apexEnds) expect(end.leftSeamDeg).toBeCloseTo(apexEnds[0].leftSeamDeg, 6)
  })
})
```

(Note the tilt check is a ±6° band, not exact: axialAngleDeg is derived from the chord on the unit sphere while tilt is measured against the face-normal hub axis — they agree closely but not identically, especially near the base.)

- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
import type { DomeModel } from './types'
import { hubAxes } from './hubs'

export function miterCuts(model: DomeModel): [MiterEnd, MiterEnd][] {
  const axes = hubAxes(model)
  // Per-vertex sorted fan: [edgeId, unit direction, angle around axis].
  const fans = model.vertices.map((v) => {
    const a = axes[v.id]
    // Tangent basis perpendicular to the axis.
    const ref = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
    const e1 = norm(cross(a, ref))
    const e2 = cross(a, e1) // already unit
    return v.edgeIds
      .map((eid) => {
        const e = model.edges[eid]
        const other = e.v0 === v.id ? e.v1 : e.v0
        const d = norm(sub(model.vertices[other].position, v.position))
        return { eid, d, ang: Math.atan2(dot(d, e2), dot(d, e1)) }
      })
      .sort((x, y) => x.ang - y.ang)
  })
  const seam = (di: number[], dj: number[]) =>
    (Math.acos(Math.max(-1, Math.min(1, dot(di, dj)))) * 180) / Math.PI / 2
  const endFor = (vid: number, eid: number): MiterEnd => {
    const fan = fans[vid]
    const k = fan.findIndex((f) => f.eid === eid)
    const d = fan[k].d
    const n = fan.length
    const left = n > 1 ? seam(d, fan[(k + 1) % n].d) : 0
    const right = n > 1 ? seam(d, fan[(k - 1 + n) % n].d) : 0
    const a = axes[vid]
    return {
      vertexId: vid,
      leftSeamDeg: left,
      rightSeamDeg: right,
      tiltDeg: (Math.asin(Math.min(1, Math.abs(dot(d, a)))) * 180) / Math.PI,
    }
  }
  return model.edges.map((e) => [endFor(e.v0, e.id), endFor(e.v1, e.id)])
}
```

with tiny local `dot/sub/cross/norm` helpers (or import from `./vec` — `cross`, `dot`, `sub`, `normalize` exist there; use them).

- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: miterCuts — per-end compound angles for hubless joints`

---

### Task 2: Joint method + miter CSV + export button

**Files:**
- Modify: `src/engine/cutlist.ts` (JOINT_METHODS + JointMethodId), `src/engine/exports/csv.ts`, `src/composables/useDomeProject.ts` (exporter), `src/components/panels/ExportPanel.vue`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**
- `JointMethodId` = `'hub' | 'flattened-pipe' | 'timber-plate' | 'mitered'`.
- `miterCsv(model: DomeModel, units: UnitSystem): string` — header + one row per strut end: Edge, Strut type, End, Hub vertex, Hub type, Left seam °, Right seam °, Tilt °, plus a chord-length column.
- Exporter key `miterCsv` in `useDomeProject`; ExportPanel `groups` becomes a computed and the miter item carries `show: state.jointId === 'mitered'`.

- [ ] **Step 1: Failing tests**

```ts
describe('mitered joint method', () => {
  it('is a registered joint method with zero end offset', () => {
    const m = JOINT_METHODS.find((j) => j.id === 'mitered')!
    expect(m).toBeDefined()
    expect(m.defaultEndOffset).toBe(0)
  })
  it('miterCsv emits one row per strut end with sane angles', () => {
    const model = generateDome({ frequency: 2, fraction: '1/2' })
    const csv = miterCsv(model, 'imperial')
    const lines = csv.trim().split('\n')
    expect(lines.length).toBe(1 + model.edges.length * 2)
    for (const line of lines.slice(1)) {
      const cols = line.split(',')
      for (const deg of [cols[5], cols[6], cols[7]].map(Number)) {
        expect(deg).toBeGreaterThanOrEqual(0)
        expect(deg).toBeLessThanOrEqual(90)
      }
    }
  })
})
```

- [ ] **Step 2: Implement.**

`cutlist.ts`: `export type JointMethodId = 'hub' | 'flattened-pipe' | 'timber-plate' | 'mitered'` and append to `JOINT_METHODS`:

```ts
{
  id: 'mitered',
  label: 'Mitered hubless',
  defaultEndOffset: 0,
  note: 'Struts run full chord to the vertex; each end is compound-cut against its neighbors (export the miter CSV) — glued/screwed seams, no hub hardware. Timber only.',
},
```

`csv.ts`:

```ts
export function miterCsv(model: DomeModel, units: UnitSystem): string {
  const unit = units === 'imperial' ? 'in' : 'mm'
  const cuts = miterCuts(model)
  const lines = [
    row('Edge', 'Strut type', 'End', 'Hub vertex', 'Hub type',
        'Left seam (deg)', 'Right seam (deg)', 'Tilt (deg)', `Chord (${unit})`),
  ]
  for (const e of model.edges) {
    const t = model.strutTypes[e.typeId]
    cuts[e.id].forEach((end, i) => {
      const hub = model.hubTypes[model.vertices[end.vertexId].hubTypeId]
      lines.push(row(e.id, t.label, i === 0 ? 'v0' : 'v1', end.vertexId, hub.label,
        end.leftSeamDeg.toFixed(2), end.rightSeamDeg.toFixed(2), end.tiltDeg.toFixed(2),
        e.chordFactor.toFixed(6)))
    })
  }
  return lines.join('\n')
}
```

(chord column is the unit-sphere factor times nothing — multiply by radius at the call site instead: pass `radius` as a third param and emit `(e.chordFactor * radius).toFixed(3)`; update the test to pass `150`.)

`useDomeProject.ts`: `miterCsv: () => download(`${fileStem.value}-miter-cuts.csv`, miterCsv(model.value, state.units, radius.value), 'text/csv')` in `exporters` (import from exports/csv).

`ExportPanel.vue`: make `groups` a `computed(...)`; add to Fabrication items:

```ts
...(state.jointId === 'mitered'
  ? [{ label: 'Miter cuts CSV', desc: 'per-end compound angles', icon: FileSpreadsheet, run: exporters.miterCsv }]
  : []),
```

(destructure `state` from the composable).

- [ ] **Step 3: Run full suite + build** — PASS/clean.
- [ ] **Step 4: Commit** — `feat: mitered hubless joint method + per-end miter CSV`

---

### Task 3: Mitered rendering + live verification

**Files:**
- Modify: `src/lib/three-builders.ts`

- [ ] **Step 1: Rendering.** In `buildDomeGroup`:
  - `const miterStruts = jointMode && opts.jointId === 'mitered' && section?.kind === 'rect'` — reuse the beveled merged-geometry path (`bevelStruts || miterStruts` selects it) with two differences: pullback = 0 (ends start AT the vertex), and `endCorners` cuts each corner ray at the **nearer of the two neighbor seam planes** instead of the axis plane. Precompute per-vertex sorted fans once (same code shape as `miterCuts` — import `miterCuts` is not enough since rendering needs the plane normals; compute fans locally: per vertex a sorted list of `{eid, d}` in three-space, and for edge eid at that vertex the two neighbor directions). Corner cut: for corner ray `p(t) = c0 + dir·t` (dir pointing INTO the strut, away from the vertex; c0 = vertex + cross-section offset), for each neighbor seam normal `n = (dSelf − dNbr).normalize()` (three-space), solve `(c0 + dir·t − vertexPos)·n = 0` → `t = n.dot(vertexPos − c0) / n.dot(dir)`; take the larger t of the two planes (the deeper cut wins — both half-spaces must be respected), clamp to `[0, len·0.45]`, then corner sits at `c0 + dir·t`.
  - `endPull` stays 0 for mitered (`opts.jointId === 'mitered' ? 0 : …` in the endPull chain) so round sections render full chord.
  - Joint geometry block: skip entirely for `'mitered'` (no case). Pick spheres still shrink (jointMode true).
- [ ] **Step 2: Suite + build** — PASS/clean.
- [ ] **Step 3: Live verification.** Preview: lumber 2×4, Joint method → Mitered hubless, True size ON, 3V 1/2: struts converge to shared vertices with wedge ends, no hubs; Export tab shows "Miter cuts CSV"; hub click still inspects; zome mode spot check. Screenshot.
- [ ] **Step 4: Commit** — `feat: mitered hubless rendering — struts meet at the vertex, no hardware`
