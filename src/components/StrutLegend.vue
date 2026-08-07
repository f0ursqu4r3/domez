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
  <div class="pointer-events-auto flex flex-col gap-1 rounded-lg border border-border bg-card/90 p-2 backdrop-blur-sm shadow-lg">
    <button
      v-for="r in cutList.rows"
      :key="r.typeId"
      class="flex items-center gap-2 rounded-sm px-1.5 py-0.5 text-left hover:bg-muted/60 transition-colors"
      @click="select(r.typeId)"
    >
      <span class="size-2.5 rounded-[2px]" :style="{ background: strutColor(r.typeId) }" />
      <span class="font-mono text-[11px] font-semibold w-5">{{ r.label }}</span>
      <span class="font-mono text-[11px] text-muted-foreground">{{ formatLength(r.roundedCutLength, state.units) }}</span>
      <span class="font-mono text-[10px] text-muted-foreground/70 ml-auto">×{{ r.quantity }}</span>
    </button>
  </div>
</template>
