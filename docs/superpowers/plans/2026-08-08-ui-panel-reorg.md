# UI Panel Reorganization + Collapsible Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapsible, state-persisted sections in both sidebars, and the right sidebar's seven tabs regrouped into four.

**Architecture:** A `useUiState` composable persists collapsed-section ids to localStorage key `domez:ui` (separate from project settings). A `CollapsibleSection` component (reka-ui Collapsible) reads/writes that store by section id. The left ParametersPanel swaps its four static `<section>` headers for CollapsibleSections; the right sidebar gets three thin wrapper tabs (Parts, Materials, Build) that stack the existing panel components inside CollapsibleSections.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, reka-ui ^2.10.1, Tailwind v4, vitest (bun).

## Global Constraints

- localStorage key is exactly `domez:ui`; it is NOT part of `ProjectSettings`, project JSON export, or Reset-to-defaults.
- Absent id in the store = section open. Default state on fresh load: everything open.
- Section ids (verbatim): `left:geometry`, `left:material`, `left:fabrication`, `left:optimizer`, `right:struts`, `right:hubs`, `right:sheets`, `right:costs`, `right:assembly`, `right:export`.
- Tab values (verbatim): `parts`, `openings`, `materials`, `build`; default tab `parts`.
- Existing panel components (StrutsPanel, HubsPanel, CostsPanel, AssemblyPanel, ExportPanel, OpeningsPanel) are composed, not modified. Exception: MaterialsPanel's internal ScrollArea becomes a plain div because the Materials tab now owns scrolling.
- No engine changes; `bun run test` (111 tests + new ones) and `bun run build` must pass before every commit. Gate commits on exit codes: `cmd > /tmp/x.out 2>&1; RC=$?; tail -5 /tmp/x.out; [ $RC -eq 0 ] && git commit ...`.

---

### Task 1: `useUiState` composable

**Files:**
- Create: `src/composables/useUiState.ts`
- Test: `src/composables/__tests__/uiState.test.ts`

**Interfaces:**
- Consumes: nothing (vue `reactive`/`watch` only).
- Produces: `createUiState(storage: Pick<Storage, 'getItem' | 'setItem'> | null): { isOpen(id: string): boolean; setOpen(id: string, open: boolean): void }` and singleton `useUiState()` with the same shape. Task 2 calls `useUiState()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/composables/__tests__/uiState.test.ts
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createUiState } from '../useUiState'

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('ui collapse state', () => {
  it('defaults open, persists collapses, restores on reload', async () => {
    const storage = memoryStorage()
    const ui = createUiState(storage)
    expect(ui.isOpen('left:geometry')).toBe(true)
    ui.setOpen('left:geometry', false)
    expect(ui.isOpen('left:geometry')).toBe(false)
    await nextTick() // persistence watcher flush
    const reloaded = createUiState(storage)
    expect(reloaded.isOpen('left:geometry')).toBe(false)
    expect(reloaded.isOpen('right:struts')).toBe(true)
  })

  it('reopen removes the key; corrupt storage falls back to all-open', async () => {
    const corrupt = memoryStorage({ 'domez:ui': 'not json{{' })
    const ui = createUiState(corrupt)
    expect(ui.isOpen('anything')).toBe(true)
    ui.setOpen('a', false)
    ui.setOpen('a', true)
    await nextTick()
    const reloaded = createUiState(corrupt)
    expect(reloaded.isOpen('a')).toBe(true)
  })

  it('survives a null storage (SSR/tests)', () => {
    const ui = createUiState(null)
    ui.setOpen('x', false)
    expect(ui.isOpen('x')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../useUiState'` (or equivalent resolution error).

- [ ] **Step 3: Write the implementation**

