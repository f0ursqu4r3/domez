# Framed Panels ("Double Wall") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 5th joint method — every panel built as an independent mitered/beveled frame, bolted at doubled-lumber seams — with schedule, jig drawings, CSV, BOM, and true-size 3D.

**Architecture:** `src/engine/panelFrames.ts` computes per-panel member specs (long-point lengths, corner miters, seam bevels) and groups panels into frame types by canonical cyclic signature. `buildCutList` swaps strut rows for member rows under the new jointId; BOM adds seam bolts; new exports (frames CSV + jig SVG); three-builders renders inset frame members via the existing `clipSolid`; Parts tab shows a frames table.

**Tech Stack:** Pure-TS engine + vitest (bun); Vue 3; three.js.

## Global Constraints

- New `JOINT_METHODS` entry exactly: `{ id: 'framed-panel', label: 'Framed panels (double wall)', defaultEndOffset: 0, note: 'Each panel is built independently on a jig and bolted to its neighbors — doubled lumber at every seam, no hub hardware. End offset does not apply.' }`. `JointMethodId` union gains `'framed-panel'`.
- Angle conventions: corner miter = interior corner angle ÷ 2; interior-edge bevel = (180 − dihedralDeg) ÷ 2; leveled-base sill bevel = 90 − degrees(acos(|n̂z|)); natural boundary bevel = 0. Round grouping signatures to 0.1.
- Seam bolts: spacing 16″ imperial / 400 mm metric, `max(2, ceil(length/spacing))` per seam.
- Doorway-removed faces omit their panels and seams (`doorway.removedFaces`).
- `bun run build` and `bun run test` must pass before every commit; gate on exit codes (`cmd > /tmp/x.out 2>&1; RC=$?; …; [ $RC -eq 0 ] && git commit …`). Baseline 133 tests.

---

### Task 1: `panelFrames.ts` engine

**Files:**
- Create: `src/engine/panelFrames.ts`
- Test: `src/engine/__tests__/panelFrames.test.ts`

**Interfaces:**
- Consumes: `DomeModel`, `UnitSystem` from `./types`; `DoorwayCut` from `./doorway`.
- Produces: `FrameMemberSpec`, `FrameType`, `PanelFramePlan`, `buildPanelFrames(model, radius, units, doorway): PanelFramePlan` — Tasks 2–5 consume.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/__tests__/panelFrames.test.ts
import { describe, expect, it } from 'vitest'
import { buildPanelFrames } from '../panelFrames'
import { generateDome } from '../dome'
import { generateZome } from '../zome'
import { generateGoldberg } from '../goldberg'
import { emptyDoorwayCut } from '../doorway'

// Match the exact generator/param call shapes used in engine.test.ts, and
// the actual empty-doorway helper name exported by doorway.ts (grep for the
// function returning `{ doors: [], removedEdges: new Set(), … }`). Only the
// import lines may adapt — assertions are fixed.

const NO_DOOR = emptyDoorwayCut()

