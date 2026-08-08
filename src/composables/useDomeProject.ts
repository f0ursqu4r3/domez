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
import { planPanels } from '@/engine/panels'
import { buildRiser } from '@/engine/riser'
import { buildBom, estimateCost } from '@/engine/bom'
import { generateZome } from '@/engine/zome'
import { diameterToWorking, IMPERIAL_INCREMENTS, METRIC_INCREMENTS } from '@/engine/units'
import type { Fraction, Frequency, UnitSystem } from '@/engine/types'
import { cutListCsv, hubsCsv, boardsCsv, openingsCsv, panelsCsv, miterCsv, costsCsv } from '@/engine/exports/csv'
import { cutTemplatesSvg, boardDiagramsSvg } from '@/engine/exports/templates'
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
  /** Structure family. Geodesic settings and zome settings are independent
   * fields, so switching modes round-trips losslessly. */
  mode: 'geodesic' | 'zome'
  frequency: Frequency
  fraction: Fraction
  /** Shared by both modes: geodesic = slide boundary hubs onto the cut
   * plane; zome = fill the zigzag rim with half-rhombi + base chords. */
  baseMode: 'natural' | 'leveled'
  /** Zome: generators around the axis (4..16). */
  zomeSides: number
  /** Zome: generator pitch off the axis, degrees (20..70). */
  zomePitchDeg: number
  /** Zome: rhombus bands kept from the apex (1..sides-2). */
  zomeRows: number
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
   * survive frequency/diameter changes — only their fit is revalidated.
   * depthMm is signed (negative pushes the buck toward the shell);
   * marginMm is the cut clearance band around the rough opening. */
  doors: { azimuthDeg: number; widthMm: number; heightMm: number; depthMm: number; marginMm: number }[]
  /** Parametric framed windows: doors with a sill height. Canonical mm. */
  framedWindows: {
    azimuthDeg: number
    sillMm: number
    widthMm: number
    heightMm: number
    depthMm: number
    marginMm: number
  }[]
  /** Render the extruded-entry closure sealing the shell back to each buck. */
  closeDoorways: boolean
  /** Stud-framed riser wall under the base ring, canonical mm (0 = none).
   * Requires the leveled base — ignored under a natural (non-planar) ring. */
  riserHeightMm: number
  /** Which face(s) of the frame the skin panels mount to. 'both' doubles
   * the panel material takeoff. */
  panelPlacement: 'outside' | 'inside' | 'both'
  /** Active viewer tool. 'door' places a doorway at the clicked azimuth;
   * window/vent paint panels; 'off' restores strut/hub picking. */
  openingTool: 'off' | OpeningType | 'erase'
  /** Sparse price-book overrides by key; defaults live in the engine. */
  prices: Record<string, number>
  /** Currency symbol for cost display (max 3 chars). */
  currency: string
  /** Opening group label to highlight in the viewer (from the Openings panel). */
  highlightOpening: string | null
  selection: Selection
  /** Bumped by resetProject so the viewer re-frames its camera. Not persisted. */
  viewResetToken: number
  optimizer: {
    min: number
    max: number
    result: OptimizeResult | null
    running: boolean
  }
}