```ts
// src/composables/useUiState.ts
import { reactive, watch } from 'vue'

const UI_KEY = 'domez:ui'

/** UI-only preferences — deliberately outside ProjectSettings/JSON export. */
interface UiState {
  /** Collapsed section ids — sparse; absent = open. */
  collapsed: Record<string, boolean>
}

export function createUiState(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  const state = reactive<UiState>({ collapsed: {} })
  try {
    const raw = storage?.getItem(UI_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      const collapsed = (parsed as { collapsed?: unknown })?.collapsed
      if (collapsed && typeof collapsed === 'object') {
        for (const [k, v] of Object.entries(collapsed)) {
          if (v === true) state.collapsed[k] = true
        }
      }
    }
  } catch {
    // Corrupt storage — fresh all-open state.
  }
  watch(
    () => JSON.stringify(state.collapsed),
    () => {
      try {
        storage?.setItem(UI_KEY, JSON.stringify({ collapsed: state.collapsed }))
      } catch {
        // Storage full/unavailable — persistence is best-effort.
      }
    },
  )
  return {
    isOpen: (id: string) => state.collapsed[id] !== true,
    setOpen: (id: string, open: boolean) => {
      if (open) delete state.collapsed[id]
      else state.collapsed[id] = true
    },
  }
}

let singleton: ReturnType<typeof createUiState> | null = null

export function useUiState() {
  if (!singleton) {
    singleton = createUiState(typeof localStorage === 'undefined' ? null : localStorage)
  }
  return singleton
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test 2>&1 | tail -5`
Expected: PASS, 114 tests (111 + 3).

- [ ] **Step 5: Commit**

```bash
bun run test > /tmp/t.out 2>&1; RC=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && git add src/composables/useUiState.ts src/composables/__tests__/uiState.test.ts && git commit -m "feat: persisted UI collapse-state store (domez:ui)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `CollapsibleSection` component

**Files:**
- Create: `src/components/ui/collapsible-section/CollapsibleSection.vue`
- Create: `src/components/ui/collapsible-section/index.ts`
- Modify: `src/assets/index.css` (append keyframes at end of file)

**Interfaces:**
- Consumes: `useUiState()` from Task 1.
- Produces: `<CollapsibleSection id title>` with default slot (body) and optional `badge` slot, imported as `import { CollapsibleSection } from '@/components/ui/collapsible-section'`. Tasks 3–4 use it.

- [ ] **Step 1: Write the component**

```vue
<!-- src/components/ui/collapsible-section/CollapsibleSection.vue -->
<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { ChevronDown } from '@lucide/vue'
import { useUiState } from '@/composables/useUiState'

const props = defineProps<{
  /** Stable persistence key, e.g. 'left:geometry'. */
  id: string
  title: string
}>()
const ui = useUiState()
</script>

<template>
  <CollapsibleRoot
    :open="ui.isOpen(props.id)"
    @update:open="(v: boolean) => ui.setOpen(props.id, v)"
  >
    <CollapsibleTrigger class="group flex w-full cursor-pointer items-center gap-2 text-left">
      <h3 class="section-title mb-0 flex-1">{{ props.title }}</h3>
      <slot name="badge" />
      <ChevronDown
        class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90"
      />
    </CollapsibleTrigger>
    <CollapsibleContent class="collapsible-body">
      <div class="pt-3"><slot /></div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
```

```ts
// src/components/ui/collapsible-section/index.ts
export { default as CollapsibleSection } from './CollapsibleSection.vue'
```

- [ ] **Step 2: Append the animation CSS to `src/assets/index.css`**

```css
.collapsible-body {
  overflow: hidden;
}
.collapsible-body[data-state='open'] {
  animation: collapsible-down 0.15s ease-out;
}
.collapsible-body[data-state='closed'] {
  animation: collapsible-up 0.15s ease-out;
}
@keyframes collapsible-down {
  from {
    height: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
  }
}
@keyframes collapsible-up {
  from {
    height: var(--reka-collapsible-content-height);
  }
  to {
    height: 0;
  }
}
```

- [ ] **Step 3: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: build clean (vue-tsc + vite), 114 tests pass.

- [ ] **Step 4: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/components/ui/collapsible-section src/assets/index.css && git commit -m "feat: CollapsibleSection component wired to persisted UI state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Left sidebar — collapsible parameter sections

**Files:**
- Modify: `src/components/panels/ParametersPanel.vue` (template only)

**Interfaces:**
- Consumes: `CollapsibleSection` from Task 2.
- Produces: nothing downstream.

- [ ] **Step 1: Add the import**

In the `<script setup>` import block add:

```ts
import { CollapsibleSection } from '@/components/ui/collapsible-section'
```

- [ ] **Step 2: Convert the four sections**

For each of the four `<section>` blocks, replace the wrapper and drop its `<h3 class="section-title">…</h3>` line. Pattern (Geometry shown; the section's existing inner content is unchanged):

```html
<!-- before -->
<section>
  <h3 class="section-title">Geometry</h3>
  <FieldGroup class="gap-4"> … </FieldGroup>
