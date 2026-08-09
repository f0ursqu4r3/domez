# UI Panel Reorganization + Collapsible Sections — Design Spec

**Date:** 2026-08-08
**Status:** Approved for planning

## Summary

Reorganize both sidebars around a shared collapsible-section primitive:
the left parameters panel keeps its four groups but each collapses; the
right data sidebar shrinks from seven tabs to four, with merged tabs
stacking the existing panel components inside collapsible sections.
Open/closed state persists per section in localStorage — separate from
project settings, so exported project JSON carries no UI preferences.

## Decisions (from brainstorming)

1. Scope: both sidebars.
2. Right tabs regroup 7 → 4: **Parts** (Struts + Hubs), **Openings**,
   **Materials** (sheet/board packing + Costs), **Build** (Assembly +
   Export).
3. Collapse behavior: independent (any number open), persisted to
   localStorage, restored per session. Default: everything open —
   today's behavior on first load.

## New component: `src/components/ui/collapsible-section/`

`CollapsibleSection.vue`, wrapping reka-ui `CollapsibleRoot` /
`CollapsibleTrigger` / `CollapsibleContent` (reka-ui ^2.10.1 is already a
dependency; matches the design-system idiom — native `<details>` rejected:
no animation, off-system styling).

```ts
// Props
interface Props {
  id: string      // stable persistence key, e.g. 'left:geometry'
  title: string   // header text, rendered in the existing section-title style
}
// Slots: default (body), badge (optional right-aligned summary, e.g. counts)
```

- Trigger row: title left, optional badge, chevron right; chevron rotates
  90° when open. Full-row click target.
- Content animates open/closed via the standard reka-ui
  grid-rows/height transition used by shadcn-style collapsibles.
- Open state is read/written through the UI-state store below, keyed by
  `id`. Absent key = open.

## UI state store: `src/composables/useUiState.ts`

```ts
interface UiState {
  /** Collapsed section ids — sparse; absent = open. */
  collapsed: Record<string, boolean>
}
export function useUiState(): {
  isOpen(id: string): boolean
  setOpen(id: string, open: boolean): void
}
```

- Singleton reactive, persisted to localStorage key **`domez:ui`** via a
  deep watcher (same pattern as the project persistence watcher in
  `useDomeProject`).
- Deliberately NOT part of `ProjectSettings` / project JSON export, and
  NOT cleared by Reset-to-defaults (UI prefs are not project data).
- Corrupt/missing localStorage → fresh empty state (everything open).

## Left sidebar: `ParametersPanel.vue`

Same four groups, each `<section>` + `section-title` header replaced by a
`CollapsibleSection`; separators between sections retained:

| id | title |
|---|---|
| `left:geometry` | Geometry |
| `left:material` | Material & joints |
| `left:fabrication` | Fabrication |
| `left:optimizer` | Diameter optimizer |

No field moves between groups; field markup is unchanged inside the
sections.

## Right sidebar: `App.vue` tabs 7 → 4

| Tab value | Trigger label | Body |
|---|---|---|
| `parts` | Parts | `PartsTab.vue`: sections **Struts** (`right:struts`, StrutsPanel) + **Hubs** (`right:hubs`, HubsPanel) |
| `openings` | Openings | OpeningsPanel, unchanged |
| `materials` | Materials | `MaterialsTab.vue`: sections **Sheets & boards** (`right:sheets`, MaterialsPanel) + **Costs** (`right:costs`, CostsPanel) |
| `build` | Build | `BuildTab.vue`: sections **Assembly** (`right:assembly`, AssemblyPanel) + **Export** (`right:export`, ExportPanel) |

- New thin wrapper components live in `src/components/panels/` alongside
  the panels they stack. Existing panel components are not modified —
  wrappers only compose them.
- Each merged tab body sits in one `ScrollArea` (the whole tab scrolls;
  sections collapse within it). MaterialsPanel currently manages its own
  height/scroll — inside the Materials tab it renders as a normal block
  in the shared scroll; adjust its root classes only if its internal
  layout assumes `h-full`.
- `Tabs default-value` becomes `parts`.

## Out of scope

- Persisting the active tab.
- Moving fields between left-panel groups.
- Any engine, export, or data-logic change.

## Testing

- Engine test suite untouched (no engine changes) — must stay green.
- Live browser verification: collapse several sections on both sides →
  reload → state restored; all four tabs render their merged content;
  a CSV export still downloads from the Build tab; Reset-to-defaults
  leaves collapse state alone; `domez:ui` key present in localStorage
  with the expected shape.
