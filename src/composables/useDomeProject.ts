import { computed, reactive, watch } from 'vue'
import { generateDome } from '@/engine/dome'
import { buildCutList, JOINT_METHODS, type JointMethodId } from '@/engine/cutlist'
import { packCuts, type StockLength } from '@/engine/packing'
import { optimizeDiameter, type OptimizeResult } from '@/engine/optimize'
import { buildAssemblyPlan } from '@/engine/assembly'
import {
  analyzeOpenings,
  type OpeningAssignments,
  type OpeningGroup,
  type OpeningType,
} from '@/engine/openings'
import {
  cutDoorways,
  emptyDoorwayCut,
  optimizeDoorPlacement,
  type DoorPlacementResult,
  type DoorSpec,
} from '@/engine/doorway'
import { diameterToWorking, IMPERIAL_INCREMENTS, METRIC_INCREMENTS } from '@/engine/units'
import type { Fraction, Frequency, UnitSystem } from '@/engine/types'
import { cutListCsv, hubsCsv, boardsCsv, openingsCsv } from '@/engine/exports/csv'
import { domeObj } from '@/engine/exports/obj'
import { fabricationSvg, hubLabelsSvg } from '@/engine/exports/svg'
import { fabricationDxf } from '@/engine/exports/dxf'
import { projectJson, parseProjectJson } from '@/engine/exports/json'

export type ViewMode = 'assembly' | 'frame' | 'surface' | 'exploded'
export type Selection = { kind: 'strut'; edgeId: number } | { kind: 'hub'; vertexId: number } | null

/** Real cross-section of the strut stock, canonical mm. */
export type StrutSection =
  { kind: 'rect'; widthMm: number; depthMm: number } | { kind: 'round'; odMm: number }

export interface MaterialDef {
  id: string
  label: string
  profile: string
  section: StrutSection
  stock: { imperial: StockLength[]; metric: StockLength[] }
  defaultJoint: JointMethodId
}

export const MATERIALS: MaterialDef[] = [
  {
    id: 'lumber-2x4',
    label: 'Douglas Fir 2×4',
    profile: '1.5″ × 3.5″ (38 × 89 mm)',
    section: { kind: 'rect', widthMm: 38, depthMm: 89 },
    stock: {
      imperial: [
        { length: 96, label: '8 ft' },
        { length: 120, label: '10 ft' },
        { length: 144, label: '12 ft' },
        { length: 192, label: '16 ft' },
      ],
      metric: [
        { length: 2400, label: '2.4 m' },
        { length: 3000, label: '3.0 m' },
        { length: 3600, label: '3.6 m' },
        { length: 4800, label: '4.8 m' },
      ],
    },
    defaultJoint: 'timber-plate',
  },
  {
    id: 'lumber-2x2',
    label: 'Lumber 2×2',
    profile: '1.5″ × 1.5″ (38 × 38 mm)',
    section: { kind: 'rect', widthMm: 38, depthMm: 38 },
    stock: {
      imperial: [
        { length: 96, label: '8 ft' },
        { length: 120, label: '10 ft' },
        { length: 144, label: '12 ft' },
      ],
      metric: [
        { length: 2400, label: '2.4 m' },
        { length: 3000, label: '3.0 m' },
        { length: 3600, label: '3.6 m' },
      ],
    },
    defaultJoint: 'timber-plate',
  },
  {
    id: 'emt-34',
    label: 'EMT conduit ¾″',
    profile: '0.75″ trade size steel tube',
    section: { kind: 'round', odMm: 23.4 },
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
    section: { kind: 'round', odMm: 33.4 },
    stock: {
      imperial: [
        { length: 120, label: '10 ft' },
        { length: 240, label: '20 ft' },
      ],
      metric: [
        { length: 3000, label: '3.0 m' },
        { length: 6000, label: '6.0 m' },
      ],
    },
    defaultJoint: 'flattened-pipe',
  },
  {
    id: 'steel-tube-1',
    label: 'Steel tube 1″',
    profile: '1″ square or round, 16 ga',
    section: { kind: 'round', odMm: 25.4 },
    stock: {
      imperial: [
        { length: 240, label: '20 ft' },
        { length: 288, label: '24 ft' },
      ],
      metric: [{ length: 6000, label: '6.0 m' }],
    },
    defaultJoint: 'hub',
  },
]

