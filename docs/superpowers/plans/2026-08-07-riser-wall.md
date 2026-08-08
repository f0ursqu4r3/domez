# Riser Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A configurable stud-framed riser (knee) wall under the dome's base ring, fully taken off in the cut list, board packing, and panel sheet plan, with doors cutting through it to the foundation.

**Architecture:** The dome model is untouched — the riser is a pure additive engine module (`riser.ts`) built from the ordered base-ring polygon, extending from the base plane (z = cutZ·r) down to the foundation (z = cutZ·r − h). Portal (door/window) dimensions become floor-referenced when a riser is active: `doorway.ts` gains a `riserHeight` option and converts to base-plane coordinates internally. Downstream systems (cut list, packing, panels, optimizer, renderer, persistence) each consume the new `RiserModel` through their existing extension points.

**Tech Stack:** Vue 3 + TypeScript, pure-TS engine in `src/engine/`, Three.js rendering in `src/lib/three-builders.ts`, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-08-07-riser-wall-design.md`

## Global Constraints

- Package manager is **bun**: run tests with `bunx vitest run src/engine/__tests__/engine.test.ts`, typecheck+build with `bun run build`.
- All engine functions take/return **working units** (inches or mm); UI state stores **canonical mm** (`riserHeightMm`).
- Riser requires **leveled base** (`baseMode: 'leveled'`) and a truncated dome (`fraction !== 'full'`); `buildRiser` returns `null` otherwise (planarity guard in the engine, gating in the composable/UI).
- Riser stud spacing is 16″ imperial / 400 mm metric, **independent of** the `closeDoorways` toggle (a riser is a real wall, not an optional closure).
- Doors keep their **rough-opening width** through the riser (`spec.width`, no margin — margin is a shell trim zone only).
- Windows never cut the riser: `sill − riser − margin < 0` ⇒ `riserConflict`, portal excluded from cutting (fits = false).
- Existing behavior with `riserHeight = 0` must be bit-identical (all 47 existing tests keep passing untouched, except none should need edits).
- Commit after every task; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File map

| File | Change |
|---|---|
| `src/engine/riser.ts` | **Create** — ring walk, wall framing, door openings, sheathing |
| `src/engine/doorway.ts` | Floor-referenced portals: `riserHeight` option, `buckBottomRel`/`buckTopRel`/`riserConflict` on `DoorFrameInfo` |
| `src/engine/cutlist.ts` | `buildCutList(..., riser?)` — riser member rows |
| `src/engine/panels.ts` | Rectangle nesting: `opts.rects`, `PanelPlan.rects` |
| `src/engine/optimize.ts` | `riserHeight`/`riserMemberWidth` options; riser rows per candidate |
| `src/engine/exports/json.ts` | `ProjectSettings.riserHeightMm` |
| `src/composables/useDomeProject.ts` | State, computeds, persistence, reset, load/save |
| `src/lib/three-builders.ts` | Riser rendering; buck placement via `buckBottomRel`/`buckTopRel` |
| `src/components/DomeViewer.vue` | Pass riser, floor grid at foundation, window-click height from floor |
| `src/components/panels/ParametersPanel.vue` | Riser height input (gated on leveled base) |
| `src/components/panels/FramedOpeningCard.vue` | Riser-conflict warnings |
| `src/components/panels/MaterialsPanel.vue` | Riser sheathing rows (R groups) |
| `src/engine/__tests__/engine.test.ts` | New `describe` blocks per task |

---

### Task 1: Riser engine core — ring walk, plates, studs, sheathing

**Files:**
- Create: `src/engine/riser.ts`
- Test: `src/engine/__tests__/engine.test.ts` (append `describe('riser wall', ...)`)

**Interfaces:**
- Consumes: `DomeModel` from `./types` (`vertices[].position` unit-sphere, `edges[].faceIds`, `cutZ`).
- Produces (later tasks rely on these exact names):

```ts
export interface RiserMember {
  part: 'riser top plate' | 'riser bottom plate' | 'riser stud' | 'riser king stud' | 'riser trimmer'
  /** Cut length, working units. */
  length: number
  quantity: number
  /** World endpoints, engine frame (z up), working units. */
  a: [number, number, number]
  b: [number, number, number]
}

export interface RiserSegment {
  /** Top corners on the base plane (world, working units). a→b is CCW around the ring. */
  a: [number, number, number]
  b: [number, number, number]
  length: number
  /** Door-opening intervals as distances along a→b. */
  openings: [number, number][]
}

export interface RiserModel {
  height: number
  perimeter: number
  segments: RiserSegment[]
  members: RiserMember[]
  jointNodes: [number, number, number][]
  jointCount: number
  /** One rect per segment (full gross rect even when a door cuts it out). */
  sheathingRects: { w: number; h: number }[]
  grossSheathingArea: number
  openingArea: number
  netSheathingArea: number
}

export interface RiserOptions {
  /** Wall height, working units. ≤ 0 disables. */
  height: number
  /** Stud spacing o.c. (16 / 400). */
  studSpacing: number
  /** Member width for king-stud offsets, working units. */
  memberWidth: number
  /** Plate pieces / stud bays shorter than this are dropped as scrap. */
  minStubLength: number
  /** Doors that cut through the wall (windows never do). Working units. */
  doors?: DoorSpec[]
}

