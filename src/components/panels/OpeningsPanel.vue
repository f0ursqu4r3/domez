<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import type { OpeningType } from '@/engine/openings'
import { formatLength } from '@/engine/units'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { DoorOpen, AppWindow, Fan, Eraser, Sparkles, Trash2, TriangleAlert, X } from '@lucide/vue'
import type { DoorPlacementResult } from '@/engine/doorway'
import { ref, watch } from 'vue'

const project = useDomeProject()
const { state, openingGroups, doorway } = project

/** Last placement-optimization summary per door index. */
const placementResults = ref<Record<number, DoorPlacementResult>>({})
// Door list changes shift indices — drop stale summaries.
watch(
  () => state.doors.length,
  () => (placementResults.value = {}),
)

function optimizePlacement(index: number) {
  const result = project.optimizeDoorPosition(index)
  if (result) placementResults.value = { ...placementResults.value, [index]: result }
}

const MM_PER_INCH = 25.4
const smallUnit = computed(() => (state.units === 'imperial' ? 'in' : 'mm'))
const toDisplay = (mm: number) =>
  state.units === 'imperial' ? Math.round((mm / MM_PER_INCH) * 100) / 100 : Math.round(mm * 10) / 10
const fromDisplay = (v: number) => (state.units === 'imperial' ? v * MM_PER_INCH : v)

const TYPE_META: Record<OpeningType, { label: string; color: string; icon: unknown }> = {
  door: { label: 'Door', color: '#c9873a', icon: DoorOpen },
  window: { label: 'Window', color: '#8ecbff', icon: AppWindow },
  vent: { label: 'Vent', color: '#7fe0b2', icon: Fan },
}

const tools = [
  { value: 'door', label: 'Door', icon: DoorOpen },
  { value: 'window', label: 'Window', icon: AppWindow },
  { value: 'vent', label: 'Vent', icon: Fan },
  { value: 'erase', label: 'Erase', icon: Eraser },
] as const

const areaText = (area: number) =>
  state.units === 'imperial' ? `${(area / 144).toFixed(1)} ft²` : `${(area / 1e6).toFixed(2)} m²`

const totals = computed(() => {
  const glazing = openingGroups.value
    .filter((g) => g.type === 'window')
    .reduce((s, g) => s + g.area, 0)
  return {
    doors: doorway.value.doors.length,
    windows: openingGroups.value.filter((g) => g.type === 'window').length,
    vents: openingGroups.value.filter((g) => g.type === 'vent').length,
    glazing,
    panels: Object.keys(state.openings).length,
  }
})

