<script setup lang="ts">
import { ref } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  FileSpreadsheet, FileJson, FileBox, PencilRuler, FileCode, Upload, Boxes, Tag, ClipboardList,
} from '@lucide/vue'

const project = useDomeProject()
const { exporters } = project
const fileInput = ref<HTMLInputElement | null>(null)
const loadError = ref(false)

async function onFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  loadError.value = !project.loadProjectFile(await file.text())
  ;(ev.target as HTMLInputElement).value = ''
}

const groups = [
  {
    title: 'Fabrication',
    items: [
      { label: 'Cut list CSV', desc: 'lengths, angles, quantities', icon: FileSpreadsheet, run: exporters.csv },
      { label: 'Boards CSV', desc: 'per-board cutting plan', icon: ClipboardList, run: exporters.boardsCsv },
      { label: 'Hubs CSV', desc: 'hub schedule', icon: FileSpreadsheet, run: exporters.hubsCsv },
      { label: 'Fabrication SVG', desc: 'printable strut drawings', icon: PencilRuler, run: exporters.svg },
      { label: 'Hub labels SVG', desc: 'printable hub stickers', icon: Tag, run: exporters.labelsSvg },
      { label: 'DXF', desc: 'strut templates + top plan', icon: FileCode, run: exporters.dxf },
    ],
  },
  {
    title: '3D model',
    items: [
      { label: 'OBJ', desc: 'panels + strut lines', icon: FileBox, run: exporters.obj },
      { label: 'GLB', desc: 'full colored model', icon: Boxes, run: exporters.gltf },
    ],
  },
  {
    title: 'Project',
    items: [{ label: 'Project JSON', desc: 'settings + derived data', icon: FileJson, run: exporters.json }],
  },
]
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <template v-for="(group, gi) in groups" :key="group.title">
      <Separator v-if="gi > 0" />
      <section>
        <h3 class="section-title">{{ group.title }}</h3>
        <div class="grid grid-cols-2 gap-2">
          <Button
            v-for="item in group.items" :key="item.label"
            variant="outline"
            class="h-auto justify-start px-3 py-2.5"
            @click="item.run()"
          >
            <component :is="item.icon" data-icon="inline-start" />
            <span class="flex flex-col items-start gap-0.5 min-w-0">
              <span class="text-sm leading-none">{{ item.label }}</span>
              <span class="text-[11px] leading-tight text-muted-foreground font-normal truncate w-full text-left">{{ item.desc }}</span>
            </span>
          </Button>
        </div>
      </section>
    </template>

    <Separator />

    <section>
      <h3 class="section-title">Load project</h3>
      <input ref="fileInput" type="file" accept=".json,application/json" class="hidden" @change="onFile" />
      <Button variant="secondary" class="w-full" @click="fileInput?.click()">
        <Upload data-icon="inline-start" />
        Open project JSON…
      </Button>
      <p v-if="loadError" class="mt-2 text-xs text-destructive">Not a domez project file.</p>
    </section>
  </div>
</template>
