<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import DomeViewer from '@/components/DomeViewer.vue'
import ViewModeBar from '@/components/ViewModeBar.vue'
import StrutLegend from '@/components/StrutLegend.vue'
import InspectorCard from '@/components/InspectorCard.vue'
import ParametersPanel from '@/components/panels/ParametersPanel.vue'
import StrutsPanel from '@/components/panels/StrutsPanel.vue'
import HubsPanel from '@/components/panels/HubsPanel.vue'
import MaterialsPanel from '@/components/panels/MaterialsPanel.vue'
import AssemblyPanel from '@/components/panels/AssemblyPanel.vue'
import ExportPanel from '@/components/panels/ExportPanel.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'

const { state, summary, cutList, diameter } = useDomeProject()

const chips = computed(() => [
  { label: 'height', value: formatLength(summary.value.height, state.units, { long: true }) },
  { label: 'floor', value: state.units === 'imperial'
      ? `${(summary.value.floorArea / 144).toFixed(0)} ft²`
      : `${(summary.value.floorArea / 1e6).toFixed(1)} m²` },
  { label: 'struts', value: String(summary.value.struts) },
  { label: 'hubs', value: String(summary.value.hubs) },
  { label: 'panels', value: String(summary.value.panels) },
  { label: 'max err', value: cutList.value.maxRoundingError < 1e-9 ? '0' : formatLength(cutList.value.maxRoundingError, state.units) },
])
</script>

<template>
  <div class="flex h-screen flex-col bg-background text-foreground overflow-hidden">
    <!-- Header -->
    <header class="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
      <div class="flex items-center gap-2.5">
        <svg viewBox="0 0 24 24" class="size-6 text-primary" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M3 18 A 9 9 0 0 1 21 18 Z" />
          <path d="M3 18 L 8 10 L 12 18 M8 10 L 12 4.5 L 16 10 M 12 18 L 16 10 L 21 18 M 12 4.5 L 8 10 M12 4.5 L 16 10" />
        </svg>
        <h1 class="font-display text-lg font-bold tracking-[0.22em] text-foreground">DOMEZ</h1>
        <span class="hidden md:inline text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
          geodesic dome cad
        </span>
      </div>
      <div class="ml-auto flex items-center gap-1.5 overflow-x-auto">
        <span class="rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary whitespace-nowrap">
          {{ state.frequency }}V · {{ state.fraction }} · ⌀ {{ diameter }} {{ state.units === 'imperial' ? 'ft' : 'm' }}
        </span>
        <span
          v-for="chip in chips" :key="chip.label"
          class="hidden lg:inline-flex items-baseline gap-1.5 rounded-md border border-border px-2.5 py-1 whitespace-nowrap"
        >
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">{{ chip.label }}</span>
          <span class="font-mono text-xs">{{ chip.value }}</span>
        </span>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- Parameters -->
      <aside class="w-[300px] shrink-0 border-r border-border">
        <ScrollArea class="h-full">
          <ParametersPanel />
        </ScrollArea>
      </aside>

      <!-- Viewport -->
      <main class="relative min-w-0 flex-1 bg-[#0a0e15]">
        <DomeViewer class="absolute inset-0" />
        <div class="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
          <div class="flex justify-center">
            <ViewModeBar />
          </div>
          <div class="flex items-end justify-between gap-3">
            <InspectorCard />
            <div class="ml-auto">
              <StrutLegend v-if="state.viewMode !== 'surface'" />
            </div>
          </div>
        </div>
      </main>

      <!-- Data panels -->
      <aside class="flex w-[430px] shrink-0 flex-col border-l border-border">
        <Tabs default-value="struts" class="flex h-full min-h-0 flex-col gap-0">
          <TabsList class="w-full justify-start rounded-none border-b border-border bg-transparent px-2 pt-1.5">
            <TabsTrigger value="struts" class="text-xs">Struts</TabsTrigger>
            <TabsTrigger value="hubs" class="text-xs">Hubs</TabsTrigger>
            <TabsTrigger value="materials" class="text-xs">Materials</TabsTrigger>
            <TabsTrigger value="assembly" class="text-xs">Assembly</TabsTrigger>
            <TabsTrigger value="export" class="text-xs">Export</TabsTrigger>
          </TabsList>
          <TabsContent value="struts" class="min-h-0 flex-1"><ScrollArea class="h-full"><StrutsPanel /></ScrollArea></TabsContent>
          <TabsContent value="hubs" class="min-h-0 flex-1"><ScrollArea class="h-full"><HubsPanel /></ScrollArea></TabsContent>
          <TabsContent value="materials" class="min-h-0 flex-1"><MaterialsPanel class="h-full" /></TabsContent>
          <TabsContent value="assembly" class="min-h-0 flex-1"><ScrollArea class="h-full"><AssemblyPanel /></ScrollArea></TabsContent>
          <TabsContent value="export" class="min-h-0 flex-1"><ScrollArea class="h-full"><ExportPanel /></ScrollArea></TabsContent>
        </Tabs>
      </aside>
    </div>
  </div>
</template>
