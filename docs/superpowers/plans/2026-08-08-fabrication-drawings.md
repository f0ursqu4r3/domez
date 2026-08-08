# Fabrication Drawings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two printable SVG exports — 1:1 end cut templates and board layout diagrams.

**Architecture:** One new pure engine module `src/engine/exports/templates.ts` (string SVG, no DOM) consuming `DomeModel`, `CutList`, `miterCuts`, and `PackingResult`; two exporter entries and two Export-panel buttons.

**Tech Stack:** TypeScript string SVG, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-08-08-fabrication-drawings-design.md`

## Global Constraints

- Tests `bunx vitest run src/engine/__tests__/engine.test.ts`; build `bun run build`.
- Physical scale: imperial → letter, root `width="8.5in"`, viewBox 1 unit = 1 inch, page height 11; metric → A4, `width="210mm"`, 1 unit = 1 mm, page height 297. Calibration ruler exactly 3 (imperial) / 75 (metric) viewBox units, drawn as `<path class="cal" d="M x y h 3"/>`-style with the length in the `d`.
- Mitered signatures rounded to 0.1°; per strut type.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `templates.ts` engine module + tests

**Files:**
- Create: `src/engine/exports/templates.ts`
- Test: `src/engine/__tests__/engine.test.ts`

**Interfaces:** exactly the spec's `TemplateOptions`, `cutTemplatesSvg(model, cutList, opts)`, `BoardDiagramOptions`, `boardDiagramsSvg(packing, opts)`. Consumes `miterCuts` from `../miter`, `strutColor` from `./svg`, `PackingResult`/`PackedBoard` from `../packing`, `CutList` from `../cutlist`.

- [ ] **Step 1: Failing tests**

```ts
describe('fabrication drawings', () => {
  const model = generateDome({ frequency: 3, fraction: '1/2', baseMode: 'leveled' })
  const cl = buildCutList(model, { radius: 150, increment: 1 / 8, endOffset: 1.5, units: 'imperial' })
  const rectSection = { kind: 'rect' as const, width: 1.5, depth: 3.5 }

  it('templates print at true scale with a calibration ruler', () => {
    const svg = cutTemplatesSvg(model, cl, {
      units: 'imperial', jointId: 'timber-plate', endOffset: 1.5, radius: 150,
      section: rectSection, title: 'test',
    })
    expect(svg).toContain('width="8.5in"')
    expect(svg).toContain('data-cal-length="3"')
    // One page per strut type for timber-plate (constant axial bevel per type).
    const pages = svg.match(/data-template-page/g) ?? []
    expect(pages.length).toBe(model.strutTypes.length)
    const metric = cutTemplatesSvg(model, cl, {
      units: 'metric', jointId: 'timber-plate', endOffset: 38, radius: 3810,
      section: { kind: 'rect', width: 38, depth: 89 }, title: 'test',
    })
    expect(metric).toContain('width="210mm"')
    expect(metric).toContain('data-cal-length="75"')
  })

  it('mitered templates group end signatures; pipe pages mark hole centers', () => {
    const z = generateZome({ sides: 8, pitchDeg: 45, rows: 4, baseMode: 'leveled' })
    const zcl = buildCutList(z, { radius: 130, increment: 1 / 8, endOffset: 0, units: 'imperial' })
    const svg = cutTemplatesSvg(z, zcl, {
      units: 'imperial', jointId: 'mitered', endOffset: 0, radius: 130,
      section: rectSection, title: 'test',
    })
    const pages = svg.match(/data-template-page/g) ?? []
    expect(pages.length).toBeGreaterThan(z.strutTypes.length) // ≥2 signatures for A
    expect(svg).toContain('blade tilt')
    const pipe = cutTemplatesSvg(model, cl, {
      units: 'imperial', jointId: 'flattened-pipe', endOffset: 0, radius: 150,
      section: { kind: 'round', diameter: 0.92 }, title: 'test',
    })
    expect(pipe).toContain('data-hole-center')
  })

  it('board diagrams draw every board with kerf ticks and waste', () => {
    const packing = packCuts(cl, { kerf: 0.125, stock: [{ length: 96, label: '8 ft' }, { length: 144, label: '12 ft' }] })
    const svg = boardDiagramsSvg(packing, { units: 'imperial', title: 'test', kerf: 0.125 })
    const bars = svg.match(/data-board=/g) ?? []
    expect(bars.length).toBe(packing.boards.length)
    const ticks = svg.match(/data-kerf-tick/g) ?? []
    expect(ticks.length).toBe(packing.boards.reduce((n, b) => n + Math.max(0, b.cuts.length - 1), 0))
    expect(svg).toContain('waste')
    for (const g of packing.boardCounts) expect(svg).toContain(g.stockLabel)
    // Empty packing renders without throwing.
    const empty = boardDiagramsSvg(
      packCuts(cl, { kerf: 0, stock: [] }),
      { units: 'imperial', title: 'empty', kerf: 0 },
    )
    expect(empty).toContain('<svg')
  })
})
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement `templates.ts`.** Structure:

```ts
const PAPER = {
  imperial: { w: 8.5, h: 11, unit: 'in', cal: 3, calLabel: '3 in' },
  metric: { w: 210, h: 297, unit: 'mm', cal: 75, calLabel: '75 mm' },
}
const M = (units) => (units === 'imperial' ? 0.5 : 12) // page margin, working units
```