const state = reactive<ProjectState>({
  units: 'imperial',
  mode: 'geodesic',
  frequency: 5,
  fraction: '5/8',
  baseMode: 'natural',
  zomeSides: 8,
  zomePitchDeg: 45,
  zomeRows: 4,
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
  framedWindows: [],
  closeDoorways: true,
  riserHeightMm: 0,
  panelPlacement: 'outside',
  openingTool: 'off',
  prices: {},
  currency: '$',
  highlightOpening: null,
  selection: null,
  viewResetToken: 0,
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

/** Riser wall height in small display units (inches or mm). */
const riserHeight = computed({
  get: () =>
    round3(state.units === 'imperial' ? state.riserHeightMm / MM_PER_INCH : state.riserHeightMm),
  set: (v: number) => {
    if (v >= 0) state.riserHeightMm = state.units === 'imperial' ? v * MM_PER_INCH : v
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

// Fewer sides ⇒ fewer possible rows; keep the kept-bands count valid.
watch(
  () => state.zomeSides,
  (n) => {
    state.zomeRows = Math.max(1, Math.min(n - 2, state.zomeRows))
  },
  { flush: 'sync' },
)

const model = computed(() =>
  state.mode === 'zome'
    ? generateZome({
        sides: state.zomeSides,
        pitchDeg: state.zomePitchDeg,
        rows: state.zomeRows,
        baseMode: state.baseMode,
      })
    : generateDome({ frequency: state.frequency, fraction: state.fraction, baseMode: state.baseMode }),
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

/** Riser height in working units — active only on a leveled, truncated base. */
const workingRiserHeight = computed(() =>
  state.baseMode === 'leveled' &&
  (state.mode === 'zome' || state.fraction !== 'full') &&
  state.riserHeightMm > 0
    ? state.units === 'imperial'
      ? state.riserHeightMm / MM_PER_INCH
      : state.riserHeightMm
    : 0,
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
    riser.value,
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
    extraDepth: c(d.depthMm),
    margin: c(d.marginMm),
  }))
})

/** Framed window specs in working units, labeled W1, W2, ... */
const windowSpecs = computed<DoorSpec[]>(() => {
  const c = (mm: number) => (state.units === 'imperial' ? mm / MM_PER_INCH : mm)
  return state.framedWindows.map((w, i) => ({
    id: `W${i + 1}`,
    azimuthDeg: w.azimuthDeg,
    width: c(w.widthMm),
    height: c(w.heightMm),
    sillHeight: c(w.sillMm),
    extraDepth: c(w.depthMm),
    margin: c(w.marginMm),
  }))
})

/** Everything the doorway cutter processes: doors + framed windows. */
const portalSpecs = computed<DoorSpec[]>(() => [...doorSpecs.value, ...windowSpecs.value])

/** Trimmed-piece scrap floor: 6″ / 150 mm. */
const minStubLength = computed(() => (state.units === 'imperial' ? 6 : 150))
/** Closure framing stud spacing: 16″ / 400 mm o.c. Zero when the closure
 * is toggled off, which also drops the framing from the cut list. */
const studSpacing = computed(() =>
  state.closeDoorways ? (state.units === 'imperial' ? 16 : 400) : 0,
)

const doorway = computed(() =>
  portalSpecs.value.length === 0
    ? emptyDoorwayCut()
    : cutDoorways(model.value, portalSpecs.value, radius.value, {
        minStubLength: minStubLength.value,
        studSpacing: studSpacing.value,
        riserHeight: workingRiserHeight.value,
      }),
)

/** Split doorway results for the UI: D* are doors, W* framed windows. */
const doorInfos = computed(() => doorway.value.doors.filter((d) => d.id.startsWith('D')))
const windowInfos = computed(() => doorway.value.doors.filter((d) => d.id.startsWith('W')))

/** Stud spacing for the riser wall — a real wall, independent of closeDoorways. */
const riserStudSpacing = computed(() => (state.units === 'imperial' ? 16 : 400))

/** The stud-framed knee wall under the base ring; null when disabled. */
const riser = computed(() =>
  workingRiserHeight.value > 0
    ? buildRiser(model.value, radius.value, {
        height: workingRiserHeight.value,
        studSpacing: riserStudSpacing.value,
        memberWidth:
          strutSectionWorking.value.kind === 'rect'
            ? strutSectionWorking.value.width
            : strutSectionWorking.value.diameter,
        minStubLength: minStubLength.value,
        doors: doorSpecs.value,
      })
    : null,
)

/** Standard sheet-good size for the skin panels. */
const panelSheet = computed(() =>
  state.units === 'imperial'
    ? { w: 48, l: 96, label: '4×8 ft sheet' }
    : { w: 1220, l: 2440, label: '1220×2440 mm sheet' },
)

/** Skin panel takeoff: solid panels only (openings and doorway cuts are
 * not skinned), doubled when panels mount inside AND outside. */
const panelPlan = computed(() => {
  const exclude = new Set<number>(doorway.value.removedFaces)
  for (const key of Object.keys(state.openings)) exclude.add(Number(key))
  // Zome rhombi never take the triangle path: surviving ones (no cut, no
  // painted opening on either half) join as whole rhombic pieces.
  const rhombs: { d1: number; d2: number }[] = []
  if (model.value.rhombi) {
    for (const rh of model.value.rhombi) {
      const dead = rh.faceIds.some((fid) => exclude.has(fid))
      rh.faceIds.forEach((fid) => exclude.add(fid))
      if (dead) continue
      const [t, a, b, sv] = rh.vertexIds.map((vi) => model.value.vertices[vi].position)
      rhombs.push({
        d1: Math.hypot(t[0] - b[0], t[1] - b[1], t[2] - b[2]) * radius.value,
        d2: Math.hypot(a[0] - sv[0], a[1] - sv[1], a[2] - sv[2]) * radius.value,
      })
    }
  }
  return planPanels(model.value, radius.value, {
    sheetW: panelSheet.value.w,
    sheetL: panelSheet.value.l,
    sheetLabel: panelSheet.value.label,
    excludeFaceIds: exclude,
    skinFactor: state.panelPlacement === 'both' ? 2 : 1,
    rects: riser.value?.sheathingRects,
    rhombs,
  })
})

/** Paint/erase a panel with the active opening tool (viewer click handler).
 * Doors and framed windows are parametric — only vents (and erase) paint. */
function paintFace(faceId: number) {
  if (state.openingTool === 'off' || state.openingTool === 'door' || state.openingTool === 'window')
    return
  // Zome rhombi paint as a unit: apply to both triangle halves.
  const rh = model.value.rhombi?.find((r) => r.faceIds.includes(faceId))
  const targets = rh ? rh.faceIds : [faceId]
  for (const fid of targets) {
    if (state.openingTool === 'erase') {
      delete state.openings[fid]
    } else {
      state.openings[fid] = state.openingTool
    }
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
    depthMm: 0,
    marginMm: 0,
  })
  state.openingTool = 'off'
}

function removeDoor(index: number) {
  state.doors.splice(index, 1)
}

/** Place a framed window at an azimuth, sill taken from where the user
 * clicked (centered on the click point). Default 36″ × 36″. */
function addWindowAt(azimuthDeg: number, clickHeightMm: number) {
  const heightMm = 36 * MM_PER_INCH
  const sillMm = Math.max(12 * MM_PER_INCH, clickHeightMm - heightMm / 2)
  state.framedWindows.push({
    azimuthDeg: Math.round(((azimuthDeg % 360) + 360) % 360),
    sillMm,
    widthMm: 36 * MM_PER_INCH,
    heightMm,
    depthMm: 0,
    marginMm: 0,
  })
  state.openingTool = 'off'
}

function removeWindow(index: number) {
  state.framedWindows.splice(index, 1)
}

/** Snap a door to the nearest bearing where the passage meets the frame
 * cleanly (fewest hubs in the opening, fewest and least-fussy trims). */
function optimizeDoorPosition(index: number): DoorPlacementResult | null {
  const spec = doorSpecs.value[index]
  if (!spec) return null
  const result = optimizeDoorPlacement(model.value, spec, radius.value, {
    minStubLength: minStubLength.value,
    increment: state.increment,
    otherDoors: portalSpecs.value.filter((s) => s.id !== spec.id),
  })
  state.doors[index].azimuthDeg = result.azimuthDeg
  return result
}

function optimizeWindowPosition(index: number): DoorPlacementResult | null {
  const spec = windowSpecs.value[index]
  if (!spec) return null
  const result = optimizeDoorPlacement(model.value, spec, radius.value, {
    minStubLength: minStubLength.value,
    increment: state.increment,
    otherDoors: portalSpecs.value.filter((s) => s.id !== spec.id),
  })
  state.framedWindows[index].azimuthDeg = result.azimuthDeg
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
    height: m.unitHeight * r + workingRiserHeight.value,
    baseRadius: m.unitBaseRadius * r,
    floorArea: Math.PI * (m.unitBaseRadius * r) ** 2,
    struts: cutList.value.totalStruts,
    hubs: m.vertices.length,
    panels: m.faces.length,
    actualFraction: m.actualFraction,
  }
})

