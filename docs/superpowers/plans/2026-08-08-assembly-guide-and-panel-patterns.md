# Assembly Guide + Panel Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two printable SVG docs — course-by-course assembly guide with top-down diagrams, and dimensioned panel drawings for P/R/Z panel families.

**Architecture:** Extract shared `PAPER`/`esc` into `src/engine/exports/paper.ts`; new pure generators `guide.ts` (`assemblyGuideSvg`) and `patterns.ts` (`panelPatternsSvg`); two exporters + Export buttons + an Assembly-tab "Print guide" button.

**Tech Stack:** TypeScript string SVG, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-08-08-assembly-guide-and-panel-patterns-design.md`

## Global Constraints

- Tests `bunx vitest run src/engine/__tests__/engine.test.ts`; build `bun run build`.
- Page markers: `data-course-page` (guide course pages), `data-new-strut` (per newly placed edge), `data-pattern-page` (pattern pages), `data-angle` (triangle corner degrees).
- Guide consumes the composable's `assemblyPlan` (doorway exclusions already applied) — the generator never re-derives exclusions.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `paper.ts` extraction + assembly guide

**Files:**
- Create: `src/engine/exports/paper.ts`, `src/engine/exports/guide.ts`
- Modify: `src/engine/exports/templates.ts` (import PAPER/esc from `./paper`)
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:**

```ts
// paper.ts
export const PAPER = {
  imperial: { w: 8.5, h: 11, unit: 'in', cal: 3, calLabel: '3 in', margin: 0.5 },
  metric: { w: 210, h: 297, unit: 'mm', cal: 75, calLabel: '75 mm', margin: 12 },
} as const
export const esc = (s: string | number) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// guide.ts
export interface GuideOptions { units: UnitSystem; radius: number; title: string }
export function assemblyGuideSvg(model: DomeModel, plan: AssemblyPlan, cutList: CutList, opts: GuideOptions): string
```

- [ ] **Step 1: Failing tests**

```ts
describe('assembly guide', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const plan = buildAssemblyPlan(model)
  const cl = buildCutList(model, { radius: 150, increment: 1 / 8, endOffset: 1.5, units: 'imperial' })

  it('renders a cover plus one page per course', () => {
    const svg = assemblyGuideSvg(model, plan, cl, { units: 'imperial', radius: 150, title: 'test' })
    const pages = svg.match(/data-course-page/g) ?? []
    expect(pages.length).toBe(plan.courses.length)
    expect(svg).toContain('width="8.5in"')
    // Cover carries totals and the A cut length.
    expect(svg).toContain(String(cl.totalStruts))
    expect(svg).toContain(formatInchesFractional(cl.rows[0].roundedCutLength))
    // Every course page marks exactly its new struts.
    const marks = svg.match(/data-new-strut/g) ?? []
    expect(marks.length).toBe(
      plan.courses.reduce((n, c) => n + c.ringStrutIds.length + c.riserStrutIds.length, 0),
    )
  })

  it('a doored dome renders with excluded struts absent', () => {
    const doors = cutDoorways(model, [{ id: 'D1', azimuthDeg: 0, width: 48, height: 90 }], 150, { minStubLength: 6 })
    const dPlan = buildAssemblyPlan(model, new Set([...doors.removedEdges, ...doors.trimmedEdges]))
    const svg = assemblyGuideSvg(model, dPlan, cl, { units: 'imperial', radius: 150, title: 'test' })
    const marks = svg.match(/data-new-strut/g) ?? []
    expect(marks.length).toBe(
      dPlan.courses.reduce((n, c) => n + c.ringStrutIds.length + c.riserStrutIds.length, 0),
    )
  })
})
```

(`formatInchesFractional` is already imported in the test file; `buildAssemblyPlan` needs importing from `../assembly`.)

- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement.**
  1. `paper.ts` as above; `templates.ts` deletes its local copies and imports them (no behavior change).
  2. `guide.ts`:
     - Layout constants from `PAPER[units]`; fonts/strokes like templates (`fs = 0.16in/4mm`).
     - **Projection:** working coords `X = v.position[0] * radius`, `Y = -v.position[1] * radius`; bounds over all vertices; uniform scale into a drawing box (page width minus margins, square, anchored below the header); `px(v) / py(v)` helpers.
     - **Cover (page 0):** title (`class="h"`), summary lines (struts, hubs = model.vertices.length, diameter/height via `formatLength(2 * radius, …)` and `formatLength(model.unitHeight * radius, …)`), total tally: for each `kind === 'strut'` cut-list row with quantity > 0 — `${label} × ${qty} @ ${formatLength(roundedCutLength)}`, then the three standing-instruction lines from the spec.
     - **Course pages:** accumulate `placed: number[]` (edge ids) across courses. Per course page at `y0 = (index + 1) * paper.h`: gray polylines for `placed` edges; then this course's edges: risers `stroke-dasharray`, ring solid, both `stroke=${strutColor(typeId)}` wrapped in `<g data-new-strut>` per edge, type letter text at the midpoint; hub dots (`r = fs*0.25`) at course hubs. Sidebar text: course title (Base ring / Course N / Apex), `${hubIds.length} hubs — ${[...new Set(hub labels)].join(', ')}`, tally lines with cut lengths (match label → type row), `${riser} risers · ${ring} ring struts`. Dashed page separator per page.
     - Root svg + style identical pattern to templates.ts.
- [ ] **Step 4: Run full suite** — PASS (templates tests still green after the extraction).
- [ ] **Step 5: Commit** — `feat: assembly guide SVG — cover + course-by-course top-down diagrams`

---

### Task 2: Panel patterns

**Files:**
- Create: `src/engine/exports/patterns.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:** `PatternOptions { units, title }`, `panelPatternsSvg(plan: PanelPlan, opts): string`.