function toggleHighlight(label: string) {
  state.highlightOpening = state.highlightOpening === label ? null : label
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <section>
      <h3 class="section-title">Place openings</h3>
      <ToggleGroup
        :model-value="state.openingTool === 'off' ? '' : state.openingTool"
        type="single"
        variant="outline"
        class="w-full"
        @update:model-value="(v: any) => (state.openingTool = v || 'off')"
      >
        <ToggleGroupItem v-for="t in tools" :key="t.value" :value="t.value" class="flex-1 text-xs">
          <component :is="t.icon" data-icon="inline-start" />
          {{ t.label }}
        </ToggleGroupItem>
      </ToggleGroup>
      <p class="mt-2 text-xs text-muted-foreground leading-relaxed">
        {{
          state.openingTool === 'off'
            ? 'Door: click the dome where the doorway goes — it cuts the frame and gets real dimensions below. Window/vent: paint panels; adjacent panels merge.'
            : state.openingTool === 'door'
              ? 'Click the dome at the doorway position. The door is placed at that compass bearing.'
              : state.openingTool === 'erase'
                ? 'Click painted panels in the viewer to clear them. Pick the tool again to stop.'
                : `Click panels in the viewer to place ${state.openingTool} panels. Pick the tool again to stop.`
        }}
      </p>
    </section>

    <Separator />

    <!-- Parametric doorways -->
    <section v-if="doorway.doors.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h3 class="section-title mb-0">Doorways</h3>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Close shell to buck
          <Switch
            :model-value="state.closeDoorways"
            @update:model-value="(v: boolean) => (state.closeDoorways = v)"
          />
        </label>
      </div>
      <div
        v-for="(door, i) in doorway.doors"
        :key="door.id"
        class="rounded-md border border-border bg-card p-3 flex flex-col gap-2.5"
      >
        <div class="flex items-center gap-2">
          <span
            class="inline-flex size-6 items-center justify-center rounded-sm"
            style="background: #c9873a33; color: #c9873a"
          >
            <DoorOpen class="size-3.5" />
          </span>
          <span class="font-mono font-semibold text-sm">{{ door.id }}</span>
          <span class="text-xs text-muted-foreground">
            {{ formatLength(door.width, state.units) }} × {{ formatLength(door.height, state.units) }}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            class="ml-auto"
            title="Remove doorway"
            @click="project.removeDoor(i)"
          >
            <X />
          </Button>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <Field>
            <FieldLabel class="text-xs">Width ({{ smallUnit }})</FieldLabel>
            <Input
              type="number" min="1" step="1" class="font-mono h-8"
              :model-value="toDisplay(state.doors[i].widthMm)"
              @update:model-value="(v) => { const n = Number(v); if (n > 0) state.doors[i].widthMm = fromDisplay(n) }"
            />
          </Field>
          <Field>
            <FieldLabel class="text-xs">Height ({{ smallUnit }})</FieldLabel>
            <Input
              type="number" min="1" step="1" class="font-mono h-8"
              :model-value="toDisplay(state.doors[i].heightMm)"
              @update:model-value="(v) => { const n = Number(v); if (n > 0) state.doors[i].heightMm = fromDisplay(n) }"
            />
          </Field>
          <Field>
            <FieldLabel class="text-xs">Bearing (°)</FieldLabel>
            <Input
              type="number" min="0" max="359" step="1" class="font-mono h-8"
              :model-value="state.doors[i].azimuthDeg"
              @update:model-value="(v) => (state.doors[i].azimuthDeg = ((Number(v) % 360) + 360) % 360)"
            />
          </Field>
          <Field>
            <FieldLabel class="text-xs">Depth ({{ smallUnit }})</FieldLabel>
            <Input
              type="number" step="1" class="font-mono h-8"
              title="Recess of the buck plane vs auto fit — negative pushes it toward the shell"
              :model-value="toDisplay(state.doors[i].depthMm)"
              @update:model-value="(v) => (state.doors[i].depthMm = fromDisplay(Number(v) || 0))"
            />
          </Field>
          <Field>
            <FieldLabel class="text-xs">Margin ({{ smallUnit }})</FieldLabel>
            <Input
              type="number" min="0" step="0.5" class="font-mono h-8"
              title="Clearance band cut beyond the rough opening (trim/shim zone)"
              :model-value="toDisplay(state.doors[i].marginMm)"
              @update:model-value="(v) => { const n = Number(v); state.doors[i].marginMm = n > 0 ? fromDisplay(n) : 0 }"
            />
          </Field>
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt class="text-muted-foreground">Buck members</dt>
          <dd class="text-right font-mono">
            2× jamb {{ formatLength(door.jambLength, state.units) }} · 1× header {{ formatLength(door.headerLength, state.units) }}
          </dd>
          <dt class="text-muted-foreground">Struts</dt>
          <dd class="text-right font-mono">
            {{ door.removedStrutCount }} removed · {{ door.trimmedStrutCount }} trimmed to buck
          </dd>
          <dt class="text-muted-foreground">Hubs removed</dt>
          <dd class="text-right font-mono">{{ door.removedHubCount }}</dd>
          <dt class="text-muted-foreground">Buck plane inset</dt>
          <dd class="text-right font-mono">{{ formatLength(door.tunnelDepth, state.units) }}</dd>
          <template v-if="state.closeDoorways && door.fits">
            <dt class="text-muted-foreground">Closure sheathing</dt>
            <dd class="text-right font-mono">
              sides {{ areaText(door.closureSideArea) }} · top {{ areaText(door.closureTopArea)
              }}<template v-if="door.closureFaceArea > 1"> · face {{ areaText(door.closureFaceArea) }}</template>
            </dd>
            <dt class="text-muted-foreground">Closure framing</dt>
            <dd class="text-right font-mono">
              {{ door.closureFraming.reduce((n, m) => n + m.quantity, 0) }} pcs — in cut list
            </dd>
          </template>
        </dl>

        <Button size="sm" variant="outline" class="w-full" @click="optimizePlacement(i)">
          <Sparkles data-icon="inline-start" />
          Optimize placement
        </Button>
        <p v-if="placementResults[i]" class="text-xs leading-relaxed" :class="placementResults[i].improved ? 'text-primary' : 'text-muted-foreground'">
          <template v-if="placementResults[i].improved">
            Moved {{ placementResults[i].fromAzimuthDeg.toFixed(0) }}° →
            {{ placementResults[i].azimuthDeg.toFixed(2) }}° · trims
            {{ placementResults[i].before.trimmed }} → {{ placementResults[i].after.trimmed }} ·
            hubs out {{ placementResults[i].before.hubsRemoved }} →
            {{ placementResults[i].after.hubsRemoved }} · custom lengths
            {{ placementResults[i].before.distinctTrims }} → {{ placementResults[i].after.distinctTrims }}
          </template>
          <template v-else>
            Already at the cleanest bearing within ±36° ({{ placementResults[i].evaluated }} positions checked).
          </template>
        </p>

        <p v-if="!door.fits" class="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert class="size-3.5 shrink-0" />
          Doorway doesn't fit inside the shell — reduce width or height.
        </p>
        <p v-else class="text-xs text-muted-foreground leading-relaxed">
          Trimmed struts († rows in the cut list) land square on the buck. Jambs anchor to the
          foundation; the header carries the interrupted struts.
          <template v-if="state.closeDoorways">
            The extruded entry is closed with sheet goods: two side walls and a flat top from the
            buck out to the shell — trimmed struts land along those closure edges.
          </template>
        </p>
      </div>
    </section>

    <Separator v-if="doorway.doors.length > 0" />

    <Empty
      v-if="openingGroups.length === 0 && doorway.doors.length === 0"
      class="border border-dashed border-border rounded-lg py-10"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon"><DoorOpen /></EmptyMedia>
        <EmptyTitle>No openings yet</EmptyTitle>
        <EmptyDescription>
          Place a doorway with real dimensions and paint windows where you want light — the
          schedule, glazing areas, and framing changes appear here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>

    <template v-else-if="openingGroups.length > 0">
      <section class="flex flex-wrap gap-2">
        <Badge variant="secondary" class="font-mono"
          >{{ totals.doors }} door{{ totals.doors === 1 ? '' : 's' }}</Badge
        >
        <Badge variant="secondary" class="font-mono"
          >{{ totals.windows }} window{{ totals.windows === 1 ? '' : 's' }}</Badge
        >
        <Badge variant="secondary" class="font-mono"
          >{{ totals.vents }} vent{{ totals.vents === 1 ? '' : 's' }}</Badge
        >
        <Badge variant="secondary" class="font-mono">glazing {{ areaText(totals.glazing) }}</Badge>
        <Button size="sm" variant="ghost" class="ml-auto text-xs" @click="project.clearOpenings()">
          <Trash2 data-icon="inline-start" />
          Clear all
        </Button>
      </section>

      <ol class="flex flex-col gap-2">
        <li
          v-for="g in openingGroups"
          :key="g.label"
          class="rounded-md border bg-card p-3 flex flex-col gap-2 cursor-pointer transition-colors"
          :class="state.highlightOpening === g.label ? 'border-primary/60' : 'border-border'"
          @click="toggleHighlight(g.label)"
        >
          <div class="flex items-center gap-2">
            <span
              class="inline-flex size-6 items-center justify-center rounded-sm"
              :style="{
                background: TYPE_META[g.type].color + '33',
                color: TYPE_META[g.type].color,
              }"
            >
              <component :is="TYPE_META[g.type].icon" class="size-3.5" />
            </span>
            <span class="font-mono font-semibold text-sm">{{ g.label }}</span>
            <span class="text-xs text-muted-foreground"
              >{{ TYPE_META[g.type].label }} · {{ g.faceIds.length }} panel{{
                g.faceIds.length === 1 ? '' : 's'
              }}</span
            >
            <Button
              size="icon-sm"
              variant="ghost"
              class="ml-auto"
              title="Remove opening"
              @click.stop="project.removeOpeningGroup(g)"
            >
              <X />
            </Button>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt class="text-muted-foreground">Area</dt>
            <dd class="text-right font-mono">{{ areaText(g.area) }}</dd>
            <dt class="text-muted-foreground">Frame perimeter</dt>
            <dd class="text-right font-mono">
              {{ formatLength(g.perimeter, state.units, { long: true }) }}
            </dd>
            <dt class="text-muted-foreground">Perimeter struts</dt>
            <dd class="text-right font-mono">{{ g.perimeterSummary }}</dd>
            <template v-if="g.interiorEdgeIds.length > 0">
              <dt class="text-muted-foreground">Frame out on site</dt>
              <dd class="text-right font-mono">{{ g.interiorSummary }}</dd>
            </template>
          </dl>
          <p
            v-if="g.type === 'door' && !g.reachesBase"
            class="flex items-center gap-1.5 text-xs text-destructive"
          >
            <TriangleAlert class="size-3.5 shrink-0" />
            Door doesn't reach the base ring — extend it down or plan a landing.
          </p>
        </li>
      </ol>

      <p class="text-xs text-muted-foreground leading-relaxed">
        Struts inside a multi-panel opening stay in the cut list — they're cut out and reused as
        framing when the opening is bucked out. Glazing/door slabs are not part of the strut
        takeoff.
      </p>
    </template>
  </div>
</template>
