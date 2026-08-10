<script setup lang="ts">
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import { strutColor } from '@/engine/exports/svg'

const { state, cutList, model } = useDomeProject()

function select(typeId: number) {
  const first = model.value.strutTypes[typeId]?.edgeIds[0]
  if (first !== undefined) state.selection = { kind: 'strut', edgeId: first }
}
</script>

<template>
  <div
    class="pointer-events-auto flex flex-col gap-1 rounded-lg border border-border bg-card/90 p-2 backdrop-blur-sm shadow-lg"
  >
    <div v-if="state.viewMode === 'loads'" class="flex flex-col gap-1.5 text-[10px]">
      <div class="uppercase tracking-widest text-muted-foreground">Utilization</div>
      <div class="flex items-center gap-1.5">
        <div
          class="h-2 w-20 rounded-sm"
          style="background: linear-gradient(to right, #6b7280, #3b82f6)"
        ></div>
        <span>tension 0→100%</span>
      </div>
      <div class="flex items-center gap-1.5">
        <div
          class="h-2 w-20 rounded-sm"
          style="background: linear-gradient(to right, #6b7280, #ef4444)"
        ></div>
        <span>compression 0→100%</span>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="size-2 rounded-sm" style="background: #d946ef"></div>
        <span>over capacity</span>
      </div>
    </div>
    <template v-else>
      <button
        v-for="r in cutList.rows.filter((row) => row.kind === 'strut' && row.quantity > 0)"
        :key="r.typeId"
        class="flex items-center gap-2 rounded-sm px-1.5 py-0.5 text-left hover:bg-muted/60 transition-colors"
        @click="select(r.typeId)"
      >
        <span class="size-2.5 rounded-[2px]" :style="{ background: strutColor(r.typeId) }" />
        <span class="font-mono text-[11px] font-semibold w-5">{{ r.label }}</span>
        <span class="font-mono text-[11px] text-muted-foreground">{{
          formatLength(r.roundedCutLength, state.units)
        }}</span>
        <span class="font-mono text-[10px] text-muted-foreground/70 ml-auto">×{{ r.quantity }}</span>
      </button>
    </template>
  </div>
</template>