describe('panel frames', () => {
  it('counts members: 2 per interior edge, 1 per boundary edge', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    const interior = m.edges.filter((e) => e.faceIds.length === 2).length
    const boundary = m.edges.length - interior
    expect(plan.totalMembers).toBe(2 * interior + boundary)
    expect(plan.totalPanels).toBe(m.faces.length)
    expect(plan.seamCount).toBe(interior)
    expect(plan.boltCount).toBeGreaterThanOrEqual(2 * interior)
    // Every panel accounted for by types.
    expect(plan.types.reduce((s, t) => s + t.panelCount, 0)).toBe(m.faces.length)
  })

  it('1V: equilateral triangles → every miter is 30°', () => {
    const m = generateDome({ frequency: 1, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    for (const t of plan.types) {
      for (const mem of t.members) {
        expect(mem.miterStartDeg).toBeCloseTo(30, 1)
        expect(mem.miterEndDeg).toBeCloseTo(30, 1)
      }
      for (const a of t.cornerAnglesDeg) expect(a).toBeCloseTo(60, 1)
    }
  })

  it('interior bevels are half the seam dihedral; sills get the floor bevel', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    // Reference: half of (180 − dihedral) for a known interior edge type.
    const interiorEdge = m.edges.find((e) => e.faceIds.length === 2)!
    const expected = (180 - interiorEdge.dihedralDeg) / 2
    const allBevels = plan.types.flatMap((t) => t.members.map((mm) => mm.bevelDeg))
    expect(allBevels.some((b) => Math.abs(b - expected) < 0.11)).toBe(true)
    // Sill members exist and carry a nonzero floor bevel on a leveled base.
    const sills = plan.types.flatMap((t) => t.members.filter((mm) => mm.boundary))
    expect(sills.length).toBeGreaterThan(0)
    for (const s of sills) {
      expect(s.bevelDeg).toBeGreaterThan(0)
      expect(s.bevelDeg).toBeLessThan(90)
    }
  })

  it('natural-base boundary members are square-cut', () => {
    const m = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 156, 'imperial', NO_DOOR)
    const sills = plan.types.flatMap((t) => t.members.filter((mm) => mm.boundary))
    expect(sills.length).toBeGreaterThan(0)
    for (const s of sills) expect(s.bevelDeg).toBe(0)
  })

  it('zome frames are 4-sided; goldberg frames are 5/6-sided', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'natural' })
    const zp = buildPanelFrames(z, 156, 'imperial', NO_DOOR)
    expect(zp.types.length).toBeGreaterThan(0)
    for (const t of zp.types) expect(t.sides).toBe(4)
    expect(zp.totalPanels).toBe(z.rhombi!.length)

    const g = generateGoldberg({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    const gp = buildPanelFrames(g, 156, 'imperial', NO_DOOR)
    const sides = new Set(gp.types.map((t) => t.sides))
    expect(sides.has(5)).toBe(true)
    expect(sides.has(6)).toBe(true)
    expect(gp.totalPanels).toBe(g.polys!.length)
  })

  it('member long-point lengths equal panel edge lengths', () => {
    const m = generateDome({ frequency: 2, fraction: '1/2', baseMode: 'natural' })
    const plan = buildPanelFrames(m, 100, 'imperial', NO_DOOR)
    const edgeLengths = new Set(m.edges.map((e) => (e.chordFactor * 100).toFixed(1)))
    for (const t of plan.types) {
      for (const mem of t.members) {
        expect(edgeLengths.has(mem.longPointLength.toFixed(1))).toBe(true)
      }
    }
  })
})
```

If `emptyDoorwayCut` is named differently, use the actual exported empty-cut helper (doorway.ts line ~185 constructs one); if none is exported, construct the literal `{ doors: [], removedEdges: new Set(), trimmedEdges: new Set(), trimmed: [], removedFaces: new Set(), removedVertices: new Set() }` in the test.

- [ ] **Step 2: Run tests to verify they fail** (`bun run test 2>&1 | tail -6` — cannot resolve `../panelFrames`).

- [ ] **Step 3: Implementation**

```ts
// src/engine/panelFrames.ts
import type { DomeModel, UnitSystem } from './types'
import type { DoorwayCut } from './doorway'

/** One distinct member cut within a frame type. */
export interface FrameMemberSpec {
  label: string
  count: number
  longPointLength: number
  miterStartDeg: number
  miterEndDeg: number
  bevelDeg: number
  boundary: boolean
}

/** A jig recipe: one panel shape + dihedral context, built panelCount times. */
export interface FrameType {
  label: string
  panelCount: number
  sides: number
  members: FrameMemberSpec[]
  outline: [number, number][]
  cornerAnglesDeg: number[]
}

export interface PanelFramePlan {
  types: FrameType[]
  totalPanels: number
  totalMembers: number
  seamCount: number
  totalSeamLength: number
  boltCount: number
  omittedPanels: number
}

const deg = (r: number) => (r * 180) / Math.PI
const r1 = (x: number) => Math.round(x * 10) / 10

interface PanelGeom {
  ring: number[]
  outline: [number, number][]   // 2D, CCW
  corners: number[]             // interior angle at each outline vertex, deg
  edges: { len: number; bevel: number; boundary: boolean; edgeId: number }[]
}