const MM_PER_INCH = 25.4
const MM_PER_FOOT = 12 * MM_PER_INCH
const MM_PER_METER = 1000

interface ProjectState {
  units: UnitSystem
  frequency: Frequency
  fraction: Fraction
  baseMode: 'natural' | 'leveled'
  /** Physical quantities are stored canonically in millimeters, so unit
   * switching never changes the actual dome (no display-rounding drift). */
  diameterMm: number
  endOffsetMm: number
  kerfMm: number
  materialId: string
  jointId: JointMethodId
  /** Cut rounding increment in working units — a per-system fabrication
   * preset (1/8" vs 1 mm are intentionally different physical values). */
  increment: number
  /** Stock lengths disabled by the user, keyed by label. */
  disabledStock: Record<string, boolean>
  viewMode: ViewMode
  explode: number
  /** Render struts at their real cross-section instead of schematic sticks. */
  trueSize: boolean
  /** Panel opening assignments: faceId -> window | vent (doors are parametric). */
  openings: OpeningAssignments
  /** Parametric doorways: position + physical size, canonical mm. Doors
   * survive frequency/diameter changes — only their fit is revalidated. */
  doors: { azimuthDeg: number; widthMm: number; heightMm: number }[]
  /** Render the extruded-entry closure sealing the shell back to each buck. */
  closeDoorways: boolean
  /** Active viewer tool. 'door' places a doorway at the clicked azimuth;
   * window/vent paint panels; 'off' restores strut/hub picking. */
  openingTool: 'off' | OpeningType | 'erase'
  /** Opening group label to highlight in the viewer (from the Openings panel). */
  highlightOpening: string | null
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
  diameterMm: 26 * MM_PER_FOOT,
  endOffsetMm: 1.5 * MM_PER_INCH,
  kerfMm: (1 / 8) * MM_PER_INCH,
  materialId: 'lumber-2x4',
  jointId: 'timber-plate',
  increment: 1 / 8,
  disabledStock: {},
  viewMode: 'assembly',
  explode: 0.35,
  trueSize: false,
  openings: {},
  doors: [],
  closeDoorways: true,
  openingTool: 'off',
  highlightOpening: null,
  selection: null,
  optimizer: { min: 20, max: 30, result: null, running: false },
})

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Diameter in display units (feet or meters). Reads round the canonical mm
 * value for display only; writes set the canonical value exactly. */
const diameter = computed({
  get: () => round3(state.diameterMm / (state.units === 'imperial' ? MM_PER_FOOT : MM_PER_METER)),
  set: (v: number) => {
    if (v > 0) state.diameterMm = v * (state.units === 'imperial' ? MM_PER_FOOT : MM_PER_METER)
  },
})

/** End offset in small display units (inches or mm). */
const endOffset = computed({
  get: () =>
    round3(state.units === 'imperial' ? state.endOffsetMm / MM_PER_INCH : state.endOffsetMm),
  set: (v: number) => {
    if (v >= 0) state.endOffsetMm = state.units === 'imperial' ? v * MM_PER_INCH : v
  },
})

/** Saw kerf in small display units (inches or mm). */
const kerf = computed({
  get: () => round3(state.units === 'imperial' ? state.kerfMm / MM_PER_INCH : state.kerfMm),
  set: (v: number) => {
    if (v >= 0) state.kerfMm = state.units === 'imperial' ? v * MM_PER_INCH : v
  },
})

