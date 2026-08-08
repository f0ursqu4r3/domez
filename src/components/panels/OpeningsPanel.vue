<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import type { OpeningType } from '@/engine/openings'
import { formatLength } from '@/engine/units'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { DoorOpen, AppWindow, Fan, Eraser, Trash2, TriangleAlert, X } from '@lucide/vue'
import FramedOpeningCard from './FramedOpeningCard.vue'

const project = useDomeProject()
const { state, openingGroups, doorway, doorInfos, windowInfos } = project

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
    doors: doorInfos.value.length,
    windows:
      windowInfos.value.length + openingGroups.value.filter((g) => g.type === 'window').length,
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
            ? 'Door and window place framed openings that cut the frame — click the dome where they go, then dial in dimensions below. Vent paints panels.'
            : state.openingTool === 'door'
              ? 'Click the dome at the doorway position. The door is placed at that compass bearing.'
              : state.openingTool === 'window'
                ? 'Click the dome where the window goes — it centers on the clicked height and gets a sill, framing, and closure.'
                : state.openingTool === 'erase'
                  ? 'Click painted panels in the viewer to clear them. Pick the tool again to stop.'
                  : `Click panels in the viewer to place ${state.openingTool} panels. Pick the tool again to stop.`
        }}
      </p>
    </section>

    <Separator />

    <!-- Parametric framed openings -->
    <section v-if="doorway.doors.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h3 class="section-title mb-0">Framed openings</h3>
        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          Close shell to buck
          <Switch
            :model-value="state.closeDoorways"
            @update:model-value="(v: boolean) => (state.closeDoorways = v)"
          />
        </label>
      </div>
      <FramedOpeningCard
        v-for="(info, i) in doorInfos"
        :key="info.id"
        kind="door"
        :index="i"
        :info="info"
      />
      <FramedOpeningCard
        v-for="(info, i) in windowInfos"
        :key="info.id"
        kind="window"
        :index="i"
        :info="info"
      />
      <p class="text-xs text-muted-foreground leading-relaxed">
        Trimmed struts († rows in the cut list) land square on the buck. Jambs, headers, and window
        sills join the cut list; the closure seals each opening back to the shell with connected
        framing.
      </p>
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
