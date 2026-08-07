import { computed, reactive, watch } from 'vue'
import { generateDome } from '@/engine/dome'
import { buildCutList, JOINT_METHODS, type JointMethodId } from '@/engine/cutlist'
import { packCuts, type StockLength } from '@/engine/packing'
import { optimizeDiameter, type OptimizeResult } from '@/engine/optimize'
import { buildAssemblyPlan } from '@/engine/assembly'
import {
  diameterToWorking, IMPERIAL_INCREMENTS, METRIC_INCREMENTS,
} from '@/engine/units'
import type { Fraction, Frequency, UnitSystem } from '@/engine/types'
import { cutListCsv, hubsCsv, boardsCsv } from '@/engine/exports/csv'
import { domeObj } from '@/engine/exports/obj'
import { fabricationSvg, hubLabelsSvg } from '@/engine/exports/svg'
import { fabricationDxf } from '@/engine/exports/dxf'
import { projectJson, parseProjectJson } from '@/engine/exports/json'

export type ViewMode = 'assembly' | 'frame' | 'surface' | 'exploded'
export type Selection =
  | { kind: 'strut'; edgeId: number }
  | { kind: 'hub'; vertexId: number }
  | null

export interface MaterialDef {
  id: string
  label: string
  profile: string
  stock: { imperial: StockLength[]; metric: StockLength[] }
  defaultJoint: JointMethodId
}

export const MATERIALS: MaterialDef[] = [
  {
    id: 'lumber-2x4',
    label: 'Douglas Fir 2×4',
    profile: '1.5″ × 3.5″ (38 × 89 mm)',
    stock: {
      imperial: [
        { length: 96, label: '8 ft' }, { length: 120, label: '10 ft' },
        { length: 144, label: '12 ft' }, { length: 192, label: '16 ft' },
      ],
      metric: [
        { length: 2400, label: '2.4 m' }, { length: 3000, label: '3.0 m' },
        { length: 3600, label: '3.6 m' }, { length: 4800, label: '4.8 m' },
      ],
    },
    defaultJoint: 'timber-plate',
  },
  {
    id: 'lumber-2x2',
    label: 'Lumber 2×2',
    profile: '1.5″ × 1.5″ (38 × 38 mm)',
    stock: {
      imperial: [
        { length: 96, label: '8 ft' }, { length: 120, label: '10 ft' },
        { length: 144, label: '12 ft' },
      ],
      metric: [
        { length: 2400, label: '2.4 m' }, { length: 3000, label: '3.0 m' },
        { length: 3600, label: '3.6 m' },
      ],
    },
    defaultJoint: 'timber-plate',
  },
  {
    id: 'emt-34',
    label: 'EMT conduit ¾″',
    profile: '0.75″ trade size steel tube',
    stock: {
      imperial: [{ length: 120, label: '10 ft' }],
      metric: [{ length: 3000, label: '3.0 m' }],
    },
    defaultJoint: 'flattened-pipe',
  },
  {
    id: 'pvc-1',
    label: 'PVC pipe 1″',
    profile: 'Schedule 40',
    stock: {
      imperial: [{ length: 120, label: '10 ft' }, { length: 240, label: '20 ft' }],
      metric: [{ length: 3000, label: '3.0 m' }, { length: 6000, label: '6.0 m' }],
    },
    defaultJoint: 'flattened-pipe',
  },
  {
    id: 'steel-tube-1',
    label: 'Steel tube 1″',
    profile: '1″ square or round, 16 ga',
    stock: {
      imperial: [{ length: 240, label: '20 ft' }, { length: 288, label: '24 ft' }],
      metric: [{ length: 6000, label: '6.0 m' }],
    },
    defaultJoint: 'hub',
  },
]