/** Hardware bill of materials for the current build. */
const bom = computed(() =>
  buildBom(model.value, doorway.value, riser.value, state.jointId, panelPlan.value),
)

/** Priced build estimate through the editable price book. */
const costEstimate = computed(() =>
  estimateCost({
    boardCounts: packing.value.boardCounts,
    totalSheets: panelPlan.value.totalSheets,
    sheetLabel: panelSheet.value.label,
    bom: bom.value,
    prices: state.prices,
    floorArea: summary.value.floorArea,
    units: state.units,
  }),
)

/** Write (or clear, when ≤ 0) a price-book override. */
function setPrice(key: string, value: number) {
  if (Number.isFinite(value) && value > 0) state.prices[key] = value
  else delete state.prices[key]
}

function resetPrices() {
  state.prices = {}
}

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
      studSpacing: studSpacing.value,
      riserHeight: workingRiserHeight.value,
      riserMemberWidth:
        strutSectionWorking.value.kind === 'rect'
          ? strutSectionWorking.value.width
          : strutSectionWorking.value.diameter,
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

const fileStem = computed(() => {
  const family =
    state.mode === 'zome'
      ? `z${state.zomeSides}-${state.zomePitchDeg}deg`
      : `${state.frequency}v-${state.fraction.replace('/', '')}`
  return `domez-${family}-${diameter.value}${state.units === 'imperial' ? 'ft' : 'm'}`
})

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
  windows: state.framedWindows.map((w) => ({ ...w })),
  panelPlacement: state.panelPlacement,
  riserHeightMm: state.riserHeightMm,
  mode: state.mode,
  zomeSides: state.zomeSides,
  zomePitchDeg: state.zomePitchDeg,
  zomeRows: state.zomeRows,
  prices: { ...state.prices },
  currency: state.currency,
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
  panelsCsv: () =>
    download(`${fileStem.value}-panels.csv`, panelsCsv(panelPlan.value, state.units), 'text/csv'),
  miterCsv: () =>
    download(
      `${fileStem.value}-miter-cuts.csv`,
      miterCsv(model.value, state.units, radius.value),
      'text/csv',
    ),
  cutTemplates: () =>
    download(
      `${fileStem.value}-cut-templates.svg`,
      cutTemplatesSvg(model.value, cutList.value, {
        units: state.units,
        jointId: state.jointId,
        endOffset: workingEndOffset.value,
        radius: radius.value,
        section: strutSectionWorking.value,
        title: titleOf(),
      }),
      'image/svg+xml',
    ),
  costsCsv: () =>
    download(
      `${fileStem.value}-costs.csv`,
      costsCsv(costEstimate.value, state.currency),
      'text/csv',
    ),
  boardDiagrams: () =>
    download(
      `${fileStem.value}-board-diagrams.svg`,
      boardDiagramsSvg(packing.value, {
        units: state.units,
        title: titleOf(),
        kerf: workingKerf.value,
      }),
      'image/svg+xml',
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
      panelPlacement: state.panelPlacement,
      riser: riser.value,
      jointId: state.jointId,
      endOffset: workingEndOffset.value,
    })
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync(group, { binary: true })
    download(`${fileStem.value}.glb`, new Blob([result as ArrayBuffer]), 'model/gltf-binary')
  },
}