/**
 * Framed-panel ("double wall") takeoff: every panel becomes an independent
 * mitered/beveled frame; interior seams carry two members. Doorway-removed
 * panels are omitted — frame those openings on site.
 */
export function buildPanelFrames(
  model: DomeModel,
  radius: number,
  units: UnitSystem,
  doorway: DoorwayCut,
): PanelFramePlan {
  // ---- Panel units: outline rings + owning faces ----
  let units_: { ring: number[]; faceIds: number[] }[]
  if (model.polys) {
    units_ = model.polys.map((p) => ({ ring: [...p.vertexIds], faceIds: [...p.faceIds] }))
  } else if (model.rhombi) {
    units_ = model.rhombi.map((r) => ({ ring: [...r.vertexIds], faceIds: [...r.faceIds] }))
    const covered = new Set(model.rhombi.flatMap((r) => r.faceIds))
    for (const f of model.faces) {
      if (!covered.has(f.id)) units_.push({ ring: [...f.vertexIds], faceIds: [f.id] })
    }
  } else {
    units_ = model.faces.map((f) => ({ ring: [...f.vertexIds], faceIds: [f.id] }))
  }

  const kept = units_.filter((u) => !u.faceIds.some((fid) => doorway.removedFaces.has(fid)))
  const omittedPanels = units_.length - kept.length

  // ---- Edge lookup + leveled-base detection ----
  const edgeByKey = new Map<string, number>()
  model.edges.forEach((e) => edgeByKey.set(`${Math.min(e.v0, e.v1)}:${Math.max(e.v0, e.v1)}`, e.id))
  const baseZ = model.vertices.filter((v) => v.isBase).map((v) => v.position[2])
  const leveledBase = baseZ.length > 0 && Math.max(...baseZ) - Math.min(...baseZ) < 1e-6

  // ---- Per-panel geometry ----
  const P = (vid: number) =>
    model.vertices[vid].position.map((c) => c * radius) as unknown as [number, number, number]
  const geoms: PanelGeom[] = kept.map((u) => {
    const pts = u.ring.map(P)
    // Newell normal.
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      nx += (a[1] - b[1]) * (a[2] + b[2])
      ny += (a[2] - b[2]) * (a[0] + b[0])
      nz += (a[0] - b[0]) * (a[1] + b[1])
    }
    const nl = Math.hypot(nx, ny, nz) || 1
    const n = [nx / nl, ny / nl, nz / nl] as const
    // In-plane basis from the first edge.
    const cen = pts
      .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
      .map((c) => c / pts.length)
    const e0raw = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]]
    const d0 = e0raw[0] * n[0] + e0raw[1] * n[1] + e0raw[2] * n[2]
    const e1v = [e0raw[0] - d0 * n[0], e0raw[1] - d0 * n[1], e0raw[2] - d0 * n[2]]
    const e1l = Math.hypot(e1v[0], e1v[1], e1v[2]) || 1
    const e1 = [e1v[0] / e1l, e1v[1] / e1l, e1v[2] / e1l] as const
    const e2 = [
      n[1] * e1[2] - n[2] * e1[1],
      n[2] * e1[0] - n[0] * e1[2],
      n[0] * e1[1] - n[1] * e1[0],
    ] as const
    let ring = [...u.ring]
    let outline = pts.map(
      (p) =>
        [
          (p[0] - cen[0]) * e1[0] + (p[1] - cen[1]) * e1[1] + (p[2] - cen[2]) * e1[2],
          (p[0] - cen[0]) * e2[0] + (p[1] - cen[1]) * e2[1] + (p[2] - cen[2]) * e2[2],
        ] as [number, number],
    )
    // CCW normalization.
    let area = 0
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]
      const b = outline[(i + 1) % outline.length]
      area += a[0] * b[1] - b[0] * a[1]
    }
    if (area < 0) {
      ring = ring.slice().reverse()
      outline = outline.slice().reverse()
    }
    // Corner interior angles.
    const nV = outline.length
    const corners = outline.map((p, i) => {
      const prev = outline[(i + nV - 1) % nV]
      const next = outline[(i + 1) % nV]
      const a = [prev[0] - p[0], prev[1] - p[1]]
      const b = [next[0] - p[0], next[1] - p[1]]
      const la = Math.hypot(a[0], a[1]) || 1
      const lb = Math.hypot(b[0], b[1]) || 1
      const cos = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))
      return deg(Math.acos(cos))
    })
    // Edges: ring[i] → ring[i+1].
    const edges = ring.map((va, i) => {
      const vb = ring[(i + 1) % nV]
      const a = outline[i]
      const b = outline[(i + 1) % nV]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const eid = edgeByKey.get(`${Math.min(va, vb)}:${Math.max(va, vb)}`)
      const edge = eid !== undefined ? model.edges[eid] : undefined
      let bevel = 0
      let boundary = true
      if (edge && edge.faceIds.length === 2 && Number.isFinite(edge.dihedralDeg)) {
        bevel = (180 - edge.dihedralDeg) / 2
        boundary = false
      } else if (leveledBase) {
        bevel = Math.max(0, 90 - deg(Math.acos(Math.min(1, Math.abs(n[2])))))
      }
      return { len, bevel, boundary, edgeId: eid ?? -1 }
    })
    return { ring, outline, corners, edges }
  })

  // ---- Group by canonical cyclic signature ----
  const sigOf = (g: PanelGeom): string => {
    const nV = g.edges.length
    const entry = (ei: number, ci: number) =>
      `${r1(g.edges[ei].len)}|${r1(g.edges[ei].bevel)}|${r1(g.corners[ci])}`
    const candidates: string[] = []
    for (let s = 0; s < nV; s++) {
      const fwd: string[] = []
      const rev: string[] = []
      for (let k = 0; k < nV; k++) {
        const ef = (s + k) % nV
        fwd.push(entry(ef, ef))
        // Reversed traversal: edge (s−k) with its END corner as the start.
        const er = (s - k + 2 * nV) % nV
        rev.push(entry(er, (er + 1) % nV))
      }
      candidates.push(fwd.join(';'), rev.join(';'))
    }
    return candidates.sort()[0]
  }
  const groups = new Map<string, { rep: PanelGeom; count: number }>()
  for (const g of geoms) {
    const sig = sigOf(g)
    const cur = groups.get(sig)
    if (cur) cur.count++
    else groups.set(sig, { rep: g, count: 1 })
  }

  const sorted = [...groups.values()].sort((a, b) => b.count - a.count)
  const types: FrameType[] = sorted.map((grp, ti) => {
    const g = grp.rep
    const nV = g.edges.length
    // Dedupe identical member cuts within the panel.
    const specs = new Map<string, FrameMemberSpec>()
    g.edges.forEach((e, i) => {
      const ms = g.corners[i] / 2
      const me = g.corners[(i + 1) % nV] / 2
      const [a, b] = ms <= me ? [ms, me] : [me, ms]
      const key = `${r1(e.len)}|${r1(e.bevel)}|${r1(a)}|${r1(b)}|${e.boundary}`
      const cur = specs.get(key)
      if (cur) cur.count++
      else
        specs.set(key, {
          label: '',
          count: 1,
          longPointLength: e.len,
          miterStartDeg: a,
          miterEndDeg: b,
          bevelDeg: e.bevel,
          boundary: e.boundary,
        })
    })
    const members = [...specs.values()]
    members.forEach((m, i) => (m.label = `F${ti + 1}-${String.fromCharCode(97 + i)}`))
    return {
      label: `F${ti + 1}`,
      panelCount: grp.count,
      sides: nV,
      members,
      outline: g.outline,
      cornerAnglesDeg: g.corners,
    }
  })

  // ---- Seams + bolts ----
  const keptFaces = new Set(kept.flatMap((u) => u.faceIds))
  const spacing = units === 'imperial' ? 16 : 400
  let seamCount = 0
  let totalSeamLength = 0
  let boltCount = 0
  for (const e of model.edges) {
    if (e.faceIds.length !== 2) continue
    if (doorway.removedEdges.has(e.id) || doorway.trimmedEdges.has(e.id)) continue
    if (!e.faceIds.every((f) => keptFaces.has(f))) continue
    const len = e.chordFactor * radius
    seamCount++
    totalSeamLength += len
    boltCount += Math.max(2, Math.ceil(len / spacing))
  }

  return {
    types,
    totalPanels: kept.length,
    totalMembers: types.reduce((s, t) => s + t.panelCount * t.sides, 0),
    seamCount,
    totalSeamLength,
    boltCount,
    omittedPanels,
  }
}
```

- [ ] **Step 4: Tests pass** (`bun run test 2>&1 | tail -4` — 139 tests: 133 + 6).

- [ ] **Step 5: Commit**

```bash
bun run test > /tmp/t.out 2>&1; RC=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && git add src/engine/panelFrames.ts src/engine/__tests__/panelFrames.test.ts && git commit -m "feat: panel-frame engine — miters, seam bevels, frame types, seams

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Joint method, cut list, BOM, CSV, composable