interface ProjectState {
  units: UnitSystem
  frequency: Frequency
  fraction: Fraction
  baseMode: 'natural' | 'leveled'
  /** Diameter in display units: feet (imperial) or meters (metric). */
  diameter: number
  materialId: string
  jointId: JointMethodId
  /** Working units: inches or mm. */
  endOffset: number
  increment: number
  kerf: number
  /** Stock lengths disabled by the user, keyed by label. */
  disabledStock: Record<string, boolean>
  viewMode: ViewMode
  explode: number
  selection: Selection
  optimizer: {
    min: number
    max: number
    result: OptimizeResult | null
    running: boolean
  }
}

const state = reactive<ProjectState>({
  units: 'imperial',
  frequency: 5,
  fraction: '5/8',
  baseMode: 'natural',
  diameter: 26,
  materialId: 'lumber-2x4',
  jointId: 'timber-plate',
  endOffset: 1.5,
  increment: 1 / 8,
  kerf: 1 / 8,
  disabledStock: {},
  viewMode: 'assembly',
  explode: 0.35,
  selection: null,
  optimizer: { min: 20, max: 30, result: null, running: false },
})

// Convert unit-bearing fields when the unit system flips.
watch(
  () => state.units,
  (units, prev) => {
    if (units === prev) return
    const toMetric = units === 'metric'
    const len = (v: number) => (toMetric ? v * 25.4 : v / 25.4)
    state.diameter = toMetric
      ? Math.round(state.diameter * 0.3048 * 100) / 100
      : Math.round((state.diameter / 0.3048) * 100) / 100
    state.endOffset = Math.round(len(state.endOffset) * 100) / 100
    state.kerf = Math.round(len(state.kerf) * 100) / 100
    state.increment = toMetric ? 1 : 1 / 8
    state.optimizer.min = toMetric ? 6 : 20
    state.optimizer.max = toMetric ? 9 : 30
    state.optimizer.result = null
    state.disabledStock = {}
  },
  // Sync flush so loadProjectFile can overwrite converted values afterwards.
  { flush: 'sync' },
)

// Material change adopts its natural joint method.
watch(
  () => state.materialId,
  (id) => {
    const mat = MATERIALS.find((m) => m.id === id)
    if (mat) {
      state.jointId = mat.defaultJoint
      state.disabledStock = {}
      state.optimizer.result = null
    }
  },
  { flush: 'sync' },
)

const model = computed(() =>
  generateDome({ frequency: state.frequency, fraction: state.fraction, baseMode: state.baseMode }),
)

// A new model invalidates edge/vertex ids; drop any stale selection.
watch(model, () => (state.selection = null))

const workingDiameter = computed(() => diameterToWorking(state.diameter, state.units))
const radius = computed(() => workingDiameter.value / 2)

const material = computed(() => MATERIALS.find((m) => m.id === state.materialId) ?? MATERIALS[0])
const jointMethod = computed(() => JOINT_METHODS.find((j) => j.id === state.jointId) ?? JOINT_METHODS[0])

const availableStock = computed(() => material.value.stock[state.units])
const activeStock = computed(() => availableStock.value.filter((s) => !state.disabledStock[s.label]))

const cutList = computed(() =>
  buildCutList(model.value, {
    radius: radius.value,
    increment: state.increment,
    endOffset: state.endOffset,
    units: state.units,
  }),
)

const packing = computed(() => packCuts(cutList.value, { kerf: state.kerf, stock: activeStock.value }))
const assemblyPlan = computed(() => buildAssemblyPlan(model.value))

const increments = computed(() => (state.units === 'imperial' ? IMPERIAL_INCREMENTS : METRIC_INCREMENTS))

const summary = computed(() => {
  const m = model.value
  const r = radius.value
  return {
    height: m.unitHeight * r,
    baseRadius: m.unitBaseRadius * r,
    floorArea: Math.PI * (m.unitBaseRadius * r) ** 2,
    struts: cutList.value.totalStruts,
    hubs: m.vertices.length,
    panels: m.faces.length,
    actualFraction: m.actualFraction,
  }
})