function titleOf() {
  const family =
    state.mode === 'zome'
      ? `Z${state.zomeSides} ${state.zomePitchDeg}°`
      : `${state.frequency}V ${state.fraction}`
  return `DOMEZ ${family} · ⌀ ${diameter.value} ${state.units === 'imperial' ? 'ft' : 'm'}`
}

function loadProjectFile(text: string): boolean {
  const settings = parseProjectJson(text)
  if (!settings) return false
  state.units = settings.units as UnitSystem
  state.frequency = settings.frequency as Frequency
  state.fraction = settings.fraction as Fraction
  state.baseMode = (settings.baseMode as 'natural' | 'leveled') ?? 'natural'
  state.mode = settings.mode === 'zome' ? 'zome' : 'geodesic'
  if (typeof settings.zomeSides === 'number' && settings.zomeSides >= 4 && settings.zomeSides <= 16)
    state.zomeSides = Math.round(settings.zomeSides)
  if (
    typeof settings.zomePitchDeg === 'number' &&
    settings.zomePitchDeg >= 20 &&
    settings.zomePitchDeg <= 70
  )
    state.zomePitchDeg = settings.zomePitchDeg
  if (typeof settings.zomeRows === 'number' && settings.zomeRows >= 1)
    state.zomeRows = Math.max(1, Math.min(state.zomeSides - 2, Math.round(settings.zomeRows)))
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
  state.riserHeightMm =
    typeof settings.riserHeightMm === 'number' && settings.riserHeightMm >= 0
      ? settings.riserHeightMm
      : 0
  state.prices = {}
  if (settings.prices && typeof settings.prices === 'object') {
    for (const [k, v] of Object.entries(settings.prices)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) state.prices[k] = v
    }
  }
  state.currency =
    typeof settings.currency === 'string' && settings.currency.length > 0
      ? settings.currency.slice(0, 3)
      : '$'
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
    .map((d) => ({
      azimuthDeg: d.azimuthDeg,
      widthMm: d.widthMm,
      heightMm: d.heightMm,
      depthMm: typeof d.depthMm === 'number' ? d.depthMm : 0,
      marginMm: typeof d.marginMm === 'number' && d.marginMm > 0 ? d.marginMm : 0,
    }))
  state.framedWindows = (settings.windows ?? [])
    .filter(
      (w) =>
        typeof w?.azimuthDeg === 'number' &&
        typeof w?.sillMm === 'number' &&
        typeof w?.widthMm === 'number' &&
        typeof w?.heightMm === 'number' &&
        w.sillMm > 0 &&
        w.widthMm > 0 &&
        w.heightMm > 0,
    )
    .map((w) => ({
      azimuthDeg: w.azimuthDeg,
      sillMm: w.sillMm,
      widthMm: w.widthMm,
      heightMm: w.heightMm,
      depthMm: typeof w.depthMm === 'number' ? w.depthMm : 0,
      marginMm: typeof w.marginMm === 'number' && w.marginMm > 0 ? w.marginMm : 0,
    }))
  if (
    settings.panelPlacement === 'outside' ||
    settings.panelPlacement === 'inside' ||
    settings.panelPlacement === 'both'
  ) {
    state.panelPlacement = settings.panelPlacement
  }
  state.selection = null
  return true
}