export function orderedBaseRing(model: DomeModel): number[]
export function buildRiser(model: DomeModel, radius: number, opts: RiserOptions): RiserModel | null
```

Task 1 implements everything except `opts.doors` handling (openings stay empty; Task 2 adds them).

- [ ] **Step 1: Write the failing tests**

Append to `engine.test.ts` (imports at top: `import { buildRiser, orderedBaseRing } from '../riser'`):

```ts
describe('riser wall', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150 // inches
  const opts = { height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6 }
  const boundaryEdgeCount = model.edges.filter((e) => e.faceIds.length === 1).length

  it('walks the base ring in order', () => {
    const ring = orderedBaseRing(model)
    expect(ring.length).toBe(boundaryEdgeCount)
    // Every consecutive pair is a boundary edge.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      expect(
        model.edges.some(
          (e) => e.faceIds.length === 1 && Math.min(e.v0, e.v1) === Math.min(a, b) && Math.max(e.v0, e.v1) === Math.max(a, b),
        ),
      ).toBe(true)
    }
    // CCW from +z: positive signed area.
    let area2 = 0
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = model.vertices[ring[i]].position
      const [x1, y1] = model.vertices[ring[(i + 1) % ring.length]].position
      area2 += x0 * y1 - x1 * y0
    }
    expect(area2).toBeGreaterThan(0)
  })

  it('builds one segment per base-ring edge with plates top and bottom', () => {
    const riser = buildRiser(model, radius, opts)!
    expect(riser).not.toBeNull()
    expect(riser.segments.length).toBe(boundaryEdgeCount)
    const tops = riser.members.filter((m) => m.part === 'riser top plate')
    const bottoms = riser.members.filter((m) => m.part === 'riser bottom plate')
    expect(tops.length).toBe(boundaryEdgeCount)
    expect(bottoms.length).toBe(boundaryEdgeCount)
    const plateTotal = [...tops, ...bottoms].reduce((s, m) => s + m.length, 0)
    expect(plateTotal).toBeCloseTo(2 * riser.perimeter, 6)
    // Plates live on their planes.
    const zTop = model.cutZ * radius
    for (const m of tops) expect(m.a[2]).toBeCloseTo(zTop, 6)
    for (const m of bottoms) expect(m.a[2]).toBeCloseTo(zTop - opts.height, 6)
  })

  it('spaces studs on centers and posts every corner once', () => {
    const riser = buildRiser(model, radius, opts)!
    const studs = riser.members.filter((m) => m.part === 'riser stud')
    // One corner stud per ring vertex...
    const ring = orderedBaseRing(model)
    const cornerStuds = studs.filter((m) =>
      ring.some((vi) => {
        const p = model.vertices[vi].position
        return Math.hypot(m.a[0] - p[0] * radius, m.a[1] - p[1] * radius) < 1e-6
      }),
    )
    expect(cornerStuds.length).toBe(ring.length)
    // ...plus field studs: per segment, floor((L - minStub) / spacing) at most.
    for (const m of studs) {
      expect(m.length).toBeCloseTo(opts.height, 6)
      expect(m.b[2] - m.a[2]).toBeCloseTo(opts.height, 6)
    }
    const fieldStuds = studs.length - cornerStuds.length
    const expected = riser.segments.reduce(
      (n, s) => n + Math.max(0, Math.floor((s.length - opts.minStubLength) / opts.studSpacing)),
      0,
    )
    expect(fieldStuds).toBe(expected)
  })

  it('reports sheathing area and joints', () => {
    const riser = buildRiser(model, radius, opts)!
    expect(riser.grossSheathingArea).toBeCloseTo(riser.perimeter * opts.height, 4)
    expect(riser.netSheathingArea).toBeCloseTo(riser.grossSheathingArea, 4) // no doors yet
    expect(riser.sheathingRects.length).toBe(riser.segments.length)
    expect(riser.jointCount).toBeGreaterThan(0)
    expect(riser.jointNodes.length).toBe(riser.jointCount)
  })

  it('returns null when disabled or inapplicable', () => {
    expect(buildRiser(model, radius, { ...opts, height: 0 })).toBeNull()
    const natural = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    expect(buildRiser(natural, radius, opts)).toBeNull()
    const full = generateDome({ frequency: 3, fraction: 'full' })
    expect(buildRiser(full, radius, opts)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts -t 'riser wall'`
Expected: FAIL — `Cannot find module '../riser'`.

- [ ] **Step 3: Implement `src/engine/riser.ts`**

```ts
import type { DomeModel } from './types'
import type { DoorSpec } from './doorway'

// (interfaces exactly as in the Interfaces block above)

/** Base-ring vertex ids in CCW order viewed from +z. Empty for full spheres. */
export function orderedBaseRing(model: DomeModel): number[] {
  const nbrs = new Map<number, number[]>()
  for (const e of model.edges) {
    if (e.faceIds.length !== 1) continue
    if (!nbrs.has(e.v0)) nbrs.set(e.v0, [])
    if (!nbrs.has(e.v1)) nbrs.set(e.v1, [])
    nbrs.get(e.v0)!.push(e.v1)
    nbrs.get(e.v1)!.push(e.v0)
  }
  if (nbrs.size === 0) return []
  const start = Math.min(...nbrs.keys())
  const ring = [start]
  let prev = -1
  let cur = start
  for (;;) {
    const n = nbrs.get(cur)!
    const nxt = n[0] === prev ? n[1] : n[0]
    if (nxt === undefined || nxt === start) break
    ring.push(nxt)
    prev = cur
    cur = nxt
  }
  let area2 = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = model.vertices[ring[i]].position
    const [x1, y1] = model.vertices[ring[(i + 1) % ring.length]].position
    area2 += x0 * y1 - x1 * y0
  }
  if (area2 < 0) ring.reverse()
  return ring
}

export function buildRiser(model: DomeModel, radius: number, opts: RiserOptions): RiserModel | null {
  if (opts.height <= 0) return null
  const ring = orderedBaseRing(model)
  if (ring.length < 3) return null
  // Planarity guard: the wall needs a leveled (planar) base ring.
  const zTop = model.cutZ * radius
  for (const vi of ring) {
    if (Math.abs(model.vertices[vi].position[2] * radius - zTop) > 1e-6 * radius) return null
  }
  const h = opts.height
  const zBot = zTop - h

  const members: RiserMember[] = []
  const segments: RiserSegment[] = []
  const sheathingRects: { w: number; h: number }[] = []
  let perimeter = 0
  let openingArea = 0

  // Corner studs: one per hub, shared by both adjacent segments.
  for (const vi of ring) {
    const x = model.vertices[vi].position[0] * radius
    const y = model.vertices[vi].position[1] * radius
    members.push({ part: 'riser stud', length: h, quantity: 1, a: [x, y, zBot], b: [x, y, zTop] })
  }

  for (let i = 0; i < ring.length; i++) {
    const p0 = model.vertices[ring[i]].position
    const p1 = model.vertices[ring[(i + 1) % ring.length]].position
    const ax = p0[0] * radius, ay = p0[1] * radius
    const bx = p1[0] * radius, by = p1[1] * radius
    const L = Math.hypot(bx - ax, by - ay)
    const dx = (bx - ax) / L, dy = (by - ay) / L
    perimeter += L
    const at = (d: number): [number, number] => [ax + dx * d, ay + dy * d]

    const openings = openingIntervals(/* Task 2; [] in Task 1 */)
    segments.push({ a: [ax, ay, zTop], b: [bx, by, zTop], length: L, openings })
    sheathingRects.push({ w: L, h })
    for (const [d0, d1] of openings) openingArea += (d1 - d0) * h

    // Plates: full span minus openings, both planes.
    const kept: [number, number][] = []
    let cursor = 0
    for (const [d0, d1] of openings) {
      if (d0 > cursor + 1e-9) kept.push([cursor, d0])
      cursor = Math.max(cursor, d1)
    }
    if (cursor < L - 1e-9) kept.push([cursor, L])
    for (const [d0, d1] of kept) {
      if (d1 - d0 < opts.minStubLength) continue
      const [x0, y0] = at(d0)
      const [x1, y1] = at(d1)
      members.push({ part: 'riser top plate', length: d1 - d0, quantity: 1, a: [x0, y0, zTop], b: [x1, y1, zTop] })
      members.push({ part: 'riser bottom plate', length: d1 - d0, quantity: 1, a: [x0, y0, zBot], b: [x1, y1, zBot] })
    }

    // Field studs on centers, skipping opening zones (± memberWidth) and
    // the corner-stud neighborhood at the segment end.
    for (let d = opts.studSpacing; d <= L - opts.minStubLength; d += opts.studSpacing) {
      const inOpening = openings.some(([d0, d1]) => d > d0 - opts.memberWidth && d < d1 + opts.memberWidth)
      if (inOpening) continue
      const [x, y] = at(d)
      members.push({ part: 'riser stud', length: h, quantity: 1, a: [x, y, zBot], b: [x, y, zTop] })
    }

    // King + trimmer at each opening edge (Task 2 fills openingIntervals).
    for (const [d0, d1] of openings) {
      for (const [dEdge, dir] of [[d0, -1], [d1, 1]] as const) {
        if (dEdge < opts.minStubLength || dEdge > L - opts.minStubLength) continue
        const [tx, ty] = at(dEdge)
        members.push({ part: 'riser trimmer', length: h, quantity: 1, a: [tx, ty, zBot], b: [tx, ty, zTop] })
        const [kx, ky] = at(dEdge + dir * opts.memberWidth)
        members.push({ part: 'riser king stud', length: h, quantity: 1, a: [kx, ky, zBot], b: [kx, ky, zTop] })
      }
    }
  }

  // Joints: deduped member endpoints (0.5-working-unit grid, same as closures).
  const seen = new Set<string>()
  const jointNodes: [number, number, number][] = []
  for (const m of members) {
    for (const p of [m.a, m.b]) {
      const key = `${Math.round(p[0] * 2)}:${Math.round(p[1] * 2)}:${Math.round(p[2] * 2)}`
      if (seen.has(key)) continue
      seen.add(key)
      jointNodes.push(p)
    }
  }

  const gross = perimeter * h
  return {
    height: h,
    perimeter,
    segments,
    members,
    jointNodes,
    jointCount: jointNodes.length,
    sheathingRects,
    grossSheathingArea: gross,
    openingArea,
    netSheathingArea: gross - openingArea,
  }
}
```

In Task 1, `openingIntervals(...)` is a local function returning `[]` (signature `(): [number, number][]`); Task 2 replaces it. The field-stud loop condition `d <= L - opts.minStubLength` IS the sliver rule: no stud lands within the scrap floor of the corner stud.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts`
Expected: all tests PASS (existing 47 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/engine/riser.ts src/engine/__tests__/engine.test.ts
git commit -m "feat: riser wall engine core — ring walk, plates, studs, sheathing"
```

---

### Task 2: Door openings in the riser wall

**Files:**
- Modify: `src/engine/riser.ts` (implement `openingIntervals`)
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: `DoorSpec` (`azimuthDeg`, `width` working units; `sillHeight` distinguishes windows).
- Produces: `RiserSegment.openings` populated; `riser king stud` / `riser trimmer` members; interrupted plates; `openingArea > 0`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('riser wall — door openings', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150
  const base = { height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6 }
  const door: DoorSpec = { id: 'D1', azimuthDeg: 0, width: 48, height: 90 }

  it('cuts the door span out of both plates and adds king/trimmer studs', () => {
    const riser = buildRiser(model, radius, { ...base, doors: [door] })!
    const withOpenings = riser.segments.filter((s) => s.openings.length > 0)
    expect(withOpenings.length).toBeGreaterThan(0)
    const totalOpening = riser.segments.flatMap((s) => s.openings).reduce((n, [d0, d1]) => n + (d1 - d0), 0)
    // The ring is polygonal, so the opening chord ≈ door width (within 5%).
    expect(totalOpening).toBeGreaterThan(door.width * 0.95)
    expect(totalOpening).toBeLessThan(door.width * 1.3)
    expect(riser.members.some((m) => m.part === 'riser trimmer')).toBe(true)
    expect(riser.members.some((m) => m.part === 'riser king stud')).toBe(true)
    // No plate piece crosses an opening.
    for (const seg of riser.segments) {
      for (const [d0, d1] of seg.openings) {
        const mid = [(seg.a[0] + seg.b[0]) / 2, 0]
        void mid
        for (const m of riser.members) {
          if (m.part !== 'riser top plate' && m.part !== 'riser bottom plate') continue
          // Project plate endpoints onto this segment's direction.
          const dx = (seg.b[0] - seg.a[0]) / seg.length
          const dy = (seg.b[1] - seg.a[1]) / seg.length
          const pa = (m.a[0] - seg.a[0]) * dx + (m.a[1] - seg.a[1]) * dy
          const pb = (m.b[0] - seg.a[0]) * dx + (m.b[1] - seg.a[1]) * dy
          const onSeg = Math.min(pa, pb) > -1e-6 && Math.max(pa, pb) < seg.length + 1e-6 &&
            Math.abs((m.a[0] - seg.a[0]) * dy - (m.a[1] - seg.a[1]) * dx) < 1e-6
          if (!onSeg) continue
          const overlap = Math.min(Math.max(pa, pb), d1) - Math.max(Math.min(pa, pb), d0)
          expect(overlap).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('drops field studs inside the opening and subtracts opening sheathing', () => {
    const cut = buildRiser(model, radius, { ...base, doors: [door] })!
    const plain = buildRiser(model, radius, base)!
    expect(cut.openingArea).toBeGreaterThan(0)
    expect(cut.netSheathingArea).toBeCloseTo(cut.grossSheathingArea - cut.openingArea, 4)
    const fieldStuds = (r: RiserModel) => r.members.filter((m) => m.part === 'riser stud').length
    expect(fieldStuds(cut)).toBeLessThanOrEqual(fieldStuds(plain))
  })

  it('ignores windows and doors on the far side', () => {
    const win: DoorSpec = { id: 'W1', azimuthDeg: 0, width: 36, height: 36, sillHeight: 60 }
    const far: DoorSpec = { id: 'D9', azimuthDeg: 180, width: 48, height: 90 }
    const riser = buildRiser(model, radius, { ...base, doors: [win] })!
    expect(riser.openingArea).toBe(0)
    const riserFar = buildRiser(model, radius, { ...base, doors: [far, door] })!
    // Far door opens the far side; both doors produce openings, near ones at azimuth ~0.
    expect(riserFar.segments.filter((s) => s.openings.length > 0).length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts -t 'door openings'`
Expected: FAIL — no openings (openingIntervals returns []).

- [ ] **Step 3: Implement `openingIntervals`**

Inside `buildRiser`, filter doors once up front (`const doors = (opts.doors ?? []).filter((d) => !((d.sillHeight ?? 0) > 0))`), then per segment:

```ts
/** Intervals of the segment inside a door's rough-opening strip
 * (|tangential| ≤ width/2 on the door's near side, u > 0). */
const openingIntervals = (ax: number, ay: number, bx: number, by: number, L: number): [number, number][] => {
  const raw: [number, number][] = []
  for (const d of doors) {
    const az = (d.azimuthDeg * Math.PI) / 180
    const ux = Math.cos(az), uy = Math.sin(az)
    let s0 = 0, s1 = 1
    const clip = (fa: number, fb: number, lo: number, hi: number): boolean => {
      const df = fb - fa
      if (Math.abs(df) < 1e-12) return fa >= lo && fa <= hi
      let t0 = (lo - fa) / df, t1 = (hi - fa) / df
      if (t0 > t1) [t0, t1] = [t1, t0]
      s0 = Math.max(s0, t0); s1 = Math.min(s1, t1)
      return s1 > s0
    }
    const tA = -uy * ax + ux * ay, tB = -uy * bx + ux * by
    const uA = ux * ax + uy * ay, uB = ux * bx + uy * by
    s0 = 0; s1 = 1
    if (!clip(tA, tB, -d.width / 2, d.width / 2)) continue
    if (!clip(uA, uB, 0, 1e12)) continue
    if (s1 - s0 > 1e-9) raw.push([s0 * L, s1 * L])
  }
  raw.sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const iv of raw) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1])
    else merged.push([...iv] as [number, number])
  }
  return merged
}
```

Call it with the segment's endpoints/length; the Task 1 skeleton already consumes the result (plates, studs, king/trimmer, openingArea).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/riser.ts src/engine/__tests__/engine.test.ts
git commit -m "feat: doors cut through the riser wall — interrupted plates, king/trimmer studs"
```

---

### Task 3: Floor-referenced portals in doorway.ts

**Files:**
- Modify: `src/engine/doorway.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**
- `DoorwayOptions` gains `riserHeight?: number` (working units, ≥ 0; 0/undefined = today's behavior exactly).
- `DoorFrameInfo` gains:

```ts
/** Opening bottom relative to the BASE plane; negative when the riser drops
 * the floor below it. Equals sillHeight (or 0) when no riser. */
buckBottomRel: number
/** Opening top relative to the base plane: buckBottomRel + height. */
buckTopRel: number
/** True when the riser makes the portal unbuildable (door not taller than
 * the riser; window sill inside the riser band incl. margin). Forces fits=false. */
riserConflict: boolean
```

- `PlacementOptions` inherits `riserHeight` via `DoorwayOptions`; `placementStats` forwards it.

- [ ] **Step 1: Write the failing tests**

```ts
describe('portals over a riser wall', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150
  const opts = { minStubLength: 6, riserHeight: 24 }
  const door: DoorSpec = { id: 'D1', azimuthDeg: 0, width: 48, height: 90 }

  it('shrinks the shell cut to the part above the base plane', () => {
    const withRiser = cutDoorways(model, [door], radius, opts)
    const without = cutDoorways(model, [{ ...door, height: door.height - 24 }], radius, { minStubLength: 6 })
    // A 90″ door over a 24″ riser cuts the shell exactly like a 66″ door on the ground.
    expect(withRiser.removedEdges.size).toBe(without.removedEdges.size)
    expect(withRiser.trimmed.length).toBe(without.trimmed.length)
    const info = withRiser.doors[0]
    expect(info.buckBottomRel).toBeCloseTo(-24, 9)
    expect(info.buckTopRel).toBeCloseTo(66, 9)
    expect(info.jambLength).toBeCloseTo(90, 9) // full height through the riser
    expect(info.riserConflict).toBe(false)
  })

  it('flags a door not taller than the riser', () => {
    const stub = cutDoorways(model, [{ ...door, height: 20 }], radius, opts)
    expect(stub.doors[0].riserConflict).toBe(true)
    expect(stub.doors[0].fits).toBe(false)
    expect(stub.removedEdges.size).toBe(0)
    expect(stub.trimmed.length).toBe(0)
  })

  it('windows: sill measured from the floor, conflict when it dips into the riser', () => {
    const win: DoorSpec = { id: 'W1', azimuthDeg: 0, width: 36, height: 36, sillHeight: 60, margin: 2 }
    const cut = cutDoorways(model, [win], radius, opts)
    const info = cut.doors[0]
    expect(info.buckBottomRel).toBeCloseTo(36, 9) // 60 − 24 above the base plane
    expect(info.riserConflict).toBe(false)
    // Same shell cut as a no-riser window with sill 36.
    const equiv = cutDoorways(model, [{ ...win, sillHeight: 36 }], radius, { minStubLength: 6 })
    expect(cut.removedEdges.size).toBe(equiv.removedEdges.size)
    expect(cut.trimmed.length).toBe(equiv.trimmed.length)
    // Sill inside the riser band (incl. margin) conflicts.
    const low = cutDoorways(model, [{ ...win, sillHeight: 25 }], radius, opts)
    expect(low.doors[0].riserConflict).toBe(true)
    expect(low.doors[0].fits).toBe(false)
  })

  it('riserHeight 0 or omitted is bit-identical to today', () => {
    const a = cutDoorways(model, [door], radius, { minStubLength: 6 })
    const b = cutDoorways(model, [door], radius, { minStubLength: 6, riserHeight: 0 })
    expect(b.doors[0].buckBottomRel).toBe(0)
    expect(b.doors[0].buckTopRel).toBeCloseTo(door.height, 12)
    expect(a.removedEdges.size).toBe(b.removedEdges.size)
    expect(a.trimmed.length).toBe(b.trimmed.length)
    expect(a.doors[0].closureSideArea).toBeCloseTo(b.doors[0].closureSideArea, 9)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts -t 'portals over a riser'`
Expected: FAIL — `buckBottomRel` undefined.

- [ ] **Step 3: Implement in `cutDoorways`**

In the per-door loop (currently `doorway.ts:396-410`), after `const sill = ...`:

```ts
const riser = Math.max(0, opts.riserHeight ?? 0)
const isWindow = sill > 0
// Portal dims are floor-referenced; the shell works from the base plane.
const buckBottomRel = isWindow ? sill - riser : -riser
const buckTopRel = buckBottomRel + spec.height
const riserConflict = riser > 0 && (isWindow ? buckBottomRel - margin < 0 : buckTopRel <= 0)
```

Then replace the base-plane math:
- `const zBotAbs = z0 + Math.max(0, buckBottomRel)` (buck below the base plane doesn't constrain the sphere — the riser is there)
- `const zTopAbs = z0 + buckTopRel`
- `const fits = fitSq > 0 && !riserConflict`
- `const zLowRel = isWindow ? Math.max(0, buckBottomRel - margin) : 0`
- `const zHighRel = buckTopRel + margin`
- Closure/framing/plane blocks: unchanged (they consume `zLowRel`/`zHighRel`), but guard the whole `if (fits)` block with the new `fits` so a conflicted portal produces no closure.
- Face band area: `closureFaceArea: fits ? 2 * halfEnv * (zHighRel - zLowRel) - spec.width * Math.max(0, Math.min(buckTopRel, zHighRel) - Math.max(buckBottomRel, zLowRel)) : 0` (reduces to the old `− width × height` when riser = 0).
- Buck-corner joints: replace `sill` / `sill + spec.height` with `buckBottomRel` / `buckTopRel` in the four `jkey(9, ...)` calls.
- `perDoor.set`: add `buckBottomRel, buckTopRel, riserConflict`.
- `frames.push`: `zClipLow: isWindow ? zLowRel : -1e9` (unchanged form), `zClipHigh: zHighRel`. When `riserConflict`, skip pushing the frame entirely (no cutting).
- `planeMembers(bottom, ...)` guard stays `sill > 0` → change to `isWindow && zLowRel > 0`? No — keep `isWindow` (bottom profile exists only for windows; `zLowRel` may legitimately be > 0). Concretely: `const bottom = isWindow ? planeProfile(zLowEnv) : []` and `if (isWindow) planeMembers(bottom, 'sill blocking', 'sill edge')`.
- In `placementStats`: forward the option — `cutDoorways(model, [spec], radius, { minStubLength: opts.minStubLength, riserHeight: opts.riserHeight })` — and shift the zone: `const sillZone = Math.max(0, (spec.sillHeight ?? 0) - (opts.riserHeight ?? 0))`.

- [ ] **Step 4: Run the full suite**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts`
Expected: all PASS — including every pre-existing doorway/window/placement test (the riser=0 path must not drift).

- [ ] **Step 5: Commit**

```bash
git add src/engine/doorway.ts src/engine/__tests__/engine.test.ts
git commit -m "feat: floor-referenced portals — doors and windows measure from the riser floor"
```

---

### Task 4: Cut list, packing, and optimizer take off the riser

**Files:**
- Modify: `src/engine/cutlist.ts`, `src/engine/optimize.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**
- `buildCutList(model, opts, doorway?, riser?: RiserModel | null)` — riser members become `kind: 'frame'` rows labeled by part.
- `OptimizeOptions` gains `riserHeight?: number` and `riserMemberWidth?: number`; each candidate rebuilds the riser at its radius and passes `riserHeight` into `cutDoorways`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('riser wall in the cut list', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const radius = 150
  const riser = buildRiser(model, radius, {
    height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6,
    doors: [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }],
  })!
  const cutOpts = { radius, increment: 1 / 8, endOffset: 0, units: 'imperial' as const }

  it('adds grouped frame rows for every riser part', () => {
    const list = buildCutList(model, cutOpts, undefined, riser)
    const riserRows = list.rows.filter((r) => r.kind === 'frame' && r.label.startsWith('riser'))
    expect(riserRows.length).toBeGreaterThan(0)
    const qty = riserRows.reduce((n, r) => n + r.quantity, 0)
    expect(qty).toBe(riser.members.reduce((n, m) => n + m.quantity, 0))
    for (const part of ['riser top plate', 'riser bottom plate', 'riser stud', 'riser king stud', 'riser trimmer']) {
      expect(riserRows.some((r) => r.label === part)).toBe(true)
    }
    // Frame rows never count as struts; type rows stay index-stable.
    expect(list.rows[0].typeId).toBe(0)
    expect(list.totalStruts).toBe(buildCutList(model, cutOpts).totalStruts)
  })

  it('flows into packing and the optimizer', () => {
    const list = buildCutList(model, cutOpts, undefined, riser)
    const packed = packCuts(list, { kerf: 0.125, stock: [{ length: 96, label: '8 ft' }, { length: 144, label: '12 ft' }] })
    const placed = packed.boards.flatMap((b) => b.cuts).length + packed.unplaceable.length
    expect(placed).toBe(list.rows.reduce((n, r) => n + r.quantity, 0))
    const result = optimizeDiameter(model, {
      minDiameter: 280, maxDiameter: 320, step: 8, increment: 1 / 8, endOffset: 0,
      kerf: 0.125, stock: [{ length: 144, label: '12 ft' }], units: 'imperial',
      doors: [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }],
      minStubLength: 6, riserHeight: 24, riserMemberWidth: 1.5,
    })
    expect(result.best).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts -t 'riser wall in the cut list'`
Expected: FAIL — buildCutList has no 4th parameter / riser rows absent.

- [ ] **Step 3: Implement**

`cutlist.ts` — signature `buildCutList(model, opts, doorway?, riser?: RiserModel | null)` (import type from `./riser`). After the doorway block, before `return`:

```ts
if (riser) {
  const groups = new Map<string, { part: string; exact: number; rounded: number; qty: number }>()
  for (const m of riser.members) {
    const rounded = roundToIncrement(m.length, opts.increment)
    const key = `${m.part}:${rounded.toFixed(6)}`
    const g = groups.get(key) ?? { part: m.part, exact: m.length, rounded, qty: 0 }
    g.qty += m.quantity
    groups.set(key, g)
  }
  const riserNote: Record<string, string> = {
    'riser top plate': 'riser wall top plate — the base ring bears on it',
    'riser bottom plate': 'riser wall bottom plate — anchor to the foundation',
    'riser stud': 'riser wall stud on centers (corner posts included)',
    'riser king stud': 'riser wall king stud at a door opening',
    'riser trimmer': 'riser wall trimmer stud at a door opening',
  }
  for (const g of [...groups.values()].sort((a, b) => a.part.localeCompare(b.part) || b.rounded - a.rounded)) {
    rows.push({
      typeId: -1, label: g.part, quantity: g.qty,
      chordLength: g.exact, exactCutLength: g.exact, roundedCutLength: g.rounded,
      roundingError: Math.abs(g.rounded - g.exact),
      axialAngleDeg: 90, dihedralMinDeg: NaN, dihedralMaxDeg: NaN,
      kind: 'frame', note: riserNote[g.part],
    })
  }
}
```

`optimize.ts` — add to `OptimizeOptions`: `riserHeight?: number; riserMemberWidth?: number`. In the candidate loop: pass `riserHeight: opts.riserHeight` inside the `cutDoorways` options, and

```ts
const riser =
  (opts.riserHeight ?? 0) > 0
    ? buildRiser(model, diameter / 2, {
        height: opts.riserHeight!,
        studSpacing: opts.units === 'imperial' ? 16 : 400,
        memberWidth: opts.riserMemberWidth ?? (opts.units === 'imperial' ? 1.5 : 38),
        minStubLength: opts.minStubLength ?? 0,
        doors: opts.doors,
      })
    : undefined
const cutList = buildCutList(model, { ... }, doorway, riser)
```

(import `buildRiser` from `./riser`).

- [ ] **Step 4: Run the full suite**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/cutlist.ts src/engine/optimize.ts src/engine/__tests__/engine.test.ts
git commit -m "feat: riser framing in the cut list, packing, and diameter optimizer"
```

---

### Task 5: Rectangle sheathing in the panel sheet plan

**Files:**
- Modify: `src/engine/panels.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**

```ts
export interface RectPanelType {
  label: string        // R1, R2, ... smallest-area first
  count: number        // pieces incl. skinFactor
  w: number
  h: number
  area: number         // one piece, w × h
  perSheet: number     // 0 = seamed
  seamed: boolean
  sheets: number
}
// PanelPlanOptions gains: rects?: { w: number; h: number }[]
// PanelPlan gains: rects: RectPanelType[]  (always present, [] when none)
// totalSheets / totalPanelArea / totalPanels / wasteFraction include rects.
```

- [ ] **Step 1: Write the failing tests**

```ts
describe('riser sheathing rectangles in the panel plan', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const sheet = { sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet' }

  it('groups equal rects, nests them, and counts sheets', () => {
    const rects = [
      { w: 60, h: 24 }, { w: 60, h: 24 }, { w: 60, h: 24 },
      { w: 45.5, h: 24 },
    ]
    const plan = planPanels(model, 150, { ...sheet, skinFactor: 1, rects })
    expect(plan.rects.length).toBe(2)
    const r60 = plan.rects.find((r) => Math.abs(r.w - 60) < 1e-6)!
    expect(r60.count).toBe(3)
    // 60×24 nests 1×4 per 48×96 sheet (rotated: 60 along the 96 side, 24 along 48 → 1 × 2... compute: floor(96/60)=1, floor(48/24)=2 → 2/sheet).
    expect(r60.perSheet).toBe(2)
    expect(r60.seamed).toBe(false)
    expect(r60.sheets).toBe(Math.ceil(3 / r60.perSheet))
    // Totals include the rects.
    const solo = planPanels(model, 150, { ...sheet, skinFactor: 1 })
    expect(plan.totalSheets).toBe(solo.totalSheets + plan.rects.reduce((n, r) => n + r.sheets, 0))
  })

  it('doubles rect counts with two skins and flags oversize as seamed', () => {
    const plan = planPanels(model, 150, { ...sheet, skinFactor: 2, rects: [{ w: 60, h: 24 }] })
    expect(plan.rects[0].count).toBe(2)
    const big = planPanels(model, 150, { ...sheet, skinFactor: 1, rects: [{ w: 120, h: 60 }] })
    expect(big.rects[0].seamed).toBe(true)
    expect(big.rects[0].sheets).toBeGreaterThanOrEqual(2)
  })

  it('is absent-safe: no rects option → empty array, identical totals', () => {
    const a = planPanels(model, 150, { ...sheet, skinFactor: 1 })
    expect(a.rects).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts -t 'sheathing rectangles'`
Expected: FAIL — `plan.rects` undefined.

- [ ] **Step 3: Implement in `panels.ts`**

Rect nesting reuses the fitting idea but without the two-per-rectangle triangle trick:

```ts
function rectsPerSheet(w: number, h: number, sheetW: number, sheetL: number): number {
  let best = 0
  if (w <= sheetW && h <= sheetL) best = Math.max(best, Math.floor(sheetW / w) * Math.floor(sheetL / h))
  if (w <= sheetL && h <= sheetW) best = Math.max(best, Math.floor(sheetL / w) * Math.floor(sheetW / h))
  return best
}
```

In `planPanels`, after the triangle `types` computation:

```ts
const rectGroups = new Map<string, { w: number; h: number; count: number }>()
for (const r of opts.rects ?? []) {
  const key = `${r.w.toFixed(3)}:${r.h.toFixed(3)}`
  const g = rectGroups.get(key) ?? { w: r.w, h: r.h, count: 0 }
  g.count++
  rectGroups.set(key, g)
}
const rects: RectPanelType[] = [...rectGroups.values()]
  .sort((a, b) => a.w * a.h - b.w * b.h)
  .map((g, i) => {
    const count = g.count * opts.skinFactor
    const area = g.w * g.h
    const perSheet = rectsPerSheet(g.w, g.h, opts.sheetW, opts.sheetL)
    const seamed = perSheet === 0
    const sheets = seamed ? Math.ceil((count * area * SEAM_WASTE) / sheetArea) : Math.ceil(count / perSheet)
    return { label: `R${i + 1}`, count, w: g.w, h: g.h, area, perSheet, seamed, sheets }
  })
```

Fold into totals: `totalPanels += rects Σcount`, `totalPanelArea += Σ area·count`, `totalSheets += Σ sheets`, and return `rects` on the plan. Waste formula unchanged (it already derives from the totals).

- [ ] **Step 4: Run the full suite**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts`
Expected: all PASS (existing panel tests must not change — verify the no-rects path).

- [ ] **Step 5: Commit**

```bash
git add src/engine/panels.ts src/engine/__tests__/engine.test.ts
git commit -m "feat: rectangle nesting in the panel sheet plan for riser sheathing"
```

---

### Task 6: Project state wiring — riserHeightMm end to end

**Files:**
- Modify: `src/composables/useDomeProject.ts`, `src/engine/exports/json.ts`
- Test: `src/engine/__tests__/engine.test.ts` (JSON round-trip)

**Interfaces:**
- State: `riserHeightMm: number` (default 0).
- Composable exposes: `riserHeight` (writable computed, display small units in/mm, same pattern as `endOffset`), `workingRiserHeight` (working units; **0 unless `baseMode === 'leveled'` and `fraction !== 'full'`**), `riser` (computed `RiserModel | null`).
- `ProjectSettings.riserHeightMm?: number`.

- [ ] **Step 1: Write the failing test (JSON round-trip)**

```ts
describe('riser project settings', () => {
  it('round-trips riserHeightMm through the project file', () => {
    const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cutList = buildCutList(model, { radius: 150, increment: 1 / 8, endOffset: 0, units: 'imperial' })
    const packing = packCuts(cutList, { kerf: 0, stock: [{ length: 144, label: '12 ft' }] })
    const settings = {
      frequency: 3, fraction: '1/2', baseMode: 'leveled', diameter: 25, units: 'imperial',
      material: 'lumber-2x4', jointMethod: 'timber-plate', endOffset: 0, increment: 1 / 8,
      kerf: 0, stock: [], riserHeightMm: 610,
    }
    const text = projectJson(settings, model, cutList, packing)
    const parsed = parseProjectJson(text)!
    expect(parsed.riserHeightMm).toBe(610)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts -t 'riser project settings'`
Expected: FAIL — TS error: `riserHeightMm` not in `ProjectSettings`. (A type error is the failure here; vitest runs through vite so it may pass at runtime — confirm the field is missing by the type check in Step 3's `bun run build` if the runtime test passes vacuously. Then still add the field.)

- [ ] **Step 3: Implement**

`json.ts`: add to `ProjectSettings`:

```ts
/** Riser (knee) wall height under the base ring, canonical mm. 0/absent = none. */
riserHeightMm?: number
```

`useDomeProject.ts` — every touch point:

1. `ProjectState` interface + `state` init: `riserHeightMm: 0` with doc comment `/** Stud-framed riser wall under the base ring, canonical mm (0 = none). Requires the leveled base. */`
2. Display computed (after `kerf`):

```ts
/** Riser wall height in small display units (inches or mm). */
const riserHeight = computed({
  get: () =>
    round3(state.units === 'imperial' ? state.riserHeightMm / MM_PER_INCH : state.riserHeightMm),
  set: (v: number) => {
    if (v >= 0) state.riserHeightMm = state.units === 'imperial' ? v * MM_PER_INCH : v
  },
})
```

3. Working value + model (after `workingKerf`):

```ts
/** Riser height in working units — active only on a leveled, truncated base. */
const workingRiserHeight = computed(() =>
  state.baseMode === 'leveled' && state.fraction !== 'full' && state.riserHeightMm > 0
    ? state.units === 'imperial'
      ? state.riserHeightMm / MM_PER_INCH
      : state.riserHeightMm
    : 0,
)
```

4. `doorway` computed: add `riserHeight: workingRiserHeight.value` to the `cutDoorways` options.
5. Riser computed (after `doorway` — it consumes `doorSpecs`, import `buildRiser` + `RiserModel` from `@/engine/riser`):

```ts
/** Stud spacing for the riser wall — a real wall, independent of closeDoorways. */
const riserStudSpacing = computed(() => (state.units === 'imperial' ? 16 : 400))
const riser = computed(() =>
  workingRiserHeight.value > 0
    ? buildRiser(model.value, radius.value, {
        height: workingRiserHeight.value,
        studSpacing: riserStudSpacing.value,
        memberWidth:
          strutSectionWorking.value.kind === 'rect'
            ? strutSectionWorking.value.width
            : strutSectionWorking.value.diameter,
        minStubLength: minStubLength.value,
        doors: doorSpecs.value,
      })
    : null,
)
```

6. `cutList` computed: pass `riser.value` as the 4th argument.
7. `panelPlan` computed: add `rects: riser.value?.sheathingRects` to the `planPanels` options.
8. `summary`: `height: m.unitHeight * r + workingRiserHeight.value`.
9. `runOptimizer`: add `riserHeight: workingRiserHeight.value, riserMemberWidth: strutSectionWorking.value.kind === 'rect' ? strutSectionWorking.value.width : strutSectionWorking.value.diameter` to the options.
10. `projectSettings`: `riserHeightMm: state.riserHeightMm`.
11. `loadProjectFile`: after `state.increment = settings.increment` add
    `state.riserHeightMm = typeof settings.riserHeightMm === 'number' && settings.riserHeightMm >= 0 ? settings.riserHeightMm : 0`.
12. `persistedSlice`: `riserHeightMm: state.riserHeightMm`.
13. `restorePersisted`: `state.riserHeightMm = num(p.riserHeightMm, (n) => n >= 0) ?? state.riserHeightMm`.
14. `resetProject`: `state.riserHeightMm = 0`.
15. `exporters.gltf`: add `riser: riser.value` to its `buildDomeGroup` options (the `riser` field lands in `BuildOptions` in Task 7; adding it here is type-safe once both tasks merge — if executing strictly in order, add it in Task 7 instead and note it here).
16. `useDomeProject()` return: add `riserHeight`, `workingRiserHeight`, `riser`.

- [ ] **Step 4: Run suite + typecheck**

Run: `bunx vitest run src/engine/__tests__/engine.test.ts && bun run build`
Expected: tests PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useDomeProject.ts src/engine/exports/json.ts src/engine/__tests__/engine.test.ts
git commit -m "feat: riser wall project state — persistence, JSON, optimizer, summary height"
```

---

### Task 7: Rendering — riser wall in the 3D view, bucks through the wall

**Files:**
- Modify: `src/lib/three-builders.ts`, `src/components/DomeViewer.vue`

**Interfaces:**
- `BuildOptions` gains `riser?: RiserModel | null` (import type from `@/engine/riser`).
- Buck placement switches from `sillHeight`/`height` to `buckBottomRel`/`buckTopRel` (Task 3 guarantees these on every `DoorFrameInfo`).
- `DomeViewer` needs `workingRiserHeight` and `riser` from the composable.

- [ ] **Step 1: three-builders — buck placement via buckBottomRel/buckTopRel**

In the door-buck section (`three-builders.ts:201-224`), replace the `sillH`-based Y math:

```ts
const bLo = door.buckBottomRel
const bHi = door.buckTopRel
const sillH = door.sillHeight ?? 0
// Jambs span the full opening — through the riser for doors.
addMember(base.clone().addScaledVector(tv, half).setY(z0 + (bLo + bHi) / 2), memberW, bHi - bLo, memberD)
addMember(base.clone().addScaledVector(tv, -half).setY(z0 + (bLo + bHi) / 2), memberW, bHi - bLo, memberD)
addMember(base.clone().setY(z0 + bHi + memberW / 2), door.width + 2 * memberW, memberW, memberD)
if (sillH > 0) {
  addMember(base.clone().setY(z0 + bLo - memberW / 2), door.width + 2 * memberW, memberW, memberD)
}
```

And in the face-band block, replace `const buckLo = sillH` / `const buckHi = sillH + door.height` with `const buckLo = bLo` / `const buckHi = bHi` (the existing `buckLo - zLo > 1e-6` guard already skips the below-sill band for doors, where `bLo < 0 ≤ zLo`). Replace the two buck-corner `jointPts.push` pairs to use `bLo` / `bHi` instead of `sillH` / `sillH + door.height`.

- [ ] **Step 2: three-builders — render the riser**

After the hubs section (still inside `showStruts` for framing; sheathing gated on `showPanels`), add:

```ts
// ---- Riser wall ----
if (opts.riser) {
  const r3 = (p: [number, number, number]) => new THREE.Vector3(p[0], p[2], -p[1])
  const h = opts.riser.height
  const memberW = section ? (section.kind === 'rect' ? section.width : section.diameter) : Math.max(strutR * 2, radius * 0.012)
  const memberD = section && section.kind === 'rect' ? section.depth : memberW
  if (showStruts) {
    const barGeo = new THREE.BoxGeometry(1, 1, 1)
    const barMat = new THREE.MeshStandardMaterial({ color: 0xc9873a, roughness: 0.6, metalness: 0.1 })
    for (const m of opts.riser.members) {
      const a = r3(m.a), b = r3(m.b)
      const dir = b.clone().sub(a)
      const len = dir.length()
      if (len < 1e-6) continue
      const yAxis = dir.clone().normalize()
      const ref = Math.abs(yAxis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
      const xAxis = new THREE.Vector3().crossVectors(yAxis, ref).normalize()
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis)
      const bar = new THREE.Mesh(barGeo, barMat)
      const mtx = new THREE.Matrix4().makeBasis(
        xAxis.multiplyScalar(memberW), yAxis.multiplyScalar(len), zAxis.multiplyScalar(Math.min(memberD, memberW * 1.5)),
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
  if (showPanels) {
    const positions: number[] = []
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
      let nx = dy, ny = -dx
      if (nx * (seg.a[0] + seg.b[0]) + ny * (seg.a[1] + seg.b[1]) < 0) { nx = -nx; ny = -ny }
      const strutDepth = section ? (section.kind === 'rect' ? section.depth : section.diameter) : strutR * 2
      const skins = opts.panelPlacement === 'inside' ? [-strutDepth / 2] : opts.panelPlacement === 'both' ? [strutDepth / 2, -strutDepth / 2] : [strutDepth / 2]
      for (const [d0, d1] of kept) {
        for (const skin of skins) {
          const P = (d: number, z: number) =>
            new THREE.Vector3(seg.a[0] + dx * d + nx * skin, z, -(seg.a[1] + dy * d + ny * skin))
          const zT = seg.a[2], zB = zT - h
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
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x1c2735, roughness: 0.85, metalness: 0.05,
        transparent: !surface, opacity: surface ? 1 : 0.42,
        side: THREE.DoubleSide, depthWrite: surface,
      }))
      mesh.name = 'riser-sheathing'
      group.add(mesh)
    }
  }
}
```

(Note `r3` converts engine-frame working-unit coords: `(x, y, z) → (x, z, −y)` — same rotation as `toThree`, no radius scaling since riser coords are already world.)

- [ ] **Step 3: DomeViewer wiring**

- Destructure `riser` and `workingRiserHeight` from `useDomeProject()`.
- `rebuildDome()`: pass `riser: riser.value` in the `buildDomeGroup` options.
- `rebuildGround()`: `grid.position.y = model.value.cutZ * r - workingRiserHeight.value - 0.001 * r` with the comment updated to mention the riser foundation.
- Window-tool click: `const heightAboveFloor = hit.point.y - (model.value.cutZ * radius.value - workingRiserHeight.value)` and pass that to `addWindowAt` (rename the local variable; the mm conversion line stays).
- Watchers: add `riser.value` to the deep-watch array that calls `rebuildDome()`, and add `workingRiserHeight` to the `[model, radius]` watch (`watch([model, radius, workingRiserHeight], ...)`) so the ground and dome rebuild when the riser height changes.
- `frameCamera()` target: unchanged.

- [ ] **Step 4: Verify with typecheck + build**

Run: `bun run build`
Expected: clean. (Visual verification happens in Task 8's browser pass.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/three-builders.ts src/components/DomeViewer.vue
git commit -m "feat: render the riser wall — sheathing, framing bars, joints, floor at the foundation"
```

---

### Task 8: UI — riser input, conflict warnings, materials rows, live verification

**Files:**
- Modify: `src/components/panels/ParametersPanel.vue`, `src/components/panels/FramedOpeningCard.vue`, `src/components/panels/MaterialsPanel.vue`

**Interfaces:**
- Consumes: `riserHeight` (writable display computed), `state.baseMode`, `info.riserConflict`, `workingRiserHeight`, `panelPlan.rects`.

- [ ] **Step 1: ParametersPanel — riser field**

In the Geometry section, directly after the "Leveled base ring" field:

```vue
<Field>
  <FieldLabel
    >Riser wall <span class="text-muted-foreground">({{ smallUnit }})</span></FieldLabel
  >
  <Input
    type="number"
    step="1"
    min="0"
    class="font-mono"
    :disabled="state.baseMode !== 'leveled'"
    :model-value="riserHeight"
    @update:model-value="
      (v) => {
        const n = Number(v)
        if (n >= 0) riserHeight = n
      }
    "
  />
  <FieldDescription>
    {{
      state.baseMode === 'leveled'
        ? 'Stud-framed knee wall under the base ring — 0 for none. Doors cut through it; plates, studs, and sheathing join the takeoff.'
        : 'Level the base to add a riser wall.'
    }}
  </FieldDescription>
</Field>
```

Destructure `riserHeight` from `project` in the script block.

- [ ] **Step 2: FramedOpeningCard — riser conflict warnings**

Below the existing `!info.fits` warning, refine the messaging (riserConflict is the specific cause; keep the generic message for pure shell misfits):

```vue
<p v-if="info.riserConflict" class="flex items-center gap-1.5 text-xs text-destructive">
  <TriangleAlert class="size-3.5 shrink-0" />
  <template v-if="kind === 'door'">
    Door is shorter than the riser wall — make it taller than
    {{ formatLength(workingRiserHeight, state.units) }}.
  </template>
  <template v-else>
    Window dips into the riser — raise the sill above
    {{ formatLength(workingRiserHeight + (info.margin ?? 0), state.units) }}.
  </template>
</p>
<p v-else-if="!info.fits" class="flex items-center gap-1.5 text-xs text-destructive">
  <!-- existing "doesn't fit inside the shell" message unchanged -->
</p>
```

Destructure `workingRiserHeight` from the composable. Note the Sill field label/tooltip: change the title to "Height of the opening bottom above the floor" (it was "above the base plane").

- [ ] **Step 3: MaterialsPanel — riser sheathing rows**

In the "Skin panels" card, after the `panelPlan.types` loop, add the rect rows:

```vue
<div
  v-for="t in panelPlan.rects"
  :key="t.label"
  class="flex items-baseline gap-2 font-mono text-[11px]"
>
  <span class="font-semibold w-7">{{ t.label }}</span>
  <span>×{{ t.count }}</span>
  <span class="text-muted-foreground truncate">
    riser {{ t.w.toFixed(1) }} × {{ t.h.toFixed(1) }} · {{ panelAreaText(t.area) }}
  </span>
  <span class="ml-auto whitespace-nowrap">
    {{ t.seamed ? `seamed · ${t.sheets} sh` : `${t.perSheet}/sh · ${t.sheets} sh` }}
  </span>
</div>
```

- [ ] **Step 4: Full verification**

1. `bunx vitest run src/engine/__tests__/engine.test.ts` — all pass.
2. `bun run build` — vue-tsc + vite clean.
3. Browser (preview_start `domez-dev`): enable **Leveled base ring**, set **Riser wall = 24**; confirm the wall renders below the base ring, the floor grid drops, and the header height chip grows by 2 ft. Place a door: confirm the buck runs to the foundation and the riser framing shows king/trimmer studs at the opening. Check Struts tab for `riser top plate` / `riser stud` rows, Materials tab for R rows and board counts. Set a window sill to 20″: confirm the riser-conflict warning. Toggle base back to natural: input disabled, wall gone, doors return to base-plane behavior. Refresh: riser height persists. Reset: cleared. Screenshot for the user.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/ParametersPanel.vue src/components/panels/FramedOpeningCard.vue src/components/panels/MaterialsPanel.vue
git commit -m "feat: riser wall UI — height input, conflict warnings, sheathing takeoff rows"
```

---

## Self-review notes

- **Spec coverage:** Parameter & constraint → Tasks 6+8; engine → 1+2; door interaction → 2+3; window validation → 3+8; cut list/packing/panels → 4+5; 3D/UI → 7+8; exports → 6 (JSON, GLTF item 15) + automatic (CSV rows flow from cutList/panelPlan). Tests → every task.
- **Type consistency:** `RiserModel`/`RiserMember`/`RiserSegment`/`RectPanelType`/`buckBottomRel`/`buckTopRel`/`riserConflict`/`workingRiserHeight` names are used identically across tasks.
- **Known deviation from spec (deliberate):** the **top plate is also interrupted** at door openings, not just the bottom plate — the top plate sits at riser height, inside the door opening (door height > riser height), so a continuous top plate would cross the doorway. The door buck carries continuity.
