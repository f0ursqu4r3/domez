<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import { strutColor } from '@/engine/exports/svg'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TriangleAlert } from '@lucide/vue'

const { state, packing, material, cutList, panelPlan } = useDomeProject()

const panelAreaText = (a: number) =>
  state.units === 'imperial' ? `${(a / 144).toFixed(1)} ft²` : `${(a / 1e6).toFixed(2)} m²`

const stats = computed(() => [
  { label: 'Boards', value: String(packing.value.boards.length) },
  { label: 'Waste', value: `${(packing.value.wasteFraction * 100).toFixed(1)}%` },
  {
    label: 'Total stock',
    value: formatLength(packing.value.totalStock, state.units, { long: true }),
  },
  {
    label: 'Net used',
    value: formatLength(cutList.value.totalLength, state.units, { long: true }),
  },
])
</script>

<template>
  <div class="flex flex-col gap-4 p-4 min-h-0">
    <div>
      <h3 class="section-title">Material takeoff — {{ material.label }}</h3>
      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="s in stats"
          :key="s.label"
          class="rounded-md border border-border bg-card px-3 py-2"
        >
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground">
            {{ s.label }}
          </div>
          <div class="font-mono text-lg text-foreground">{{ s.value }}</div>
        </div>
      </div>
    </div>

    <Alert v-if="packing.unplaceable.length > 0" variant="destructive">
      <TriangleAlert />
      <AlertTitle>{{ packing.unplaceable.length }} struts exceed your longest stock</AlertTitle>
      <AlertDescription>
        Enable a longer stock length or reduce the diameter — e.g. strut
        {{ packing.unplaceable[0].label }} needs
        {{ formatLength(packing.unplaceable[0].length, state.units) }}.
      </AlertDescription>
    </Alert>

    <div class="flex flex-col gap-1 min-h-0">
      <div class="flex items-baseline justify-between">
        <h4 class="text-xs uppercase tracking-widest text-muted-foreground">Shopping list</h4>
      </div>
      <div class="flex gap-2 flex-wrap">
        <div
          v-for="b in packing.boardCounts"
          :key="b.stockLabel"
          class="rounded-md border border-border px-3 py-1.5 font-mono text-sm"
        >
          <span class="text-primary font-semibold">{{ b.count }}×</span> {{ b.stockLabel }}
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-1 flex-1 min-h-0">
      <div class="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3">
        <div class="flex items-baseline justify-between">
          <h4 class="text-xs uppercase tracking-widest text-muted-foreground">
            Skin panels — {{ panelPlan.sheetLabel }}s
          </h4>
          <span class="font-mono text-xs">
            <span class="text-primary font-semibold">{{ panelPlan.totalSheets }}×</span> sheets ·
            {{ (panelPlan.wasteFraction * 100).toFixed(0) }}% waste
            <span v-if="panelPlan.skinFactor === 2" class="text-muted-foreground">· 2 skins</span>
          </span>
        </div>
        <div
          v-for="t in panelPlan.types"
          :key="t.label"
          class="flex items-baseline gap-2 font-mono text-[11px]"
        >
          <span class="font-semibold w-7">{{ t.label }}</span>
          <span>×{{ t.count }}</span>
          <span class="text-muted-foreground truncate">
            {{ t.edges.map((e) => e.toFixed(1)).join(' / ') }} · {{ panelAreaText(t.area) }}
          </span>
          <span class="ml-auto whitespace-nowrap">
            {{ t.seamed ? `seamed · ${t.sheets} sh` : `${t.perSheet}/sh · ${t.sheets} sh` }}
          </span>
        </div>
        <div
          v-for="t in panelPlan.rects"
          :key="t.label"
          class="flex items-baseline gap-2 font-mono text-[11px]"
        >
          <span class="font-semibold w-7">{{ t.label }}</span>
          <span>×{{ t.count }}</span>
          <span class="text-muted-foreground truncate">
            riser {{ t.w.toFixed(1) }} × {{ t.h.toFixed(1) }} · {{ panelAreaText(t.area) }}
          </span>
          <span class="ml-auto whitespace-nowrap">
            {{ t.seamed ? `seamed · ${t.sheets} sh` : `${t.perSheet}/sh · ${t.sheets} sh` }}
          </span>
        </div>
        <div
          v-for="t in panelPlan.rhombs"
          :key="t.label"
          class="flex items-baseline gap-2 font-mono text-[11px]"
        >
          <span class="font-semibold w-7">{{ t.label }}</span>
          <span>×{{ t.count }}</span>
          <span class="text-muted-foreground truncate">
            rhombus {{ t.d1.toFixed(1) }} × {{ t.d2.toFixed(1) }} · {{ panelAreaText(t.area) }}
          </span>
          <span class="ml-auto whitespace-nowrap">
            {{ t.seamed ? `seamed · ${t.sheets} sh` : `${t.perSheet}/sh · ${t.sheets} sh` }}
          </span>
        </div>
      </div>

      <h4 class="text-xs uppercase tracking-widest text-muted-foreground">Cutting diagrams</h4>
      <ScrollArea class="flex-1 min-h-0 pr-3">
        <div class="flex flex-col gap-1.5">
          <div v-for="(b, i) in packing.boards" :key="i" class="flex items-center gap-2">
            <span
              class="w-16 shrink-0 whitespace-nowrap text-right font-mono text-[11px] text-muted-foreground"
            >
              #{{ i + 1 }} · {{ b.stockLabel }}
            </span>
            <div
              class="relative h-6 flex-1 overflow-hidden rounded-sm border border-border bg-muted/40 flex"
            >
              <div
                v-for="(c, j) in b.cuts"
                :key="j"
                class="h-full border-r border-background/70 flex items-center justify-center overflow-hidden"
                :style="{
                  width: `${(c.length / b.stockLength) * 100}%`,
                  background: strutColor(c.typeId) + '55',
                }"
                :title="`${c.label} — ${formatLength(c.length, state.units)}`"
              >
                <span class="text-[10px] font-mono text-foreground/90">{{ c.label }}</span>
              </div>
            </div>
            <span class="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
              {{ formatLength(b.waste, state.units) }}
            </span>
          </div>
        </div>
      </ScrollArea>
    </div>
  </div>
</template>