// ---- Persistence: the project survives page refreshes ----------------------

const STORAGE_KEY = 'domez-project-v1'

function persistedSlice() {
  return {
    units: state.units,
    mode: state.mode,
    frequency: state.frequency,
    fraction: state.fraction,
    baseMode: state.baseMode,
    zomeSides: state.zomeSides,
    zomePitchDeg: state.zomePitchDeg,
    zomeRows: state.zomeRows,
    diameterMm: state.diameterMm,
    endOffsetMm: state.endOffsetMm,
    kerfMm: state.kerfMm,
    materialId: state.materialId,
    jointId: state.jointId,
    increment: state.increment,
    disabledStock: { ...state.disabledStock },
    viewMode: state.viewMode,
    explode: state.explode,
    trueSize: state.trueSize,
    openings: { ...state.openings },
    doors: state.doors.map((d) => ({ ...d })),
    framedWindows: state.framedWindows.map((w) => ({ ...w })),
    closeDoorways: state.closeDoorways,
    riserHeightMm: state.riserHeightMm,
    prices: { ...state.prices },
    currency: state.currency,
    panelPlacement: state.panelPlacement,
    optimizerMin: state.optimizer.min,
    optimizerMax: state.optimizer.max,
  }
}

/** Restore a saved session. Field order matters: the sync watchers on
 * units/material/joint reset dependent values, and the model watcher clears
 * openings — so geometry and identity fields go first, values after. */