</section>

<!-- after -->
<CollapsibleSection id="left:geometry" title="Geometry">
  <FieldGroup class="gap-4"> … </FieldGroup>
</CollapsibleSection>
```

Mapping: `left:geometry` "Geometry", `left:material` "Material & joints" (title prop: `title="Material &amp; joints"` is not needed — plain string `Material & joints` in the prop), `left:fabrication` "Fabrication", `left:optimizer` "Diameter optimizer". Keep the three `<Separator />`s between them. Note: the root `div` keeps `gap-5 p-4`; CollapsibleSection's own content `pt-3` replaces the old `section-title` bottom margin.

- [ ] **Step 3: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/components/panels/ParametersPanel.vue && git commit -m "feat: collapsible parameter sections in the left sidebar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Right sidebar — 7 tabs → 4 with merged collapsible tabs

**Files:**
- Create: `src/components/panels/PartsTab.vue`
- Create: `src/components/panels/MaterialsTab.vue`
- Create: `src/components/panels/BuildTab.vue`
- Modify: `src/components/panels/MaterialsPanel.vue` (internal ScrollArea → div)
- Modify: `src/App.vue` (tab list + contents)

**Interfaces:**
- Consumes: `CollapsibleSection` (Task 2); existing StrutsPanel, HubsPanel, MaterialsPanel, CostsPanel, AssemblyPanel, ExportPanel.
- Produces: `PartsTab.vue`, `MaterialsTab.vue`, `BuildTab.vue` default exports used by App.vue.

- [ ] **Step 1: Create the three wrapper tabs**

The stacked panels keep their own `p-4` roots and internal headings; the wrapper adds only the section header rows (padded to align at 16px) and separators. All three files follow the identical pattern:

```vue
<!-- src/components/panels/PartsTab.vue -->
<script setup lang="ts">
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import StrutsPanel from './StrutsPanel.vue'
import HubsPanel from './HubsPanel.vue'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:struts" title="Struts" class="px-4">
      <StrutsPanel class="-mx-4" />
    </CollapsibleSection>
    <Separator class="my-3" />
    <CollapsibleSection id="right:hubs" title="Hubs" class="px-4">
      <HubsPanel class="-mx-4" />
    </CollapsibleSection>
  </div>
</template>
```

```vue
<!-- src/components/panels/MaterialsTab.vue -->
<script setup lang="ts">
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import MaterialsPanel from './MaterialsPanel.vue'
import CostsPanel from './CostsPanel.vue'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:sheets" title="Sheets &amp; boards" class="px-4">
      <MaterialsPanel class="-mx-4" />
    </CollapsibleSection>
    <Separator class="my-3" />
    <CollapsibleSection id="right:costs" title="Costs" class="px-4">
      <CostsPanel class="-mx-4" />
    </CollapsibleSection>
  </div>
</template>
```

Note: in the `title` prop use the plain string `Sheets & boards` (props are not HTML).

```vue
<!-- src/components/panels/BuildTab.vue -->
<script setup lang="ts">
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import AssemblyPanel from './AssemblyPanel.vue'
import ExportPanel from './ExportPanel.vue'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:assembly" title="Assembly" class="px-4">
      <AssemblyPanel class="-mx-4" />
    </CollapsibleSection>
    <Separator class="my-3" />
    <CollapsibleSection id="right:export" title="Export" class="px-4">
      <ExportPanel class="-mx-4" />
    </CollapsibleSection>
  </div>