// Reset per-system presets when the unit system flips; canonical mm values
// are untouched, so the physical dome is identical after a round trip.
watch(
  () => state.units,
  (units, prev) => {
    if (units === prev) return
    const toMetric = units === 'metric'
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

// The end offset belongs to the joint method: adopting a new joint (directly
// or via a material switch) resets it to that joint's default. defaultEndOffset
// is specified in inches.
watch(
  () => state.jointId,
  (id, prev) => {
    if (id === prev) return
    const joint = JOINT_METHODS.find((j) => j.id === id)
    if (joint) state.endOffsetMm = joint.defaultEndOffset * MM_PER_INCH
  },
  { flush: 'sync' },
)

const model = computed(() =>
  generateDome({ frequency: state.frequency, fraction: state.fraction, baseMode: state.baseMode }),
)

// A new model invalidates edge/vertex/face ids; drop stale selection and
// openings. Sync flush so loadProjectFile can restore openings afterwards.
watch(
  model,
  () => {
    state.selection = null
    state.openings = {}
    state.highlightOpening = null
  },
  { flush: 'sync' },
)

// Working units (inches or mm) derive from canonical mm, never from the
// rounded display values.
const workingDiameter = computed(() =>
  state.units === 'imperial' ? state.diameterMm / MM_PER_INCH : state.diameterMm,
)
const radius = computed(() => workingDiameter.value / 2)
const workingEndOffset = computed(() =>
  state.units === 'imperial' ? state.endOffsetMm / MM_PER_INCH : state.endOffsetMm,
)
const workingKerf = computed(() =>
  state.units === 'imperial' ? state.kerfMm / MM_PER_INCH : state.kerfMm,
)

const material = computed(() => MATERIALS.find((m) => m.id === state.materialId) ?? MATERIALS[0])
const jointMethod = computed(
  () => JOINT_METHODS.find((j) => j.id === state.jointId) ?? JOINT_METHODS[0],
)

/** Material cross-section in working units (inches or mm) for rendering. */
const strutSectionWorking = computed(() => {
  const s = material.value.section
  const c = (mm: number) => (state.units === 'imperial' ? mm / MM_PER_INCH : mm)
  return s.kind === 'rect'
    ? { kind: 'rect' as const, width: c(s.widthMm), depth: c(s.depthMm) }
    : { kind: 'round' as const, diameter: c(s.odMm) }
})

const availableStock = computed(() => material.value.stock[state.units])
const activeStock = computed(() =>
  availableStock.value.filter((s) => !state.disabledStock[s.label]),
)

const cutList = computed(() =>
  buildCutList(
    model.value,
    {
      radius: radius.value,
      increment: state.increment,
      endOffset: workingEndOffset.value,
      units: state.units,
    },
    doorway.value,
  ),
)

const packing = computed(() =>
  packCuts(cutList.value, { kerf: workingKerf.value, stock: activeStock.value }),
)
const assemblyPlan = computed(() =>
  buildAssemblyPlan(model.value, new Set([...doorway.value.removedEdges, ...doorway.value.trimmedEdges])),
)

const openingGroups = computed<OpeningGroup[]>(() =>
  analyzeOpenings(model.value, state.openings, radius.value),
)

/** Door specs in working units, labeled D1, D2, ... in list order. */
const doorSpecs = computed<DoorSpec[]>(() => {
  const c = (mm: number) => (state.units === 'imperial' ? mm / MM_PER_INCH : mm)
  return state.doors.map((d, i) => ({
    id: `D${i + 1}`,
    azimuthDeg: d.azimuthDeg,
    width: c(d.widthMm),
    height: c(d.heightMm),
  }))
})

/** Trimmed-piece scrap floor: 6″ / 150 mm. */
const minStubLength = computed(() => (state.units === 'imperial' ? 6 : 150))

const doorway = computed(() =>
  state.doors.length === 0
    ? emptyDoorwayCut()
    : cutDoorways(model.value, doorSpecs.value, radius.value, {
        minStubLength: minStubLength.value,
      }),
)

/** Paint/erase a panel with the active opening tool (viewer click handler). */
function paintFace(faceId: number) {
  if (state.openingTool === 'off' || state.openingTool === 'door') return
  if (state.openingTool === 'erase') {
    delete state.openings[faceId]
  } else {
    state.openings[faceId] = state.openingTool
  }
  state.highlightOpening = null
}

/** Place a parametric doorway at an azimuth (viewer door-tool click).
 * Default rough opening: 36″ × 80″. One placement per tool activation. */
function addDoorAt(azimuthDeg: number) {
  state.doors.push({
    azimuthDeg: Math.round(((azimuthDeg % 360) + 360) % 360),
    widthMm: 36 * MM_PER_INCH,
    heightMm: 80 * MM_PER_INCH,
  })
  state.openingTool = 'off'
}

function removeDoor(index: number) {
  state.doors.splice(index, 1)
}

/** Snap a door to the nearest bearing where the passage meets the frame
 * cleanly (fewest hubs in the opening, fewest and least-fussy trims). */
function optimizeDoorPosition(index: number): DoorPlacementResult | null {
  const spec = doorSpecs.value[index]
  if (!spec) return null
  const result = optimizeDoorPlacement(model.value, spec, radius.value, {
    minStubLength: minStubLength.value,
    increment: state.increment,
    otherDoors: doorSpecs.value.filter((_, i) => i !== index),
  })
  state.doors[index].azimuthDeg = result.azimuthDeg
  return result
}

function removeOpeningGroup(group: OpeningGroup) {
  for (const fid of group.faceIds) delete state.openings[fid]
  if (state.highlightOpening === group.label) state.highlightOpening = null
}

function clearOpenings() {
  state.openings = {}
  state.highlightOpening = null
}

const increments = computed(() =>
  state.units === 'imperial' ? IMPERIAL_INCREMENTS : METRIC_INCREMENTS,
)

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
      endOffset: workingEndOffset.value,
      kerf: workingKerf.value,
      stock: activeStock.value,
      units: state.units,
      doors: doorSpecs.value,
      minStubLength: minStubLength.value,
    })
  } finally {
    state.optimizer.running = false
  }
}