**Files:**
- Modify: `src/engine/cutlist.ts` (JOINT_METHODS + framed-panel rows)
- Modify: `src/engine/bom.ts` (framed-panel branch)
- Modify: `src/engine/exports/csv.ts` (`framesCsv`)
- Modify: `src/composables/useDomeProject.ts` (framePlan computed + exporter)
- Test: `src/engine/__tests__/panelFrames.test.ts` (append)

**Interfaces:**
- Consumes: `buildPanelFrames` (Task 1).
- Produces: `JointMethodId` incl. `'framed-panel'`; `buildCutList(model, opts, doorway, riser, framePlan?)` — when `opts.jointId === 'framed-panel'` and framePlan given, strut rows are replaced by member rows (kind 'strut', label `F1-a`, quantity = memberSpec.count × type.panelCount, cutLength = long-point length rounded per increment, `axialAngleDeg: NaN`); `buildBom(model, doorway, riser, jointId, panelPlan, framePlan?)` framed-panel branch: bolts = framePlan.boltCount (+nuts, +2× washers), NO hub/structural-screw lines, framing screws + anchors + panel screws unchanged; `framesCsv(plan, units): string` — header `type,member,qty,long_point,miter_start_deg,miter_end_deg,bevel_deg,boundary` + one row per member spec; composable exports `framePlan` computed (null unless framed-panel) and `exporters.framesCsv`.

