<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import type { DoorFrameInfo, DoorPlacementResult } from '@/engine/doorway'
import { formatLength } from '@/engine/units'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { DoorOpen, AppWindow, Sparkles, TriangleAlert, X } from '@lucide/vue'

const props = defineProps<{
  kind: 'door' | 'window'
  index: number
  info: DoorFrameInfo
}>()

const project = useDomeProject()
const { state } = project

const MM_PER_INCH = 25.4
const smallUnit = computed(() => (state.units === 'imperial' ? 'in' : 'mm'))
const toDisplay = (mm: number) =>
  state.units === 'imperial' ? Math.round((mm / MM_PER_INCH) * 100) / 100 : Math.round(mm * 10) / 10
const fromDisplay = (v: number) => (state.units === 'imperial' ? v * MM_PER_INCH : v)

const entry = computed(() =>
  props.kind === 'door' ? state.doors[props.index] : state.framedWindows[props.index],
)
const sillEntry = computed(() =>
  props.kind === 'window' ? state.framedWindows[props.index] : null,
)

const areaText = (a: number) =>
  state.units === 'imperial' ? `${(a / 144).toFixed(1)} ft²` : `${(a / 1e6).toFixed(2)} m²`

const placement = ref<DoorPlacementResult | null>(null)

function optimize() {
  placement.value =
    props.kind === 'door'
      ? project.optimizeDoorPosition(props.index)
      : project.optimizeWindowPosition(props.index)
}

function remove() {
  if (props.kind === 'door') project.removeDoor(props.index)
  else project.removeWindow(props.index)
}
</script>