`cutTemplatesSvg`:
1. Build end-signature groups:
   - timber/hub/pipe: one group per strut-type row (`kind === 'strut'` rows of the cut list; skip zero-quantity): `{ typeId, label, count: 2 × quantity, bevelDeg: 90 − axialAngleDeg }`.
   - mitered: run `miterCuts(model)`; for each edge end make key `${edge.typeId}:${left.toFixed(1)}:${right.toFixed(1)}:${tilt.toFixed(1)}`, accumulate counts and remember hub-type labels; one group per key sorted by typeId then count desc.
2. Each group renders one page block at `y = pageIndex × paper.h`:
   - Header text (title, `T${i + 1} — ${label}`, "cut N ends like this", color chip rect with `strutColor(typeId)`).
   - Page 1 extra: calibration bar — `<line x1 x2 = x1 + cal ... data-cal-length="${cal}">` + "verify before cutting" label.
   - Drawing at 1:1 anchored to the left margin as the registration edge (bold vertical line labeled "align to board edge"):
     - rect section: board outline `height = depth` (side view) for timber (bevel line from corner at `tan(bevel) × depth` run), or `height = width` (plan view) for mitered: centerline, cheek lines at leftSeam/rightSeam from the ridge point, "blade tilt X°" text.
     - round section / pipe: tube outline at OD, hole center cross `data-hole-center` at `x = flattenAllowance (1 × OD)` from the end, note "hole-to-hole = chord".
     - hub method: square end line + end-offset dimension arrow to the hub-center mark.
   - Cut-length dimension text: "mark ROUNDED from this line" using the type row's `roundedCutLength` (mitered: full chord from `chordLength`).
   - Dashed page-separator line + corner crop marks at each page boundary; `data-template-page` attribute on each page group.
3. Footer note on the last page: trimmed († ) and frame pieces cut square — see the cut list.
4. Root: `<svg xmlns=... width="${paper.w}${paper.unit}" height="${pages * paper.h}${paper.unit}" viewBox="0 0 ${paper.w} ${pages * paper.h}">` + a `<style>` block (hairline strokes `0.01` working units scaled: use 0.02 in / 0.5 mm class-based widths, font sizes 0.14 in / 3.5 mm).

`boardDiagramsSvg`:
1. Layout: margin left `1.4` in (35 mm) for board labels; bar height `0.28` in (7 mm); gap `0.14` in; group heading rows between stock-label groups (boards already sorted by stock length desc — group consecutive runs).
2. Scale: `sx = (paper.w − margins) / maxStockLength`.
3. Per board `<g data-board="${i + 1}">`: label text `#i · stockLabel`; background rect (full stock length × sx, stroke); cumulative x cursor: per cut a rect `fill=${strutColor(typeId)}55` + centered label `${cut.label} ${formatLength(cut.length, units)}` (skip the length when the segment is narrower than 0.8 in / 20 mm — label only, font shrinks); after each cut except the last a `data-kerf-tick` line; waste tail: hatched rect (`url(#hatch)` pattern defined once) + waste length text when ≥ 0.5 in.
4. Dashed page rules at every `paper.h` and a footer: `N boards — 12 ft × a, 8 ft × b · waste W% · kerf K`.
5. Root svg sized like the templates doc (physical width, total height = content, viewBox 1:1) — the diagrams are reference-scale, not 1:1, but the page rules still align to real paper.

(Use the same tiny `esc`/attribute hygiene as csv.ts where text is interpolated; lengths via `formatLength` from `../units`.)

- [ ] **Step 4: Run full suite** — PASS.
- [ ] **Step 5: Commit** — `feat: fabrication drawings engine — 1:1 cut templates + board diagrams SVG`

---

### Task 2: Exporters, Export panel, live verification

**Files:**
- Modify: `src/composables/useDomeProject.ts`, `src/components/panels/ExportPanel.vue`

- [ ] **Step 1: Exporters.** Import `cutTemplatesSvg, boardDiagramsSvg` from `@/engine/exports/templates`; add to `exporters`:

```ts
cutTemplates: () =>
  download(
    `${fileStem.value}-cut-templates.svg`,
    cutTemplatesSvg(model.value, cutList.value, {
      units: state.units,
      jointId: state.jointId,
      endOffset: workingEndOffset.value,
      radius: radius.value,
      section: strutSectionWorking.value,
      title: titleOf(),
    }),
    'image/svg+xml',
  ),
boardDiagrams: () =>
  download(
    `${fileStem.value}-board-diagrams.svg`,
    boardDiagramsSvg(packing.value, { units: state.units, title: titleOf(), kerf: workingKerf.value }),
    'image/svg+xml',
  ),
```

- [ ] **Step 2: Export panel.** Fabrication group, after "Boards CSV":

```ts
{ label: 'Cut templates SVG', desc: '1:1 tape-on end templates', icon: PencilRuler, run: exporters.cutTemplates },
{ label: 'Board diagrams SVG', desc: 'visual cutting plan', icon: ClipboardList, run: exporters.boardDiagrams },
```

- [ ] **Step 3: Verify.** Suite + build clean. In the preview: trigger both exporters via the page (or call the generator functions through the app state in the browser console) for a timber 3V and a mitered zome; open the generated SVG in a browser tab (data URL or served) and screenshot to confirm layout, calibration ruler, angles, board bars. Check the Export tab shows both buttons.
- [ ] **Step 4: Commit** — `feat: fabrication drawings exports — templates + board diagrams buttons`