- [ ] **Step 1: Append tests** — framed-panel cut list rows replace strut rows and packing still packs them (row count = Σ distinct specs; every row `Number.isNaN(axialAngleDeg)`); BOM contains a bolt line with quantity === plan.boltCount and no `hub-connector`/`hub-plate` lines; CSV line count = 1 + Σ distinct member specs. Follow the existing test file's helper conventions (buildCutList/packCuts call shapes are used in engine.test.ts — mirror them).
- [ ] **Step 2: Run to fail, implement, run to pass** (build + test both green; vue-tsc catches signature ripples at the composable).
- [ ] **Step 3: Composable** — `framePlan = computed(() => state.jointId === 'framed-panel' ? buildPanelFrames(model.value, radius.value, state.units, doorway.value) : null)`; thread it into the existing `cutList`/`bom` computed calls; exporter `framesCsv` follows the sibling exporter pattern (guard null). Export `framePlan` from the return.
- [ ] **Step 4: Commit** (gated): `feat: framed-panel joint method — cut list, BOM, frames CSV`.

---

### Task 3: Jig drawings SVG

**Files:**
- Create: `src/engine/exports/frames.ts`
- Modify: `src/composables/useDomeProject.ts` (exporter `frameJigs`)
- Test: `src/engine/__tests__/panelFrames.test.ts` (append 1)

**Interfaces:**
- Consumes: `PanelFramePlan`; `PAPER`, `esc` from `./paper`; `formatLength` from `../units`.
- Produces: `frameJigsSvg(plan: PanelFramePlan, units: UnitSystem, title: string): string` — one page per frame type: scaled outline drawing, per-edge member label + long-point length + bevel (`data-bevel` attribute per edge), corner miter angles, `build ⟨panelCount⟩` header, footer notes (seam bolts spacing; "corners: cut members back at the miter — small point clash at panel corners is a build detail"; goldberg near-planar note when any type has > 4 sides). Page container carries `data-frame-page="⟨n⟩"`.

