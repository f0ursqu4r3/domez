<script setup lang="ts">
import { useDomeProject } from '@/composables/useDomeProject'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const { state, model } = useDomeProject()

function selectHub(hubTypeId: number) {
  const first = model.value.hubTypes[hubTypeId]?.vertexIds[0]
  if (first !== undefined) state.selection = { kind: 'hub', vertexId: first }
}
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <div class="flex items-baseline justify-between">
      <h3 class="section-title mb-0">Hub schedule</h3>
      <span class="text-xs text-muted-foreground font-mono">{{ model.vertices.length }} hubs</span>
    </div>
    <div class="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hub</TableHead>
            <TableHead class="text-right">Count</TableHead>
            <TableHead class="text-right">Ways</TableHead>
            <TableHead>Strut pattern</TableHead>
            <TableHead>Where</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="h in model.hubTypes" :key="h.id" class="cursor-pointer" @click="selectHub(h.id)">
            <TableCell class="font-mono font-semibold">{{ h.label }}</TableCell>
            <TableCell class="text-right font-mono">{{ h.count }}</TableCell>
            <TableCell class="text-right font-mono">{{ h.valence }}</TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground">{{ h.pattern }}</TableCell>
            <TableCell>
              <Badge :variant="h.isBase ? 'default' : 'secondary'">{{ h.isBase ? 'base' : 'dome' }}</Badge>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <p class="text-xs text-muted-foreground leading-relaxed">
      A hub's struts arrive at the axial angle listed per strut type — order hubs (or bend plates)
      per pattern above. Base hubs also anchor to the foundation.
    </p>
  </div>
</template>