</template>
```

The `class="px-4"` on CollapsibleSection lands on `CollapsibleRoot` via Vue attribute fallthrough; the `-mx-4` on each panel cancels the double horizontal padding (panel keeps its own `p-4`).

- [ ] **Step 2: MaterialsPanel — nested scroll becomes a block**

In `src/components/panels/MaterialsPanel.vue`: the Materials tab now owns scrolling, so replace the cutting-diagrams `<ScrollArea class="flex-1 min-h-0 pr-3">…</ScrollArea>` with `<div class="pr-3">…</div>`, and remove the now-unused `import { ScrollArea } from '@/components/ui/scroll-area'` line. Leave everything else untouched.

- [ ] **Step 3: Rewire App.vue**

Replace the panel imports (drop StrutsPanel, HubsPanel, MaterialsPanel, CostsPanel, AssemblyPanel, ExportPanel; keep OpeningsPanel):

```ts
import PartsTab from '@/components/panels/PartsTab.vue'
import MaterialsTab from '@/components/panels/MaterialsTab.vue'
import BuildTab from '@/components/panels/BuildTab.vue'
import OpeningsPanel from '@/components/panels/OpeningsPanel.vue'
```

Replace the `<Tabs>` block:

```html
<Tabs default-value="parts" class="flex h-full min-h-0 flex-col gap-0">
  <TabsList
    class="w-full justify-start rounded-none border-b border-border bg-transparent px-2 pt-1.5"
  >
    <TabsTrigger value="parts" class="text-xs">Parts</TabsTrigger>
    <TabsTrigger value="openings" class="text-xs">Openings</TabsTrigger>
    <TabsTrigger value="materials" class="text-xs">Materials</TabsTrigger>
    <TabsTrigger value="build" class="text-xs">Build</TabsTrigger>
  </TabsList>
  <TabsContent value="parts" class="min-h-0 flex-1"
    ><ScrollArea class="h-full"><PartsTab /></ScrollArea
  ></TabsContent>
  <TabsContent value="openings" class="min-h-0 flex-1"
    ><ScrollArea class="h-full"><OpeningsPanel /></ScrollArea
  ></TabsContent>
  <TabsContent value="materials" class="min-h-0 flex-1"
    ><ScrollArea class="h-full"><MaterialsTab /></ScrollArea
  ></TabsContent>
  <TabsContent value="build" class="min-h-0 flex-1"
    ><ScrollArea class="h-full"><BuildTab /></ScrollArea
  ></TabsContent>
</Tabs>
```

- [ ] **Step 4: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: both clean (vue-tsc catches unused imports).

- [ ] **Step 5: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/components/panels/PartsTab.vue src/components/panels/MaterialsTab.vue src/components/panels/BuildTab.vue src/components/panels/MaterialsPanel.vue src/App.vue && git commit -m "feat: right sidebar regrouped to 4 tabs with collapsible sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Live verification

**Files:** none (browser only; fix-forward commits if issues surface).

- [ ] **Step 1: Start/reload the preview** (dev server via preview tooling, `window.location.reload()` to clear HMR singletons).

- [ ] **Step 2: Left sidebar** — collapse "Fabrication" and "Diameter optimizer"; confirm sections animate shut and the chevrons rotate; confirm Geometry controls still work (change frequency, model updates).

- [ ] **Step 3: Right sidebar** — visit all four tabs; confirm Parts shows Struts + Hubs sections, Materials shows Sheets & boards + Costs (cutting diagrams fully rendered — no nested scrollbar), Build shows Assembly + Export. Collapse "Hubs".

- [ ] **Step 4: Persistence round-trip** — reload the page; confirm Fabrication, Diameter optimizer, and Hubs stay collapsed, everything else open. Inspect `localStorage['domez:ui']` — expect `{"collapsed":{"left:fabrication":true,"left:optimizer":true,"right:hubs":true}}`.

- [ ] **Step 5: Isolation checks** — click a CSV export in Build tab (download fires); Reset-to-defaults; confirm `domez:ui` unchanged and project JSON export contains no `collapsed`/`ui` field.

- [ ] **Step 6: Screenshot** both sidebars for the completion report.

- [ ] **Step 7: If any visual fix was needed, commit it**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add -A src && git commit -m "fix: panel reorg polish from live verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