function runOptimizer() {
  state.optimizer.running = true
  try {
    state.optimizer.result = optimizeDiameter(model.value, {
      minDiameter: diameterToWorking(state.optimizer.min, state.units),
      maxDiameter: diameterToWorking(state.optimizer.max, state.units),
      step: state.units === 'imperial' ? 0.125 : 2,
      increment: state.increment,
      endOffset: state.endOffset,
      kerf: state.kerf,
      stock: activeStock.value,
      units: state.units,
    })
  } finally {
    state.optimizer.running = false
  }
}

function applyOptimizedDiameter() {
  const best = state.optimizer.result?.best
  if (best) state.diameter = Math.round(best.diameterDisplay * 1000) / 1000
}

function download(filename: string, content: string | Blob, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const fileStem = computed(
  () => `domez-${state.frequency}v-${state.fraction.replace('/', '')}-${state.diameter}${state.units === 'imperial' ? 'ft' : 'm'}`,
)

const projectSettings = computed(() => ({
  frequency: state.frequency,
  fraction: state.fraction,
  baseMode: state.baseMode,
  diameter: state.diameter,
  units: state.units,
  material: state.materialId,
  jointMethod: state.jointId,
  endOffset: state.endOffset,
  increment: state.increment,
  kerf: state.kerf,
  stock: activeStock.value,
}))

const exporters = {
  csv: () => download(`${fileStem.value}-cutlist.csv`, cutListCsv(cutList.value, state.units), 'text/csv'),
  hubsCsv: () => download(`${fileStem.value}-hubs.csv`, hubsCsv(model.value), 'text/csv'),
  boardsCsv: () => download(`${fileStem.value}-boards.csv`, boardsCsv(packing.value, state.units), 'text/csv'),
  svg: () =>
    download(`${fileStem.value}-fabrication.svg`, fabricationSvg(model.value, cutList.value, state.units, titleOf()), 'image/svg+xml'),
  labelsSvg: () =>
    download(`${fileStem.value}-hub-labels.svg`, hubLabelsSvg(model.value, assemblyPlan.value, titleOf()), 'image/svg+xml'),
  dxf: () => download(`${fileStem.value}.dxf`, fabricationDxf(model.value, cutList.value, radius.value), 'application/dxf'),
  obj: () => download(`${fileStem.value}.obj`, domeObj(model.value, radius.value), 'model/obj'),
  json: () =>
    download(`${fileStem.value}.json`, projectJson(projectSettings.value, model.value, cutList.value, packing.value), 'application/json'),
  gltf: async () => {
    const [{ buildDomeGroup }, { GLTFExporter }] = await Promise.all([
      import('@/lib/three-builders'),
      import('three/examples/jsm/exporters/GLTFExporter.js'),
    ])
    const group = buildDomeGroup(model.value, radius.value, { mode: 'assembly', explode: 0 })
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync(group, { binary: true })
    download(`${fileStem.value}.glb`, new Blob([result as ArrayBuffer]), 'model/gltf-binary')
  },
}

function titleOf() {
  return `DOMEZ ${state.frequency}V ${state.fraction} · ⌀ ${state.diameter} ${state.units === 'imperial' ? 'ft' : 'm'}`
}

function loadProjectFile(text: string): boolean {
  const settings = parseProjectJson(text)
  if (!settings) return false
  state.units = settings.units as UnitSystem
  state.frequency = settings.frequency as Frequency
  state.fraction = settings.fraction as Fraction
  state.baseMode = (settings.baseMode as 'natural' | 'leveled') ?? 'natural'
  state.diameter = settings.diameter
  state.materialId = settings.material
  // Two watchers above fire on materialId/units; restore explicit values after.
  state.jointId = settings.jointMethod as JointMethodId
  state.endOffset = settings.endOffset
  state.increment = settings.increment
  state.kerf = settings.kerf
  state.selection = null
  return true
}

export function useDomeProject() {
  return {
    state,
    model,
    radius,
    workingDiameter,
    material,
    jointMethod,
    availableStock,
    activeStock,
    cutList,
    packing,
    assemblyPlan,
    increments,
    summary,
    runOptimizer,
    applyOptimizedDiameter,
    exporters,
    loadProjectFile,
    titleOf,
  }
}
