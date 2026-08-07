<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject, type ViewMode } from '@/composables/useDomeProject'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Toggle } from '@/components/ui/toggle'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'

const { state, material } = useDomeProject()

const modes: { value: ViewMode; label: string }[] = [
  { value: 'assembly', label: 'Assembly' },
  { value: 'frame', label: 'Frame' },
  { value: 'surface', label: 'Surface' },
  { value: 'exploded', label: 'Exploded' },
]

const trueSizeTitle = computed(() => `Dimensionally accurate struts — ${material.value.profile}`)
</script>

<template>
  <div
    class="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-card/90 px-2 py-1.5 backdrop-blur-sm shadow-lg"
  >
    <ToggleGroup
      :model-value="state.viewMode"
      type="single"
      size="sm"
      @update:model-value="(v: any) => v && (state.viewMode = v)"
    >
      <ToggleGroupItem v-for="m in modes" :key="m.value" :value="m.value" class="px-3 text-xs">
        {{ m.label }}
      </ToggleGroupItem>
    </ToggleGroup>
    <div v-if="state.viewMode === 'exploded'" class="flex items-center gap-2 pr-2">
      <span class="text-[10px] uppercase tracking-widest text-muted-foreground">Spread</span>
      <Slider
        :model-value="[state.explode]"
        :min="0.05"
        :max="1"
        :step="0.01"
        class="w-28"
        @update:model-value="(v: number[] | undefined) => v && (state.explode = v[0])"
      />
    </div>
    <template v-if="state.viewMode !== 'surface'">
      <Separator orientation="vertical" class="h-5" />
      <Toggle
        :model-value="state.trueSize"
        size="sm"
        class="px-3 text-xs"
        :title="trueSizeTitle"
        @update:model-value="(v: boolean) => (state.trueSize = v)"
      >
        True size
      </Toggle>
    </template>
  </div>
</template>