function restorePersisted() {
  if (typeof localStorage === 'undefined') return
  let p: Record<string, unknown>
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    p = JSON.parse(raw)
  } catch {
    return
  }
  try {
    if (p.units === 'imperial' || p.units === 'metric') state.units = p.units
    if ([1, 2, 3, 4, 5, 6].includes(p.frequency as number)) state.frequency = p.frequency as Frequency
    if (['3/8', '1/2', '5/8'].includes(p.fraction as string)) state.fraction = p.fraction as Fraction
    if (p.baseMode === 'natural' || p.baseMode === 'leveled') state.baseMode = p.baseMode
    if (p.mode === 'geodesic' || p.mode === 'zome') state.mode = p.mode
    if (MATERIALS.some((m) => m.id === p.materialId)) state.materialId = p.materialId as string
    if (JOINT_METHODS.some((j) => j.id === p.jointId)) state.jointId = p.jointId as JointMethodId
    const num = (v: unknown, ok: (n: number) => boolean) =>
      typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : undefined
    state.diameterMm = num(p.diameterMm, (n) => n > 0) ?? state.diameterMm
    state.endOffsetMm = num(p.endOffsetMm, (n) => n >= 0) ?? state.endOffsetMm
    state.kerfMm = num(p.kerfMm, (n) => n >= 0) ?? state.kerfMm
    state.increment = num(p.increment, (n) => n > 0) ?? state.increment
    if (p.disabledStock && typeof p.disabledStock === 'object') {
      state.disabledStock = Object.fromEntries(
        Object.entries(p.disabledStock as Record<string, unknown>).map(([k, v]) => [k, !!v]),
      )
    }
    if (['assembly', 'frame', 'surface', 'exploded'].includes(p.viewMode as string)) {
      state.viewMode = p.viewMode as ViewMode
    }
    state.explode = num(p.explode, (n) => n >= 0 && n <= 1) ?? state.explode
    state.trueSize = !!p.trueSize
    state.closeDoorways = p.closeDoorways !== false
    state.riserHeightMm = num(p.riserHeightMm, (n) => n >= 0) ?? state.riserHeightMm
    const sides = num(p.zomeSides, (v) => v >= 4 && v <= 16)
    if (sides !== undefined) state.zomeSides = Math.round(sides)
    state.zomePitchDeg = num(p.zomePitchDeg, (v) => v >= 20 && v <= 70) ?? state.zomePitchDeg
    const zr = num(p.zomeRows, (v) => v >= 1)
    if (zr !== undefined) state.zomeRows = Math.max(1, Math.min(state.zomeSides - 2, Math.round(zr)))
    if (p.prices && typeof p.prices === 'object') {
      const prices: Record<string, number> = {}
      for (const [k, v] of Object.entries(p.prices as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) prices[k] = v
      }
      state.prices = prices
    }
    if (typeof p.currency === 'string' && p.currency.length > 0) {
      state.currency = p.currency.slice(0, 3)
    }
    if (['outside', 'inside', 'both'].includes(p.panelPlacement as string)) {
      state.panelPlacement = p.panelPlacement as 'outside' | 'inside' | 'both'
    }
    state.optimizer.min = num(p.optimizerMin, (n) => n > 0) ?? state.optimizer.min
    state.optimizer.max = num(p.optimizerMax, (n) => n > 0) ?? state.optimizer.max
    state.doors = Array.isArray(p.doors)
      ? (p.doors as Record<string, unknown>[])
          .filter(
            (d) =>
              typeof d?.azimuthDeg === 'number' &&
              typeof d?.widthMm === 'number' &&
              (d.widthMm as number) > 0 &&
              typeof d?.heightMm === 'number' &&
              (d.heightMm as number) > 0,
          )
          .map((d) => ({
            azimuthDeg: d.azimuthDeg as number,
            widthMm: d.widthMm as number,
            heightMm: d.heightMm as number,
            depthMm: typeof d.depthMm === 'number' ? d.depthMm : 0,
            marginMm: typeof d.marginMm === 'number' && d.marginMm > 0 ? d.marginMm : 0,
          }))
      : state.doors
    state.framedWindows = Array.isArray(p.framedWindows)
      ? (p.framedWindows as Record<string, unknown>[])
          .filter(
            (w) =>
              typeof w?.azimuthDeg === 'number' &&
              typeof w?.sillMm === 'number' &&
              (w.sillMm as number) > 0 &&
              typeof w?.widthMm === 'number' &&
              (w.widthMm as number) > 0 &&
              typeof w?.heightMm === 'number' &&
              (w.heightMm as number) > 0,
          )
          .map((w) => ({
            azimuthDeg: w.azimuthDeg as number,
            sillMm: w.sillMm as number,
            widthMm: w.widthMm as number,
            heightMm: w.heightMm as number,
            depthMm: typeof w.depthMm === 'number' ? w.depthMm : 0,
            marginMm: typeof w.marginMm === 'number' && w.marginMm > 0 ? w.marginMm : 0,
          }))
      : state.framedWindows
    // Openings last: the geometry fields above may have cleared them via the
    // model watcher; validate face ids against the restored model.
    if (p.openings && typeof p.openings === 'object') {
      const openings: OpeningAssignments = {}
      const faceCount = model.value.faces.length
      for (const [key, type] of Object.entries(p.openings as Record<string, unknown>)) {
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
    }
    state.selection = null
    state.openingTool = 'off'
    state.highlightOpening = null
  } catch {
    // A malformed save never blocks startup.
  }
}

