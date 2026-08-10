<script setup lang="ts">
import { computed, ref } from 'vue'
import { RotateCcw, Share2, Check, Copy } from '@lucide/vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import DomeViewer from '@/components/DomeViewer.vue'
import ViewModeBar from '@/components/ViewModeBar.vue'
import StrutLegend from '@/components/StrutLegend.vue'
import InspectorCard from '@/components/InspectorCard.vue'
import ParametersPanel from '@/components/panels/ParametersPanel.vue'
import PartsTab from '@/components/panels/PartsTab.vue'
import MaterialsTab from '@/components/panels/MaterialsTab.vue'
import BuildTab from '@/components/panels/BuildTab.vue'
import OpeningsPanel from '@/components/panels/OpeningsPanel.vue'
import LoadsTab from '@/components/panels/LoadsTab.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'

const project = useDomeProject()
const { state, summary, cutList, diameter, loadsResult, pendingShare, shareFallbackUrl } = project

function onReset() {
  if (
    window.confirm('Reset everything to defaults? Doors, openings, and settings will be cleared.')
  ) {
    project.resetProject()
  }
}

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function onShare() {
  if (await project.copyShareLink()) {
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1500)
  }
}

// Fallback-dialog copy: runs in a fresh user gesture with no await before
// the write, so it succeeds where the original gesture was lost.
const fallbackCopied = ref(false)
function onFallbackCopy() {
  const url = shareFallbackUrl.value
  if (!url) return
  navigator.clipboard.writeText(url).then(
    () => {
      fallbackCopied.value = true
      setTimeout(() => {
        fallbackCopied.value = false
        shareFallbackUrl.value = null
      }, 900)
    },
    () => {
      // Clipboard fully unavailable — leave the selected text for ⌘C.
    },
  )
}
function selectAll(ev: FocusEvent) {
  ;(ev.target as HTMLInputElement).select()
}

const chips = computed(() => [
  {
    label: 'height',
    value: formatLength(summary.value.height, state.units, { long: true }),
  },
  {
    label: 'floor',
    value:
      state.units === 'imperial'
        ? `${(summary.value.floorArea / 144).toFixed(0)} ft²`
        : `${(summary.value.floorArea / 1e6).toFixed(1)} m²`,
  },
  { label: 'struts', value: String(summary.value.struts) },
  { label: 'hubs', value: String(summary.value.hubs) },
  { label: 'panels', value: String(summary.value.panels) },
  {
    label: 'max err',
    value:
      cutList.value.maxRoundingError < 1e-9
        ? '0'
        : formatLength(cutList.value.maxRoundingError, state.units),
  },
])
</script>

