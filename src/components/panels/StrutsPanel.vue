<script setup lang="ts">
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import { strutColor } from '@/engine/exports/svg'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const { state, cutList, model } = useDomeProject()

function selectType(typeId: number) {
  const first = model.value.strutTypes[typeId]?.edgeIds[0]
  if (first !== undefined) state.selection = { kind: 'strut', edgeId: first }
}
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <div class="flex items-baseline justify-between">
      <h3 class="section-title mb-0">Cut list</h3>
      <span class="text-xs text-muted-foreground font-mono">
        {{ cutList.totalStruts }} struts · max err
        {{ cutList.maxRoundingError < 1e-9 ? '0' : formatLength(cutList.maxRoundingError, state.units) }}
      </span>
    </div>
    <div class="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Strut</TableHead>
            <TableHead class="text-right">Qty</TableHead>
            <TableHead class="text-right">Cut length</TableHead>
            <TableHead class="text-right">Axial</TableHead>
            <TableHead class="text-right">Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="r in cutList.rows"
            :key="r.typeId"
            class="cursor-pointer"
            @click="selectType(r.typeId)"
          >
            <TableCell>
              <span class="inline-flex items-center gap-2">
                <span class="size-3 rounded-sm" :style="{ background: strutColor(r.typeId) }" />
                <span class="font-mono font-semibold">{{ r.label }}</span>
              </span>
            </TableCell>
            <TableCell class="text-right font-mono">{{ r.quantity }}</TableCell>
            <TableCell class="text-right font-mono">{{ formatLength(r.roundedCutLength, state.units) }}</TableCell>
            <TableCell class="text-right font-mono text-muted-foreground">{{ r.axialAngleDeg.toFixed(2) }}°</TableCell>
            <TableCell class="text-right font-mono text-muted-foreground">
              {{ r.roundingError < 1e-9 ? '—' : formatLength(r.roundingError, state.units) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <p class="text-xs text-muted-foreground leading-relaxed">
      Cut lengths include the joint end offset
      (<span class="font-mono">{{ formatLength(state.endOffset, state.units) }}</span> per end).
      Hole-to-hole / geometric chord lengths are in the CSV export.
      <Badge v-if="state.baseMode === 'leveled'" variant="secondary" class="ml-1">leveled base adds types</Badge>
    </p>
  </div>
</template>