restorePersisted()

/** Wipe the saved session and return every setting to factory defaults.
 * Field order mirrors restorePersisted (sync watchers fire on units,
 * material, and joint changes). */
function resetProject() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Best-effort.
  }
  state.units = 'imperial'
  state.mode = 'geodesic'
  state.frequency = 5
  state.fraction = '5/8'
  state.baseMode = 'natural'
  state.zomeSides = 8
  state.zomePitchDeg = 45
  state.zomeRows = 4
  state.materialId = 'lumber-2x4'
  state.jointId = 'timber-plate'
  state.diameterMm = 26 * MM_PER_FOOT
  state.endOffsetMm = 1.5 * MM_PER_INCH
  state.kerfMm = (1 / 8) * MM_PER_INCH
  state.increment = 1 / 8
  state.disabledStock = {}
  state.viewMode = 'assembly'
  state.explode = 0.35
  state.trueSize = false
  state.openings = {}
  state.doors = []
  state.framedWindows = []
  state.closeDoorways = true
  state.riserHeightMm = 0
  state.panelPlacement = 'outside'
  state.openingTool = 'off'
  state.prices = {}
  state.currency = '$'
  state.highlightOpening = null
  state.selection = null
  state.optimizer.min = 20
  state.optimizer.max = 30
  state.optimizer.result = null
  state.viewResetToken++
}

watch(
  () => JSON.stringify(persistedSlice()),
  (json) => {
    try {
      localStorage.setItem(STORAGE_KEY, json)
    } catch {
      // Storage full/unavailable — persistence is best-effort.
    }
  },
)

export function useDomeProject() {
  return {
    state,
    model,
    radius,
    workingDiameter,
    diameter,
    endOffset,
    workingEndOffset,
    kerf,
    material,
    jointMethod,
    strutSectionWorking,
    availableStock,
    activeStock,
    cutList,
    packing,
    assemblyPlan,
    riser,
    riserHeight,
    workingRiserHeight,
    bom,
    costEstimate,
    setPrice,
    resetPrices,
    openingGroups,
    doorway,
    doorSpecs,
    windowSpecs,
    doorInfos,
    windowInfos,
    panelPlan,
    paintFace,
    addDoorAt,
    removeDoor,
    addWindowAt,
    removeWindow,
    optimizeDoorPosition,
    optimizeWindowPosition,
    removeOpeningGroup,
    clearOpenings,
    increments,
    summary,
    runOptimizer,
    applyOptimizedDiameter,
    resetProject,
    exporters,
    loadProjectFile,
    titleOf,
  }
}