<template>
  <div class="flex h-screen flex-col bg-background text-foreground overflow-hidden">
    <!-- Header -->
    <header class="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
      <div class="flex items-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          class="size-6 text-primary"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
        >
          <path d="M3 18 A 9 9 0 0 1 21 18 Z" />
          <path
            d="M3 18 L 8 10 L 12 18 M8 10 L 12 4.5 L 16 10 M 12 18 L 16 10 L 21 18 M 12 4.5 L 8 10 M12 4.5 L 16 10"
          />
        </svg>
        <h1 class="font-display text-lg font-bold tracking-[0.22em] text-foreground">DOMEZ</h1>
        <span
          class="hidden md:inline text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5"
        >
          geodesic dome cad
        </span>
      </div>
      <div class="ml-auto flex items-center gap-1.5 overflow-hidden">
        <span
          class="rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary whitespace-nowrap"
        >
          {{
            state.mode === 'zome'
              ? `Z${state.zomeSides} · ${state.zomePitchDeg}°`
              : `${state.mode === 'goldberg' ? '⬡' : ''}${state.frequency}V · ${state.fraction}`
          }}
          · ⌀ {{ diameter }} {{ state.units === 'imperial' ? 'ft' : 'm' }}
        </span>
        <span
          v-for="chip in chips"
          :key="chip.label"
          class="hidden lg:inline-flex items-baseline gap-1.5 rounded-md border border-border px-2.5 py-1 whitespace-nowrap"
        >
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">{{
            chip.label
          }}</span>
          <span class="font-mono text-xs">{{ chip.value }}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          title="Copy share link — the URL encodes the whole project"
          @click="onShare"
        >
          <Check v-if="copied" class="text-emerald-500" />
          <Share2 v-else />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          title="Reset to defaults — clears doors, openings, and settings"
          @click="onReset"
        >
          <RotateCcw />
        </Button>
        <Button
          as="a"
          href="https://github.com/f0ursqu4r3/domez"
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          title="View source on GitHub"
        >
          <!-- lucide dropped brand icons — the official GitHub mark, inlined. -->
          <svg viewBox="0 0 16 16" class="size-4" fill="currentColor" aria-hidden="true">
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </Button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- Parameters -->
      <aside class="w-75 shrink-0 border-r border-border">
        <ScrollArea class="h-full">
          <ParametersPanel />
        </ScrollArea>
      </aside>

      <!-- Viewport -->
      <main class="relative min-w-0 flex-1 bg-[#0a0e15]">
        <DomeViewer class="absolute inset-0" />
        <div class="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
          <div class="flex flex-col items-center gap-2">
            <ViewModeBar />
            <span
              v-if="state.openingTool !== 'off' && state.viewMode !== 'frame'"
              class="rounded-md border border-primary/50 bg-primary/15 px-2.5 py-1 text-xs text-primary backdrop-blur-sm"
            >
              {{
                state.openingTool === 'erase'
                  ? 'Erasing openings — click panels'
                  : state.openingTool === 'door'
                    ? 'Placing doorway — click the dome where it goes'
                    : state.openingTool === 'window'
                      ? 'Placing framed window — click the dome where it goes'
                      : `Placing ${state.openingTool}s — click panels`
              }}
            </span>
            <span
              v-else-if="state.viewMode === 'loads' && !loadsResult.ok"
              class="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-500 backdrop-blur-sm"
            >
              {{
                loadsResult.reason === 'unsupported-family'
                  ? 'Pin-frame is a mechanism — panels carry the shape. No frame-only numbers.'
                  : 'This frame is not self-supporting as a pin-jointed truss.'
              }}
            </span>
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
      <aside class="flex w-107.5 shrink-0 flex-col border-l border-border">
        <Tabs default-value="parts" class="flex h-full min-h-0 flex-col gap-0">
          <TabsList
            class="w-full justify-start rounded-none border-b border-border bg-transparent px-2 pt-1.5"
          >
            <TabsTrigger value="parts" class="text-xs">Parts</TabsTrigger>
            <TabsTrigger value="openings" class="text-xs">Openings</TabsTrigger>
            <TabsTrigger value="loads" class="text-xs">Loads</TabsTrigger>
            <TabsTrigger value="materials" class="text-xs">Materials</TabsTrigger>
            <TabsTrigger value="build" class="text-xs">Build</TabsTrigger>
          </TabsList>
          <TabsContent value="parts" class="min-h-0 flex-1"
            ><ScrollArea class="h-full"><PartsTab /></ScrollArea
          ></TabsContent>
          <TabsContent value="openings" class="min-h-0 flex-1"
            ><ScrollArea class="h-full"><OpeningsPanel /></ScrollArea
          ></TabsContent>
          <TabsContent value="loads" class="min-h-0 flex-1"
            ><ScrollArea class="h-full"><LoadsTab /></ScrollArea
          ></TabsContent>
          <TabsContent value="materials" class="min-h-0 flex-1"
            ><ScrollArea class="h-full"><MaterialsTab /></ScrollArea
          ></TabsContent>
          <TabsContent value="build" class="min-h-0 flex-1"
            ><ScrollArea class="h-full"><BuildTab /></ScrollArea
          ></TabsContent>
        </Tabs>
      </aside>
    </div>

    <Dialog
      :open="!!pendingShare"
      @update:open="(v: boolean) => !v && project.applyPendingShare(false)"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load shared project?</DialogTitle>
          <DialogDescription>
            Someone shared a dome project with you. Loading it will replace your current project —
            export yours first if you want to keep it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="project.applyPendingShare(false)"
            >Keep my project</Button
          >
          <Button @click="project.applyPendingShare(true)">Load shared project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="!!shareFallbackUrl"
      @update:open="(v: boolean) => !v && (shareFallbackUrl = null)"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share link</DialogTitle>
          <DialogDescription>
            The URL encodes the whole project — copy it and send it to anyone.
          </DialogDescription>
        </DialogHeader>
        <Input
          class="font-mono text-xs"
          readonly
          :model-value="shareFallbackUrl ?? ''"
          @focus="selectAll"
        />
        <DialogFooter>
          <Button variant="outline" @click="shareFallbackUrl = null">Done</Button>
          <Button @click="onFallbackCopy">
            <Check v-if="fallbackCopied" data-icon="inline-start" class="text-emerald-500" />
            <Copy v-else data-icon="inline-start" />
            {{ fallbackCopied ? 'Copied' : 'Copy' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