<template>
  <div class="rounded-md border border-border bg-card p-3 flex flex-col gap-2.5">
    <div class="flex items-center gap-2">
      <span
        class="inline-flex size-6 items-center justify-center rounded-sm"
        :style="
          kind === 'door'
            ? 'background: #c9873a33; color: #c9873a'
            : 'background: #8ecbff33; color: #8ecbff'
        "
      >
        <component :is="kind === 'door' ? DoorOpen : AppWindow" class="size-3.5" />
      </span>
      <span class="font-mono font-semibold text-sm">{{ info.id }}</span>
      <span class="text-xs text-muted-foreground">
        {{ formatLength(info.width, state.units) }} × {{ formatLength(info.height, state.units) }}
        <template v-if="kind === 'window'">
          · sill {{ formatLength(info.sillHeight ?? 0, state.units) }}
        </template>
      </span>
      <Button size="icon-sm" variant="ghost" class="ml-auto" title="Remove opening" @click="remove">
        <X />
      </Button>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <Field>
        <FieldLabel class="text-xs">Width ({{ smallUnit }})</FieldLabel>
        <Input
          type="number" min="1" step="1" class="font-mono h-8"
          :model-value="toDisplay(entry.widthMm)"
          @update:model-value="(v) => { const n = Number(v); if (n > 0) entry.widthMm = fromDisplay(n) }"
        />
      </Field>
      <Field>
        <FieldLabel class="text-xs">Height ({{ smallUnit }})</FieldLabel>
        <Input
          type="number" min="1" step="1" class="font-mono h-8"
          :model-value="toDisplay(entry.heightMm)"
          @update:model-value="(v) => { const n = Number(v); if (n > 0) entry.heightMm = fromDisplay(n) }"
        />
      </Field>
      <Field>
        <FieldLabel class="text-xs">Bearing (°)</FieldLabel>
        <Input
          type="number" min="0" max="359" step="1" class="font-mono h-8"
          :model-value="entry.azimuthDeg"
          @update:model-value="(v) => (entry.azimuthDeg = ((Number(v) % 360) + 360) % 360)"
        />
      </Field>
      <Field v-if="sillEntry">
        <FieldLabel class="text-xs">Sill ({{ smallUnit }})</FieldLabel>
        <Input
          type="number" min="1" step="1" class="font-mono h-8"
          title="Height of the opening bottom above the base plane"
          :model-value="toDisplay(sillEntry.sillMm)"
          @update:model-value="(v) => { const n = Number(v); if (n > 0) sillEntry!.sillMm = fromDisplay(n) }"
        />
      </Field>
      <Field>
        <FieldLabel class="text-xs">Depth ({{ smallUnit }})</FieldLabel>
        <Input
          type="number" step="1" class="font-mono h-8"
          title="Recess of the buck plane vs auto fit — negative pushes it toward the shell"
          :model-value="toDisplay(entry.depthMm)"
          @update:model-value="(v) => (entry.depthMm = fromDisplay(Number(v) || 0))"
        />
      </Field>
      <Field>
        <FieldLabel class="text-xs">Margin ({{ smallUnit }})</FieldLabel>
        <Input
          type="number" min="0" step="0.5" class="font-mono h-8"
          title="Clearance band cut beyond the rough opening (trim/shim zone)"
          :model-value="toDisplay(entry.marginMm)"
          @update:model-value="(v) => { const n = Number(v); entry.marginMm = n > 0 ? fromDisplay(n) : 0 }"
        />
      </Field>
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      <dt class="text-muted-foreground">Buck members</dt>
      <dd class="text-right font-mono">
        2× jamb {{ formatLength(info.jambLength, state.units) }} · 1× header
        {{ formatLength(info.headerLength, state.units) }}
        <template v-if="kind === 'window'">
          · 1× sill {{ formatLength(info.headerLength, state.units) }}
        </template>
      </dd>
      <dt class="text-muted-foreground">Struts</dt>
      <dd class="text-right font-mono">
        {{ info.removedStrutCount }} removed · {{ info.trimmedStrutCount }} trimmed to buck
      </dd>
      <dt class="text-muted-foreground">Hubs removed</dt>
      <dd class="text-right font-mono">{{ info.removedHubCount }}</dd>
      <dt class="text-muted-foreground">Buck plane inset</dt>
      <dd class="text-right font-mono">{{ formatLength(info.tunnelDepth, state.units) }}</dd>
      <template v-if="state.closeDoorways && info.fits">
        <dt class="text-muted-foreground">Closure sheathing</dt>
        <dd class="text-right font-mono">
          sides {{ areaText(info.closureSideArea) }} · top {{ areaText(info.closureTopArea)
          }}<template v-if="info.closureBottomArea > 1">
            · sill {{ areaText(info.closureBottomArea) }}</template
          ><template v-if="info.closureFaceArea > 1">
            · face {{ areaText(info.closureFaceArea) }}</template
          >
        </dd>
        <dt class="text-muted-foreground">Closure framing</dt>
        <dd class="text-right font-mono">
          {{ info.closureFraming.reduce((n, m) => n + m.quantity, 0) }} pcs ·
          {{ info.closureJointCount }} joints — in cut list
        </dd>
      </template>
    </dl>

    <Button size="sm" variant="outline" class="w-full" @click="optimize">
      <Sparkles data-icon="inline-start" />
      Optimize placement
    </Button>
    <p
      v-if="placement"
      class="text-xs leading-relaxed"
      :class="placement.improved ? 'text-primary' : 'text-muted-foreground'"
    >
      <template v-if="placement.improved">
        Moved {{ placement.fromAzimuthDeg.toFixed(0) }}° → {{ placement.azimuthDeg.toFixed(2) }}° ·
        trims {{ placement.before.trimmed }} → {{ placement.after.trimmed }} · hubs out
        {{ placement.before.hubsRemoved }} → {{ placement.after.hubsRemoved }} · centered
        {{ formatLength(placement.after.centerOffset, state.units) }} off the pattern
      </template>
      <template v-else>
        Already at the cleanest bearing within ±36° ({{ placement.evaluated }} positions checked).
      </template>
    </p>

    <p v-if="!info.fits" class="flex items-center gap-1.5 text-xs text-destructive">
      <TriangleAlert class="size-3.5 shrink-0" />
      Opening doesn't fit inside the shell — reduce width, height{{
        kind === 'window' ? ', or sill height' : ''
      }}.
    </p>
  </div>
</template>
