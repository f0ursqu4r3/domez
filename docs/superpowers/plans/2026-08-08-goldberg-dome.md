# Hex/Pent (Goldberg) Dome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Third structure family — the Goldberg dual (12 pentagons + hexagons, 3-way joints, structural panels) with natural/leveled bases and full downstream parity.

**Architecture:** `generateGoldberg` builds the icosphere dual into a standard `DomeModel` (polygon fans, real edges only, `polys` metadata), leveled mode clips straddling polygons at the cut plane with shared intersection vertices; downstream reuses everything, with polygon panel takeoff (`PanelPlan.polys` from 2D outlines) and pattern pages as the only extensions.

**Tech Stack:** TypeScript, Vue 3, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-08-08-goldberg-dome-design.md`

## Global Constraints

- Tests `bunx vitest run src/engine/__tests__/engine.test.ts`; build `bun run build`.
- Dual invariants (full sphere, frequency ν): 12 pentagons, 10(ν²−1) hexagons, V = 20ν², E = 30ν², all vertices 3-valent. 1V full dual = dodecahedron (30 equal edges, 1 strut type).
- Leveled clipping: intersection vertices deduped per crossing dual edge (chord endpoints shared between neighbor partials); base ring planar at the cut plane.
- Mitered joint is unavailable in goldberg mode (select disabled + automatic fallback to the material's default joint).
- Geodesic/zome behavior bit-identical (existing tests untouched).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Goldberg generator — dual + natural base

**Files:**
- Create: `src/engine/goldberg.ts`
- Modify: `src/engine/types.ts` (`polys?`, `goldberg?` on DomeModel)
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**

```ts
// types.ts DomeModel gains:
  /** Polygon panels for goldberg models: each polygon and its fan faces. */
  polys?: { vertexIds: number[]; faceIds: number[] }[]
  /** Goldberg params echo. */
  goldberg?: { frequency: number; fraction: string; leveled: boolean }

