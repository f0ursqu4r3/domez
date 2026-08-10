<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  FileSpreadsheet,
  FileJson,
  FileBox,
  PencilRuler,
  FileCode,
  Upload,
  Boxes,
  Tag,
  ClipboardList,
  Share2,
} from '@lucide/vue'

const project = useDomeProject()
const { state, exporters, loadsResult } = project
const fileInput = ref<HTMLInputElement | null>(null)
const loadError = ref(false)

async function onFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  loadError.value = !project.loadProjectFile(await file.text())
  ;(ev.target as HTMLInputElement).value = ''
}

const groups = computed(() => [
  {
    title: 'Fabrication',
    items: [
      {
        label: 'Cut list CSV',
        desc: 'lengths, angles, quantities',
        icon: FileSpreadsheet,
        run: exporters.csv,
      },
      {
        label: 'Boards CSV',
        desc: 'per-board cutting plan',
        icon: ClipboardList,
        run: exporters.boardsCsv,
      },
      ...(state.jointId === 'framed-panel'
        ? []
        : [
            {
              label: 'Cut templates SVG',
              desc: '1:1 tape-on end templates',
              icon: PencilRuler,
              run: exporters.cutTemplates,
            },
          ]),
      {
        label: 'Board diagrams SVG',
        desc: 'visual cutting plan',
        icon: ClipboardList,
        run: exporters.boardDiagrams,
      },
      {
        label: 'Assembly guide SVG',
        desc: 'course-by-course build book',
        icon: ClipboardList,
        run: exporters.assemblyGuide,
      },
      {
        label: 'Panel patterns SVG',
        desc: 'dimensioned panel drawings',
        icon: PencilRuler,
        run: exporters.panelPatterns,
      },
      ...(state.jointId === 'framed-panel'
        ? []
        : [
            {
              label: 'Hubs CSV',
              desc: 'hub schedule',
              icon: FileSpreadsheet,
              run: exporters.hubsCsv,
            },
          ]),
      {
        label: 'Openings CSV',
        desc: 'doors, windows, glazing',
        icon: FileSpreadsheet,
        run: exporters.openingsCsv,
      },
      {
        label: 'Panels CSV',
        desc: 'skin panels per plywood sheet',
        icon: FileSpreadsheet,
        run: exporters.panelsCsv,
      },
      {
        label: 'Fabrication SVG',
        desc: 'printable strut drawings',
        icon: PencilRuler,
        run: exporters.svg,
      },
      ...(state.jointId === 'framed-panel'
        ? []
        : [
            {
              label: 'Hub labels SVG',
              desc: 'printable hub stickers',
              icon: Tag,
              run: exporters.labelsSvg,
            },
          ]),
      ...(state.jointId === 'mitered'
        ? [
            {
              label: 'Miter cuts CSV',
              desc: 'per-end compound angles',
              icon: FileSpreadsheet,
              run: exporters.miterCsv,
            },
          ]
        : []),
      ...(state.jointId === 'framed-panel'
        ? [
            {
              label: 'Panel jig drawings SVG',
              desc: 'per-type jig recipes',
              icon: PencilRuler,
              run: exporters.frameJigs,
            },
            {
              label: 'Frames CSV',
              desc: 'members, miters, bevels',
              icon: FileSpreadsheet,
              run: exporters.framesCsv,
            },
          ]
        : []),
      ...(state.mode === 'geodesic' && loadsResult.value.ok
        ? [
            {
              label: 'Loads CSV',
              desc: 'per-strut forces + utilization',
              icon: FileSpreadsheet,
              run: exporters.loadsCsv,
            },
          ]
        : []),
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
    items: [
      {
        label: 'Project JSON',
        desc: 'settings + derived data',
        icon: FileJson,
        run: exporters.json,
      },
      {
        label: 'Copy share link',
        desc: 'URL encodes the whole project',
        icon: Share2,
        run: () => void project.copyShareLink(),
      },
    ],
  },
])
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <template v-for="(group, gi) in groups" :key="group.title">
      <Separator v-if="gi > 0" />
      <section>
        <h3 class="section-title">{{ group.title }}</h3>
        <div class="grid grid-cols-2 gap-2">
          <Button
            v-for="item in group.items"
            :key="item.label"
            variant="outline"
            class="h-auto justify-start px-3 py-2.5"
            @click="item.run()"
          >
            <component :is="item.icon" data-icon="inline-start" />
            <span class="flex flex-col items-start gap-0.5 min-w-0">
              <span class="text-sm leading-none">{{ item.label }}</span>
              <span
                class="text-[11px] leading-tight text-muted-foreground font-normal truncate w-full text-left"
                >{{ item.desc }}</span
              >
            </span>
          </Button>
        </div>
      </section>
    </template>

    <Separator />

    <section>
      <h3 class="section-title">Load project</h3>
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="hidden"
        @change="onFile"
      />
      <Button variant="secondary" class="w-full" @click="fileInput?.click()">
        <Upload data-icon="inline-start" />
        Open project JSON…
      </Button>
      <p v-if="loadError" class="mt-2 text-xs text-destructive">Not a domez project file.</p>
    </section>
  </div>
</template>
