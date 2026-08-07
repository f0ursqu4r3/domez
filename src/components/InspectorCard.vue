<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import { strutColor } from '@/engine/exports/svg'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from '@lucide/vue'

const { state, model, cutList, material } = useDomeProject()

const strut = computed(() => {
  if (state.selection?.kind !== 'strut') return null
  const edge = model.value.edges[state.selection.edgeId]
  if (!edge) return null
  const type = model.value.strutTypes[edge.typeId]
  const row = cutList.value.rows[edge.typeId]
  return { edge, type, row }
})

const hub = computed(() => {
  if (state.selection?.kind !== 'hub') return null
  const vertex = model.value.vertices[state.selection.vertexId]
  if (!vertex) return null
  const hubType = model.value.hubTypes[vertex.hubTypeId]
  const struts = vertex.edgeIds.map((eid) => {
    const e = model.value.edges[eid]
    const t = model.value.strutTypes[e.typeId]
    return { label: t.label, typeId: t.id, axial: t.axialAngleDeg }
  })
  return { vertex, hubType, struts }
})
</script>

<template>
  <div
    v-if="strut || hub"
    class="pointer-events-auto w-72 rounded-lg border border-border bg-card/95 backdrop-blur-sm shadow-xl"
  >
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <div class="flex items-center gap-2">
        <span
          v-if="strut"
          class="size-3.5 rounded-sm"
          :style="{ background: strutColor(strut.type.id) }"
        />
        <span class="font-display text-sm font-semibold tracking-wide">
          {{ strut ? `STRUT ${strut.type.label}` : `HUB V${hub!.vertex.id}` }}
        </span>
        <Badge v-if="hub" variant="secondary" class="font-mono">{{ hub.hubType.label }}</Badge>
        <Badge v-if="hub?.vertex.isBase" class="font-mono">base</Badge>
      </div>
      <Button variant="ghost" size="icon-sm" @click="state.selection = null"><X /></Button>
    </div>

    <dl v-if="strut" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-3 text-xs">
      <dt class="text-muted-foreground">Cut length</dt>
      <dd class="text-right font-mono font-semibold text-sm">{{ formatLength(strut.row.roundedCutLength, state.units) }}</dd>
      <dt class="text-muted-foreground">Chord (hub-to-hub)</dt>
      <dd class="text-right font-mono">{{ formatLength(strut.row.chordLength, state.units) }}</dd>
      <dt class="text-muted-foreground">Rounding error</dt>
      <dd class="text-right font-mono">{{ strut.row.roundingError < 1e-9 ? '0' : formatLength(strut.row.roundingError, state.units) }}</dd>
      <dt class="text-muted-foreground">Axial angle</dt>
      <dd class="text-right font-mono">{{ strut.type.axialAngleDeg.toFixed(2) }}°</dd>
      <dt class="text-muted-foreground">Panel dihedral</dt>
      <dd class="text-right font-mono">
        {{ Number.isNaN(strut.type.dihedralMinDeg) ? '—' : `${strut.type.dihedralMinDeg.toFixed(1)}–${strut.type.dihedralMaxDeg.toFixed(1)}°` }}
      </dd>
      <dt class="text-muted-foreground">Quantity</dt>
      <dd class="text-right font-mono">{{ strut.type.count }}× in dome</dd>
      <dt class="text-muted-foreground">Material</dt>
      <dd class="text-right">{{ material.label }}</dd>
    </dl>

    <div v-else-if="hub" class="px-3 py-3 flex flex-col gap-2 text-xs">
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt class="text-muted-foreground">Struts meeting</dt>
        <dd class="text-right font-mono font-semibold text-sm">{{ hub.hubType.valence }}-way</dd>
        <dt class="text-muted-foreground">Like this hub</dt>
        <dd class="text-right font-mono">{{ hub.hubType.count }}×</dd>
      </dl>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="(s, i) in hub.struts" :key="i"
          class="inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 font-mono"
        >
          <span class="size-2 rounded-[2px]" :style="{ background: strutColor(s.typeId) }" />
          {{ s.label }} · {{ s.axial.toFixed(1) }}°
        </span>
      </div>
      <p class="text-muted-foreground leading-relaxed">
        Each strut approaches at its axial angle off the hub's radial axis
        {{ hub.vertex.isBase ? '· anchors to foundation' : '' }}
      </p>
    </div>
  </div>
</template>