// goldberg.ts
export interface GoldbergParams {
  frequency: Frequency
  fraction: Fraction
  baseMode: 'natural' | 'leveled'
}
export function generateGoldberg(params: GoldbergParams): DomeModel
```

- [ ] **Step 1: Failing tests**

```ts
describe('goldberg dual — full sphere and natural base', () => {
  it.each([1, 2, 3])('frequency %i full dual satisfies Goldberg counts', (f) => {
    const m = generateGoldberg({ frequency: f as Frequency, fraction: 'full', baseMode: 'natural' })
    expect(m.vertices.length).toBe(20 * f * f)
    expect(m.edges.length).toBe(30 * f * f)
    const pentagons = m.polys!.filter((p) => p.vertexIds.length === 5)
    const hexagons = m.polys!.filter((p) => p.vertexIds.length === 6)
    expect(pentagons.length).toBe(12)
    expect(hexagons.length).toBe(10 * (f * f - 1))
    for (const v of m.vertices) expect(v.edgeIds.length).toBe(3)
  })

  it('1V full dual is the dodecahedron: one strut type', () => {
    const m = generateGoldberg({ frequency: 1, fraction: 'full', baseMode: 'natural' })
    expect(m.edges.length).toBe(30)
    expect(m.strutTypes.length).toBe(1)
    expect(m.polys!.length).toBe(12)
  })

  it('natural truncation keeps whole polygons only, outward winding', () => {
    const m = generateGoldberg({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    expect(m.polys!.length).toBeGreaterThan(10)
    for (const p of m.polys!) {
      for (const vi of p.vertexIds) {
        expect(m.vertices[vi].position[2]).toBeGreaterThan(m.cutZ - 1e-9)
      }
    }
    const centerZ = m.cutZ + m.unitHeight / 2
    for (const f of m.faces) {
      const [a, b, c] = f.vertexIds.map((vi) => m.vertices[vi].position)
      const n = cross(sub(b, a), sub(c, a))
      const cen = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3 - centerZ,
      ] as const
      expect(dot(n, cen)).toBeGreaterThan(0)
    }
    // Base flags exist and faces fan without phantom edges.
    expect(m.vertices.some((v) => v.isBase)).toBe(true)
    for (const f of m.faces) expect(f.edgeIds.length).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement.** Skeleton:

```ts
export function generateGoldberg(params: GoldbergParams): DomeModel {
  const sphere = subdivideIcosahedron(params.frequency)
  // Dual vertices: normalized face centroids (id = face index).
  const dualPos: [number, number, number][] = sphere.faces.map(([a, b, c]) => {
    const p = [0, 1, 2].map(
      (i) => (sphere.vertices[a][i] + sphere.vertices[b][i] + sphere.vertices[c][i]) / 3,
    )
    const l = Math.hypot(p[0], p[1], p[2])
    return [p[0] / l, p[1] / l, p[2] / l]
  })
  // Polygons: per icosphere vertex, its adjacent faces ordered CCW around
  // the outward vertex direction.
  const facesOf = new Map<number, number[]>()
  sphere.faces.forEach((f, fi) => f.forEach((vi) => {
    if (!facesOf.has(vi)) facesOf.set(vi, [])
    facesOf.get(vi)!.push(fi)
  }))
  interface RawPoly { owner: number; ring: number[] } // ring of dual-vert ids
  const rawPolys: RawPoly[] = []
  for (const [vi, fids] of facesOf) {
    const n = sphere.vertices[vi]
    const ref: [number, number, number] = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
    const e1 = normalize(cross(n, ref))
    const e2 = cross(n, e1)
    const ring = fids
      .map((fi) => {
        const c = dualPos[fi]
        return { fi, ang: Math.atan2(dot(c, e2), dot(c, e1)) }
      })
      .sort((x, y) => x.ang - y.ang)
      .map((x) => x.fi)
    rawPolys.push({ owner: vi, ring })
  }
  // ---- Cut selection on owner z levels (like dome.ts) ----
  // fraction 'full' → keep all. Otherwise: distinct owner z levels,
  // descending; for each candidate keep polys with owner z ≥ level − tol;
  // actual = (1 − minKeptDualZ)/2; score = |actual − targetActual| where
  // targetActual = (1 − targetCutZ(fraction))/2 (reuse the switch from
  // dome.ts — copy the tiny function, it is not exported).
  // Natural: kept = whole polys. Leveled: Task 2 extends with clipping.
  // ---- Model assembly (shared with Task 2) ----
  // 1. Collect used dual verts from kept rings → re-index → Vertex[] (unit
  //    sphere positions).
  // 2. Edges: consecutive ring pairs (incl. closing), deduped via min:max
  //    key; push into vertex edgeIds.
  // 3. Faces: fan from ring[0]: (r0, ri, ri+1) for i in 1..len−2, winding
  //    checked per triangle against centroid − (0, 0, zMid) and flipped if
  //    needed; Face.edgeIds = the subset of the triangle's vertex pairs
  //    present in the edge map; edge.faceIds push.
  // 4. polys metadata: { vertexIds: ring (re-indexed), faceIds: fan ids }.
  // 5. isBase from boundary edges; chordFactors; classifyModel; cutZ =
  //    min kept z; unitHeight/unitBaseRadius/actualFraction from geometry;
  //    params echo { frequency, fraction }; goldberg echo.
}
```

All list mechanics follow `zome.ts` exactly (edgeBetween, winding check, base flags, classify tail) — copy that file's assembly section and adapt ring-fan for variable polygon sizes.

- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: goldberg generator — icosphere dual with natural truncation`

---

### Task 2: Leveled base — clipped partials, riser-ready ring

**Files:**
- Modify: `src/engine/goldberg.ts`
- Test: `src/engine/__tests__/engine.test.ts`

- [ ] **Step 1: Failing tests**

```ts
describe('goldberg leveled base', () => {
  const m = generateGoldberg({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })

  it('clips straddling polygons to a planar chord ring', () => {
    const baseVerts = m.vertices.filter((v) => v.isBase)
    expect(baseVerts.length).toBeGreaterThan(3)
    for (const v of baseVerts) expect(v.position[2]).toBeCloseTo(m.cutZ, 9)
    const ring = orderedBaseRing(m)
    expect(ring.length).toBe(baseVerts.length)
    const partials = m.polys!.filter((p) =>
      p.vertexIds.some((vi) => Math.abs(m.vertices[vi].position[2] - m.cutZ) < 1e-9),
    )
    expect(partials.length).toBeGreaterThan(0)
    for (const p of partials) expect(p.vertexIds.length).toBeGreaterThanOrEqual(4)
  })

  it('takes a riser and keeps more coverage than natural', () => {
    const riser = buildRiser(m, 150, { height: 24, studSpacing: 16, memberWidth: 1.5, minStubLength: 6 })!
    expect(riser).not.toBeNull()
    expect(riser.segments.length).toBe(orderedBaseRing(m).length)
    const nat = generateGoldberg({ frequency: 3, fraction: '1/2', baseMode: 'natural' })
    expect(m.polys!.length).toBeGreaterThanOrEqual(nat.polys!.length)
  })
})
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In the cut section, when leveled: the clip plane is `zPlane = chosen owner level's kept-set minimum outline z` — concretely: after choosing the natural kept set, `zPlane = min over kept rings of min dual-vert z`; then re-select: keep every raw polygon whose ring has ANY dual vert with `z > zPlane + 1e-9`; clip each kept ring against `z ≥ zPlane` with Sutherland–Hodgman where each crossing dual-edge's intersection point is computed ONCE (map keyed `min:max` of the dual-vert pair) and registered as a shared new vertex position `lerp` on the plane. Rings fully above pass through unchanged. Assembly then proceeds identically (new vertices join the re-index pass; chord edges arise naturally from consecutive clipped ring pairs; boundary detection marks them isBase).
- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: goldberg leveled base — clipped partials, planar chord ring`

---

### Task 3: Polygon panel takeoff + pattern pages

**Files:**
- Modify: `src/engine/panels.ts`, `src/engine/exports/patterns.ts`, `src/engine/bom.ts` (perimeter)
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**

```ts
// panels.ts
export interface PolyPanelType {
  label: string   // G1... smallest-area first
  count: number
  sides: number
  edges: number[]           // representative edge lengths, in ring order
  outline: [number, number][] // representative outline, origin at bbox min
  area: number
  boundingW: number
  boundingH: number
  perSheet: number
  seamed: boolean
  sheets: number
}
// PanelPlanOptions gains: polyOutlines?: [number, number][][]
// PanelPlan gains: polys: PolyPanelType[]  (always [], totals folded in)
```

- [ ] **Step 1: Failing tests**

```ts
describe('polygon panels and patterns', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const sheet = { sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet' }
  const hex: [number, number][] = Array.from({ length: 6 }, (_, i) => [
    20 + 20 * Math.cos((Math.PI / 3) * i),
    20 + 20 * Math.sin((Math.PI / 3) * i),
  ])

  it('groups outlines, nests bounding boxes, folds totals', () => {
    const plan = planPanels(model, 150, { ...sheet, skinFactor: 1, polyOutlines: [hex, hex] })
    expect(plan.polys.length).toBe(1)
    expect(plan.polys[0].count).toBe(2)
    expect(plan.polys[0].sides).toBe(6)
    expect(plan.polys[0].area).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 400, 3)
    expect(plan.polys[0].perSheet).toBeGreaterThan(0)
    const solo = planPanels(model, 150, { ...sheet, skinFactor: 1 })
    expect(plan.totalSheets).toBe(solo.totalSheets + plan.polys[0].sheets)
    expect(solo.polys).toEqual([])
  })

  it('patterns SVG emits polygon pages with interior angles summing right', () => {
    const plan = planPanels(model, 150, {
      ...sheet, skinFactor: 1,
      excludeFaceIds: new Set(model.faces.map((f) => f.id)),
      polyOutlines: [hex],
    })
    const svg = panelPatternsSvg(plan, { units: 'imperial', title: 'test' })
    expect(svg).toContain('data-pattern-page')
    const angles = [...svg.matchAll(/data-angle="([\d.]+)"/g)].map((x) => Number(x[1]))
    expect(angles.length).toBe(6)
    expect(angles.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 1)
  })
})
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
  - `panels.ts`: normalize each outline (translate bbox min to origin); group key = rounded sorted edge lengths + rounded area; representative outline stored; `area` shoelace; `perSheet` = grid nesting of bbox via `rectsPerSheet(boundingW, boundingH, …)`; seamed fallback with `SEAM_WASTE`; labels `G${i+1}` sorted by area; fold into the three totals like rects/rhombs.
  - `patterns.ts`: new family loop after rhombs — draw the outline path scaled to the box, label each edge midpoint with its length, each corner with the interior angle (`data-angle`, angle between adjacent edge vectors), header/nesting/footer identical to other pages.
  - `bom.ts`: panel-screw perimeter adds `Σ poly.count × Σ edges`.
- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: polygon panel takeoff + pattern pages`

---

### Task 4: State wiring + portals verification

**Files:**
- Modify: `src/composables/useDomeProject.ts`, `src/components/panels/ParametersPanel.vue`, `src/App.vue`
- Test: `src/engine/__tests__/engine.test.ts`

- [ ] **Step 1: Tests (portals on goldberg + JSON mode)**

```ts
describe('portals on a goldberg dome', () => {
  it('cuts a doorway on a leveled 3V goldberg', () => {
    const m = generateGoldberg({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
    const cut = cutDoorways(m, [{ id: 'D1', azimuthDeg: 10, width: 40, height: 80 }], 150, {
      minStubLength: 6, studSpacing: 16,
    })
    expect(cut.doors[0].fits).toBe(true)
    expect(cut.removedEdges.size + cut.trimmedEdges.size).toBeGreaterThan(0)
    expect(cut.doors[0].closureProfile).not.toBeNull()
  })
})
```

- [ ] **Step 2: Wiring.**
  1. `mode` type → `'geodesic' | 'zome' | 'goldberg'` (state interface, restorePersisted `['geodesic','zome','goldberg'].includes`, loadProjectFile mapping `settings.mode === 'zome' ? 'zome' : settings.mode === 'goldberg' ? 'goldberg' : 'geodesic'`).
  2. `model` computed: goldberg branch `generateGoldberg({ frequency: state.frequency, fraction: state.fraction, baseMode: state.baseMode })`.
  3. Mitered fallback watcher (sync): when `state.mode === 'goldberg' && state.jointId === 'mitered'` → `state.jointId = material.value.defaultJoint`.
  4. `paintFace`: generalize the rhombus pairing — `const group = model.value.polys?.find(...) ?? model.value.rhombi?.find(...)`; paint all `faceIds` of whichever matches.
  5. `panelPlan`: when `model.value.polys` exists — exclude all fan faces of every polygon; for surviving polygons (no excluded face), flatten to 2D: Newell normal `n`, basis `e1 = normalize(cross(n, ref))`, `e2 = cross(n, e1)`, outline = vertices ×radius projected to (dot e1, dot e2); pass as `polyOutlines`.
  6. `fileStem`/`titleOf`: goldberg → `hex${frequency}v-${fraction…}` / `⬡${frequency}V ${fraction}`.
  7. App chip: three-way — `state.mode === 'zome' ? Z… : state.mode === 'goldberg' ? '⬡' + frequency + 'V · ' + fraction : frequency + 'V · ' + fraction`.
  8. ParametersPanel: Structure ToggleGroup gains `<ToggleGroupItem value="goldberg">Hex/Pent</ToggleGroupItem>`; geodesic branch condition becomes `state.mode !== 'zome'` for Frequency/Fraction (shared by geodesic + goldberg); toggle description for goldberg: "Hexagon + pentagon panels, 3-way joints. Panels are structural — a bare hex frame is not rigid."; Joint method Select: `<SelectItem :disabled="state.mode === 'goldberg' && j.id === 'mitered'" …>`.
- [ ] **Step 3: Run suite + build** — PASS/clean.
- [ ] **Step 4: Commit** — `feat: goldberg mode wiring — structure toggle, panels feed, mitered fallback`

---

### Task 5: Live verification

- [ ] **Step 1:** Preview: switch Structure → Hex/Pent, 3V 1/2 leveled: soccer-ball shell renders, cut list shows several types, hubs all 3-way, Materials shows G panel groups; riser 24″ builds; place a door; paint a vent (whole hexagon paints); patterns SVG polygon page standalone render; mitered disabled in the joint select; 1V goldberg = pentagon dome. Screenshots (shell + a takeoff/pattern).
- [ ] **Step 2:** Persistence: refresh keeps goldberg mode; reset returns to geodesic. Final suite + build; commit any fixes.
