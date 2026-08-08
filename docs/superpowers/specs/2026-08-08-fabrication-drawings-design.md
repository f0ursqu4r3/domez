# Fabrication Drawings — Design Spec

**Date:** 2026-08-08
**Status:** Approved for planning

## Summary

Two printable SVG deliverables generated from data the engine already
computes: **1:1 end cut templates** (tape to the board, cut on the line) and
**board layout diagrams** (the visual version of the packing — stand at the
saw and work down the stack).

## Decisions (from brainstorming)

1. Templates are **end-region pages**, not full-length tiled boards: one
   letter/A4 page per distinct end signature, with the cut length given as a
   measure-and-mark dimension. Mitered ends group by rounded angle triple so
   page count stays sane.
2. Board diagrams ship as **one printable SVG document** — boards stacked,
   grouped by stock length, page-boundary rules for clean multi-page
   printing — downloadable next to Boards CSV.

## Module: `src/engine/exports/templates.ts`

Pure string-SVG builders in the style of `svg.ts`. No DOM.

### `cutTemplatesSvg`

```ts
export interface TemplateOptions {
  units: UnitSystem
  /** Paper: letter (8.5×11 in) for imperial, A4 (210×297 mm) for metric. */
  jointId: JointMethodId
  /** Working units. */
  endOffset: number
  radius: number
  section: { kind: 'rect'; width: number; depth: number } | { kind: 'round'; diameter: number }
  title: string
}
export function cutTemplatesSvg(model: DomeModel, cutList: CutList, opts: TemplateOptions): string
```

- **True scale:** the root SVG declares physical size (`width="8.5in"
  height="${pages * 11}in"` imperial; `width="210mm"` metric) with a viewBox
  in working units at 1 unit = 1 in/mm — printing at 100% is 1:1. Page one
  carries a **calibration ruler**: a 3 in / 75 mm bar labeled "verify before
  cutting".
- **End signatures:** group ends by strut type + joint geometry:
  - `hub` / `flattened-pipe`: one signature per type (square end). Page
    shows the cross-section outline, the square cut line, and for
    flattened-pipe the bolt-hole center at the chord endpoint with the
    flattening allowance (+1 × OD beyond the hole) drawn; for hub the end
    offset dimension to the hub center.
  - `timber-plate`: one signature per type — the axial bevel (90 −
    axialAngleDeg off square) drawn in side view (depth face), cut line at
    true angle.
  - `mitered`: signatures from `miterCuts(model)` grouped by
    `(leftSeamDeg, rightSeamDeg, tiltDeg)` each rounded to 0.1°, counted
    across all edge ends of the same strut type. Page shows plan view
    (width face): centerline, the two cheek lines at their true angles
    meeting on the ridge, plus a "blade tilt X°" callout.
- **Page layout:** each page block = header (template id, strut type label +
  color chip, "cut N ends like this", hub context for mitered), the 1:1
  drawing anchored to a **fold-over registration edge** (a bold line on the
  paper edge side, labeled "align to board edge"), and the cut-length
  dimension ("mark ROUNDED_CUT from this line — see cut list").
- **Pages** stack vertically in one SVG; crop-mark rules + dashed separators
  at every page height. Round sections in timber/mitered modes fall back to
  square-end pages with an angle note (mitering is a timber technique).
- Trimmed (†) and frame pieces get no pages; a footer note says they cut
  square at the buck/plate.

### `boardDiagramsSvg`

```ts
export interface BoardDiagramOptions {
  units: UnitSystem
  title: string
  /** Working-unit kerf, displayed in the footer. */
  kerf: number
}
export function boardDiagramsSvg(packing: PackingResult, opts: BoardDiagramOptions): string
```

- One horizontal bar per packed board, scaled so the longest stock spans the
  printable width; stacked in packing order, grouped under stock-length
  subheadings.
- Per bar: board number + stock label in the left margin; cut segments
  filled with `strutColor(typeId)` at 55 % alpha with label + rounded length
  inside (or above, when the segment is narrow); kerf ticks between cuts;
  waste tail hatched with its length.
- Page-boundary dashed rules at letter/A4 heights; footer totals: boards per
  stock label, total stock, waste %, kerf used.
- Includes every packed piece (struts, trimmed, bucks, closure/riser
  framing) automatically — it draws the packing as-is.

## Wiring

- `useDomeProject.exporters` gains `cutTemplates` and `boardDiagrams`
  (download `-cut-templates.svg` / `-board-diagrams.svg`), passing
  `strutSectionWorking`, `state.jointId`, `workingEndOffset`, `radius`,
  `cutList`, `packing`, `workingKerf`, `titleOf()`.
- Export panel, Fabrication group: "Cut templates SVG · 1:1 tape-on end
  templates" and "Board diagrams SVG · visual cutting plan" (always
  visible; templates adapt to the joint method).

## Testing

- Scale pins: root `width` attribute matches paper (8.5in / 210mm); the
  calibration ruler path's coordinate length equals exactly 3 (imperial) /
  75 (metric) working units.
- Grouping: timber-plate 3V leveled → one template page per strut type;
  mitered Z8 → ≥ 2 signatures for the A type; flattened-pipe pages contain
  a hole-center marker.
- Board diagrams: bar count = `packing.boards.length`; kerf tick count per
  board = cuts − 1; waste text present; stock subheadings present; empty
  and doored/risered projects both render.
- All string-level assertions (the exporters return SVG text).

## Out of scope

- Panel flat patterns, assembly guide PDF, DXF variants, per-hub drill
  templates.