- [ ] **Step 1: Failing tests**

```ts
describe('panel flat patterns', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  it('one dimensioned page per panel family member', () => {
    const plan = planPanels(model, 150, {
      sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet', skinFactor: 1,
      rects: [{ w: 40, h: 24 }], rhombs: [{ d1: 60, d2: 40 }],
    })
    const svg = panelPatternsSvg(plan, { units: 'imperial', title: 'test' })
    const pages = svg.match(/data-pattern-page/g) ?? []
    expect(pages.length).toBe(plan.types.length + plan.rects.length + plan.rhombs.length)
    // Triangle corner angles sum to 180.
    const firstPage = svg.slice(svg.indexOf('data-pattern-page'), svg.indexOf('data-pattern-page', svg.indexOf('data-pattern-page') + 1))
    const angles = [...firstPage.matchAll(/data-angle="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(angles.length).toBe(3)
    expect(angles[0] + angles[1] + angles[2]).toBeCloseTo(180, 1)
    expect(svg).toContain(formatInchesFractional(plan.types[0].edges[0]))
    expect(svg).toContain('drawn to fit')
  })
  it('empty plan renders a placeholder', () => {
    const empty = panelPatternsSvg(
      planPanels(model, 150, {
        sheetW: 48, sheetL: 96, sheetLabel: '4×8 ft sheet', skinFactor: 1,
        excludeFaceIds: new Set(model.faces.map((f) => f.id)),
      }),
      { units: 'imperial', title: 'empty' },
    )
    expect(empty).toContain('no panels')
  })
})
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement `patterns.ts`.** Per page (order P → R → Z):
  - Triangle: edges `[a, b, c]` descending; base `a` on the x-axis; apex at `x = (a² + c² − b²) / 2a`, `y = √(c² − x²)`; angles via law of cosines (`data-angle` on each corner text). Scale to the drawing box, label each edge midpoint with `formatLength(edge)`, corners with `∠XX.X°`.
  - Rect: w × h box, both labeled; note "riser sheathing".
  - Rhomb: diamond points (±d1/2, 0), (0, ±d2/2); label diagonals, side (√((d1/2)² + (d2/2)²)), acute + obtuse angles (`2·atan(d2/d1)` and supplement, `data-angle` on both).
  - Header per page: label + count (`cut N`), nesting hint (`${perSheet} per sheet — mirror alternates` or `seamed — too large for one sheet`); footer note "drawn to fit the page — cut from dimensions".
  - Empty plan (no types/rects/rhombs): single page "no panels — everything is cut or painted open".
- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: dimensioned panel flat patterns SVG`

---

### Task 3: Exporters, buttons, live verification

**Files:**
- Modify: `src/composables/useDomeProject.ts`, `src/components/panels/ExportPanel.vue`, `src/components/panels/AssemblyPanel.vue`

- [ ] **Step 1: Exporters.**

```ts
assemblyGuide: () =>
  download(
    `${fileStem.value}-assembly-guide.svg`,
    assemblyGuideSvg(model.value, assemblyPlan.value, cutList.value, {
      units: state.units, radius: radius.value, title: titleOf(),
    }),
    'image/svg+xml',
  ),
panelPatterns: () =>
  download(
    `${fileStem.value}-panel-patterns.svg`,
    panelPatternsSvg(panelPlan.value, { units: state.units, title: titleOf() }),
    'image/svg+xml',
  ),
```

- [ ] **Step 2: Buttons.** ExportPanel Fabrication group after "Board diagrams SVG": `{ label: 'Assembly guide SVG', desc: 'course-by-course build book', icon: ClipboardList, run: exporters.assemblyGuide }` and `{ label: 'Panel patterns SVG', desc: 'dimensioned panel drawings', icon: PencilRuler, run: exporters.panelPatterns }`. AssemblyPanel header: a second button `Print guide` (icon `PencilRuler`) calling `exporters.assemblyGuide()` next to Hub labels.
- [ ] **Step 3: Verify.** Suite + build; standalone-render both SVGs in the preview via the `<img data:` overlay trick (5V default for the guide; a riser + zome case for patterns to show R and Z pages); screenshot; confirm both Export buttons and the Assembly-tab button.
- [ ] **Step 4: Commit** — `feat: assembly guide + panel patterns exports and buttons`