- [ ] Steps: test asserts one `data-frame-page` per type and ≥1 `data-bevel` per page for a 3V leveled plan; implement following `patterns.ts` page/scale conventions (read it first); wire exporter + Export return; gated commit `feat: panel jig drawing SVG`.

---

### Task 4: True-size 3D rendering

**Files:**
- Modify: `src/lib/three-builders.ts`
- Modify: `src/components/DomeViewer.vue`

**Interfaces:**
- Consumes: existing `clipSolid`, `strutFaceMaps` pick registry, `BuildOptions.jointId/strutSection`; panel rings via `model.polys`/`model.rhombi`/faces (same unit logic as the engine — extract a tiny shared helper or duplicate the 15-line ring builder with a comment).
- Produces: when `jointMode && opts.jointId === 'framed-panel'`: no hub/strut/plate geometry; per kept panel, per outline edge, one member solid: box cross-section = section thickness (rect width; round OD) in-plane inward × section depth along −normal inward, length extended past both corners, then clipped by (a) the two corner-bisector half-planes (plane containing the panel normal and the corner bisector direction; keep the member side), (b) for interior edges the seam plane spanned by the edge direction and the average of the two adjacent panel normals (keep the member's panel side), (c) for leveled boundary edges the foundation plane z = cutZ·radius. Register each member's triangles in `strutFaceMaps` under its edgeId. Panels/skin render as in assembly; doorway-removed panels skipped.

- [ ] Steps: read the mitered rendering block first (`miterStruts` / `seamNormals` / `clipSolid` usage) and mirror its structure; DomeViewer already passes `jointId` — confirm no wiring change needed beyond true-size gating (framed-panel must NOT suppress `strutSection`; it requires it like other joint modes). Build + tests gated; commit `feat: true-size framed-panel rendering — doubled seams via convex clipping`.

---

### Task 5: UI

**Files:**
- Modify: `src/components/panels/StrutsPanel.vue` (frames table branch)
- Modify: `src/components/panels/HubsPanel.vue` (no-hubs note branch)
- Modify: `src/components/panels/ExportPanel.vue` (conditional items)
- Modify: `src/engine/exports/guide.ts` (one cover line when framed-panel — thread a boolean opt)

**Interfaces:**
- Consumes: `framePlan` (Task 2), `exporters.frameJigs` / `exporters.framesCsv` (Tasks 2–3).
- Produces: StrutsPanel: when `state.jointId === 'framed-panel' && framePlan`, render per-type sections (header `F1 — build 30 · 3 sides`) with member rows (label, qty total = count×panelCount, long-point length via formatLength, `miterStart/End°`, `bevel°`, `sill` badge when boundary) instead of the cut-list table; summary line `⟨totalPanels⟩ panels · ⟨seamCount⟩ seams · ⟨boltCount⟩ bolts`; disclosure paragraph (openings omitted → site-framed). HubsPanel: short note replacing the table ("No hubs — framed panels bolt edge-to-edge. See Parts → frame schedule."). ExportPanel: hide Cut templates SVG / Hub labels SVG / Miter cuts CSV when framed-panel; add "Panel jig drawings SVG" + "Frames CSV". Assembly guide cover gains `Framed-panel build: place whole panels in the same course order.` when active.

- [ ] Steps: implement, build + tests gated, commit `feat: framed-panel UI — frame schedule, exports, guide note`.

---

### Task 6: Live verification

- [ ] Geodesic 3V leveled + framed-panel: Parts tab shows F-types with plausible miters (~26–30°) and bevels (~4–8°); true-size 3D shows doubled members at seams (screenshot, zoom a seam); jig SVG downloads with one page per type; frames CSV rows match; Costs shows seam bolts, no hub lines.
- [ ] Zome Z8 + framed-panel: 4-sided frames render; hex/pent 2V: 5/6-sided frames render (screenshots).
- [ ] Add a door: panel count drops, disclosure visible; no crashes.
- [ ] Switch back to hub method: everything restores.
- [ ] Fix-forward commits gated on build+tests.