function applyOptimizedDiameter() {
  const best = state.optimizer.result?.best
  if (!best) return
  // best.diameter is exact in working units; store it canonically.
  state.diameterMm = state.units === 'imperial' ? best.diameter * MM_PER_INCH : best.diameter
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
  () =>
    `domez-${state.frequency}v-${state.fraction.replace('/', '')}-${diameter.value}${state.units === 'imperial' ? 'ft' : 'm'}`,
)

const projectSettings = computed(() => ({
  frequency: state.frequency,
  fraction: state.fraction,
  baseMode: state.baseMode,
  diameter: diameter.value,
  units: state.units,
  material: state.materialId,
  jointMethod: state.jointId,
  endOffset: endOffset.value,
  increment: state.increment,
  kerf: kerf.value,
  stock: activeStock.value,
  openings: { ...state.openings },
  doors: state.doors.map((d) => ({ ...d })),
}))

const exporters = {
  csv: () =>
    download(`${fileStem.value}-cutlist.csv`, cutListCsv(cutList.value, state.units), 'text/csv'),
  hubsCsv: () => download(`${fileStem.value}-hubs.csv`, hubsCsv(model.value), 'text/csv'),
  boardsCsv: () =>
    download(`${fileStem.value}-boards.csv`, boardsCsv(packing.value, state.units), 'text/csv'),
  openingsCsv: () =>
    download(
      `${fileStem.value}-openings.csv`,
      openingsCsv(openingGroups.value, doorway.value.doors, state.units),
      'text/csv',
    ),
  svg: () =>
    download(
      `${fileStem.value}-fabrication.svg`,
      fabricationSvg(model.value, cutList.value, state.units, titleOf()),
      'image/svg+xml',
    ),
  labelsSvg: () =>
    download(
      `${fileStem.value}-hub-labels.svg`,
      hubLabelsSvg(model.value, assemblyPlan.value, titleOf()),
      'image/svg+xml',
    ),
  dxf: () =>
    download(
      `${fileStem.value}.dxf`,
      fabricationDxf(model.value, cutList.value, radius.value),
      'application/dxf',
    ),
  obj: () => download(`${fileStem.value}.obj`, domeObj(model.value, radius.value), 'model/obj'),
  json: () =>
    download(
      `${fileStem.value}.json`,
      projectJson(projectSettings.value, model.value, cutList.value, packing.value),
      'application/json',
    ),
  gltf: async () => {
    const [{ buildDomeGroup }, { GLTFExporter }] = await Promise.all([
      import('@/lib/three-builders'),
      import('three/examples/jsm/exporters/GLTFExporter.js'),
    ])
    const group = buildDomeGroup(model.value, radius.value, {
      mode: 'assembly',
      explode: 0,
      strutSection: state.trueSize ? strutSectionWorking.value : undefined,
      openings: state.openings,
      doorway: doorway.value,
      closeDoorways: state.closeDoorways,
    })
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync(group, { binary: true })
    download(`${fileStem.value}.glb`, new Blob([result as ArrayBuffer]), 'model/gltf-binary')
  },
}

