# Assembly Guide + Panel Flat Patterns — Design Spec

**Date:** 2026-08-08
**Status:** Approved for planning

## Summary

Two more printable SVG documents in the established fabrication-drawings
pattern: a course-by-course **assembly guide** with top-down diagrams, and
**dimensioned panel drawings** for every panel family (triangles, riser
rects, zome rhombi).

## Decisions (from brainstorming)

1. Assembly guide is a printable SVG document (cover + one page per
   course), not an HTML print view or a PDF dependency.
2. Panel patterns are dimensioned scaled drawings (edge lengths + corner
   angles), deliberately NOT 1:1 tiles — straight-edged panels are laid out
   from measurements.

## Shared plumbing: `src/engine/exports/paper.ts`

Targeted refactor: move the `PAPER` constants (letter/A4 geometry in
working units) and the `esc` helper out of `templates.ts` into `paper.ts`;
`templates.ts` imports them. Three printable docs now share one source.

## Assembly guide: `src/engine/exports/guide.ts`

```ts
export interface GuideOptions {
  units: UnitSystem
  radius: number
  title: string
}
export function assemblyGuideSvg(
  model: DomeModel,
  plan: AssemblyPlan,
  cutList: CutList,
  opts: GuideOptions,
): string
```

- **Cover page:** title; summary block (struts = cutList.totalStruts, hubs,
  height, diameter derived from model + radius); total strut tally summed
  across courses (label × count at rounded cut length from the type rows);
  standing instructions (raise risers from the course below, close the
  ring; tape hub labels before build day; door/window trimmed pieces
  install with their bucks — see the cut list).
- **Course pages** (one per `plan.courses` entry, `data-course-page`):
  - Top-down plan diagram: vertices projected (x, −y), scaled to a square
    drawing area. Edges of earlier courses (their ring + riser ids) in
    faint gray; this course's `riserStrutIds` dashed and `ringStrutIds`
    solid, both stroked `strutColor(typeId)` with the type letter at each
    new strut's midpoint (`data-new-strut` per new edge); this course's
    hubs as dots.
  - Sidebar: course name (Base ring / Course N / Apex), hub count + hub
    type labels present in the course, strut tally with cut lengths,
    riser/ring counts.
- Uses the composable's `assemblyPlan` (doorway exclusions already
  applied). Page separators + physical page size exactly like the other
  printable docs.

## Panel patterns: `src/engine/exports/patterns.ts`

```ts
export interface PatternOptions {
  units: UnitSystem
  title: string
}
export function panelPatternsSvg(plan: PanelPlan, opts: PatternOptions): string
```

- One page per panel type (`data-pattern-page`), families in order
  P → R → Z:
  - **Triangles (P):** true shape from the edge triple (longest edge as
    base, apex from the law of cosines); each edge labeled with
    `formatLength`, each corner with its angle in degrees (law of
    cosines).
  - **Rects (R):** rectangle with w × h labeled, "riser sheathing" note.
  - **Rhombs (Z):** diamond from d1/d2 diagonals; diagonals, side length
    (√((d1/2)² + (d2/2)²)), and both corner angles labeled.
  - Every page: count needed (skin factor already in the plan counts),
    nesting hint (`${perSheet} per sheet — mirror alternates` or "seamed —
    too large for one sheet"), and the note "drawn to fit the page — cut
    from dimensions".
- Empty plan renders a single page with "no panels — everything is cut or
  painted open".

## Wiring

- Exporters `assemblyGuide` (`-assembly-guide.svg`, needs model, assemblyPlan,
  cutList, radius) and `panelPatterns` (`-panel-patterns.svg`).
- Export panel, Fabrication group: "Assembly guide SVG · course-by-course
  build book" and "Panel patterns SVG · dimensioned panel drawings".
- Assembly tab header gains a "Print guide" button (runs the same
  exporter) next to "Hub labels".

## Testing

- Guide: page count = courses + 1; per-course `data-new-strut` count =
  ringStrutIds + riserStrutIds lengths; cover contains totals and the
  rounded cut length of type A; a doored dome renders (excluded struts
  absent).
- Patterns: `data-pattern-page` count = types + rects + rhombs; triangle
  corner angles sum to 180 ± 0.01 (parse from the emitted `data-angle`
  attributes); formatted edge lengths present; empty plan renders the
  placeholder page.
- Refactor: full suite stays green after the `paper.ts` extraction (scale
  pins in the templates tests unchanged).

## Out of scope

- Exploded-view or 3D illustrations, fastener torque specs, share links,
  1:1 panel tiles.