function titleOf() {
  return `DOMEZ ${state.frequency}V ${state.fraction} · ⌀ ${diameter.value} ${state.units === 'imperial' ? 'ft' : 'm'}`
}

function loadProjectFile(text: string): boolean {
  const settings = parseProjectJson(text)
  if (!settings) return false
  state.units = settings.units as UnitSystem
  state.frequency = settings.frequency as Frequency
  state.fraction = settings.fraction as Fraction
  state.baseMode = (settings.baseMode as 'natural' | 'leveled') ?? 'natural'
  state.materialId = settings.material
  // Sync watchers fire on units/materialId/jointId; set explicit values
  // after them (jointId before endOffset, or the joint-default reset would
  // clobber the loaded offset). The file stores display units; the setters
  // store canonical mm.
  state.jointId = settings.jointMethod as JointMethodId
  diameter.value = settings.diameter
  endOffset.value = settings.endOffset
  kerf.value = settings.kerf
  state.increment = settings.increment
  // Restore openings after the sync model watcher has cleared them,
  // dropping any face ids or types that don't fit the loaded model.
  const openings: OpeningAssignments = {}
  const faceCount = model.value.faces.length
  for (const [key, type] of Object.entries(settings.openings ?? {})) {
    const fid = Number(key)
    if (
      Number.isInteger(fid) &&
      fid >= 0 &&
      fid < faceCount &&
      (type === 'window' || type === 'door' || type === 'vent')
    ) {
      openings[fid] = type
    }
  }
  state.openings = openings
  state.doors = (settings.doors ?? [])
    .filter(
      (d) =>
        typeof d?.azimuthDeg === 'number' &&
        typeof d?.widthMm === 'number' &&
        typeof d?.heightMm === 'number' &&
        d.widthMm > 0 &&
        d.heightMm > 0,
    )
    .map((d) => ({ azimuthDeg: d.azimuthDeg, widthMm: d.widthMm, heightMm: d.heightMm }))
  state.selection = null
  return true
}

export function useDomeProject() {
  return {
    state,
    model,
    radius,
    workingDiameter,
    diameter,
    endOffset,
    kerf,
    material,
    jointMethod,
    strutSectionWorking,
    availableStock,
    activeStock,
    cutList,
    packing,
    assemblyPlan,
    openingGroups,
    doorway,
    doorSpecs,
    paintFace,
    addDoorAt,
    removeDoor,
    optimizeDoorPosition,
    removeOpeningGroup,
    clearOpenings,
    increments,
    summary,
    runOptimizer,
    applyOptimizedDiameter,
    exporters,
    loadProjectFile,
    titleOf,
  }
}
