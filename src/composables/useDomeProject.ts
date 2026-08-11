import { computed, reactive, ref, watch } from 'vue'
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
  openingPrisms,
  optimizeDoorPlacement,
  type DoorPlacementResult,
  type DoorSpec,
} from '@/engine/doorway'
import { planPanels } from '@/engine/panels'
import { buildPanelFrames } from '@/engine/panelFrames'
import { clipPanels } from '@/engine/panelClip'
import { buildRiser } from '@/engine/riser'
import { buildBom, estimateCost } from '@/engine/bom'
import { generateZome } from '@/engine/zome'
import { generateGoldberg } from '@/engine/goldberg'
import { diameterToWorking, IMPERIAL_INCREMENTS, METRIC_INCREMENTS } from '@/engine/units'
import type { Fraction, Frequency, UnitSystem } from '@/engine/types'
import {
  cutListCsv,
  hubsCsv,
  boardsCsv,
  openingsCsv,
  panelsCsv,
  miterCsv,
  costsCsv,
  loadsCsv as loadsCsvText,
  framesCsv as framesCsvText,
} from '@/engine/exports/csv'
import { analyzeLoads, type StructureProps } from '@/engine/loads'
import { cutTemplatesSvg, boardDiagramsSvg } from '@/engine/exports/templates'
import { assemblyGuideSvg } from '@/engine/exports/guide'
import { panelPatternsSvg } from '@/engine/exports/patterns'
import { frameJigsSvg } from '@/engine/exports/frames'
import { planSvg } from '@/engine/exports/plan'
import { domeObj } from '@/engine/exports/obj'
import { fabricationSvg, hubLabelsSvg } from '@/engine/exports/svg'
import { fabricationDxf } from '@/engine/exports/dxf'
import { projectJson, parseProjectJson, type ProjectSettings } from '@/engine/exports/json'
import { encodeShare, decodeShare } from '@/lib/share'

export type ViewMode = 'assembly' | 'frame' | 'surface' | 'exploded' | 'loads' | 'plan'
export type Selection = { kind: 'strut'; edgeId: number } | { kind: 'hub'; vertexId: number } | null

/** Real cross-section of the strut stock, canonical mm. */
export type StrutSection =
  { kind: 'rect'; widthMm: number; depthMm: number } | { kind: 'round'; odMm: number }

export interface MaterialDef {
  id: string
  label: string
  profile: string
  section: StrutSection
  structure: StructureProps
  stock: { imperial: StockLength[]; metric: StockLength[] }
  defaultJoint: JointMethodId
}

export const MATERIALS: MaterialDef[] = [
  {
    id: 'lumber-2x4',
    label: 'Douglas Fir 2×4',
    profile: '1.5″ × 3.5″ (38 × 89 mm)',
    section: { kind: 'rect', widthMm: 38, depthMm: 89 },
    structure: { eMPa: 11000, densityKgM3: 500, sigmaTMPa: 5, sigmaCMPa: 7 },
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
    structure: { eMPa: 11000, densityKgM3: 500, sigmaTMPa: 5, sigmaCMPa: 7 },
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
    structure: { eMPa: 200000, densityKgM3: 7850, sigmaTMPa: 150, sigmaCMPa: 150, wallMm: 1.07 },
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
    structure: { eMPa: 2800, densityKgM3: 1400, sigmaTMPa: 10, sigmaCMPa: 10, wallMm: 3.38 },
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
    structure: { eMPa: 200000, densityKgM3: 7850, sigmaTMPa: 150, sigmaCMPa: 150, wallMm: 1.5 },
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
   * fields, so switching modes round-trips losslessly. Goldberg (hex/pent
   * dual) reuses the geodesic frequency/fraction fields. */
  mode: 'geodesic' | 'zome' | 'goldberg'
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
  /** Show the billboard scale figure beside the dome. */
  showFigure: boolean
  /** Panel opening assignments: faceId -> window | vent (doors are parametric). */
  openings: OpeningAssignments
  /** Parametric doorways: position + physical size, canonical mm. Doors
   * survive frequency/diameter changes — only their fit is revalidated.
   * depthMm is signed (negative pushes the buck toward the shell);
   * marginMm is the cut clearance band around the rough opening. */
  doors: {
    azimuthDeg: number
    widthMm: number
    heightMm: number
    depthMm: number
    marginMm: number
    shape: 'rect' | 'arch'
  }[]
  /** Parametric framed windows: doors with a sill height. Canonical mm. */
  framedWindows: {
    azimuthDeg: number
    sillMm: number
    widthMm: number
    heightMm: number
    depthMm: number
    marginMm: number
    shape: 'rect' | 'arch' | 'circle' | 'triangle'
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
  /** Structural load-case inputs for the loads analysis, SI throughout. */
  loadInputs: {
    snowKPa: number
    windKPa: number
    skinKgM2: number
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
  showFigure: true,
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
  loadInputs: { snowKPa: 0.96, windKPa: 0.96, skinKgM2: 8.5 },
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
    : state.mode === 'goldberg'
      ? generateGoldberg({
          frequency: state.frequency,
          fraction: state.fraction,
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

/** Dead + snow + wind envelope for the current dome, material, and load
 * inputs. Panels mounted on both faces double the skin dead load. */
const loadsResult = computed(() =>
  analyzeLoads(model.value, radius.value, state.units, material.value.section, material.value.structure, {
    ...state.loadInputs,
    skinFactor: state.panelPlacement === 'both' ? 2 : 1,
  }),
)

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
      jointId: state.jointId,
    },
    doorway.value,
    riser.value,
    framePlan.value,
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
    shape: d.shape,
  }))
})

/** Framed window specs in working units, labeled W1, W2, ... */
const windowSpecs = computed<DoorSpec[]>(() => {
  const c = (mm: number) => (state.units === 'imperial' ? mm / MM_PER_INCH : mm)
  return state.framedWindows.map((w, i) => ({
    id: `W${i + 1}`,
    azimuthDeg: w.azimuthDeg,
    width: c(w.widthMm),
    height: c(w.shape === 'circle' ? w.widthMm : w.heightMm),
    sillHeight: c(w.sillMm),
    extraDepth: c(w.depthMm),
    margin: c(w.marginMm),
    shape: w.shape,
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

/** Panel-vs-opening clip results: index-aligned with `panelUnits(model)`.
 * Shared by the frame takeoff and (Tasks 4–5) the viewer + panel plan, so
 * every consumer sees the same clipped geometry for the current portals. */
const panelClips = computed(() =>
  portalSpecs.value.length === 0
    ? []
    : clipPanels(
        model.value,
        radius.value,
        openingPrisms(model.value, portalSpecs.value, radius.value, {
          minStubLength: minStubLength.value,
          riserHeight: workingRiserHeight.value,
        }),
      ),
)

/** Framed-panel ("double wall") joint takeoff — independent per-panel jigs
 * bolted at every seam. Null unless that joint method is active. */
const framePlan = computed(() =>
  state.jointId === 'framed-panel'
    ? buildPanelFrames(model.value, radius.value, state.units, doorway.value, panelClips.value)
    : null,
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
  // Goldberg polygons: exclude fan faces, pass surviving outlines in 2D.
  const polyOutlines: [number, number][][] = []
  if (model.value.polys) {
    for (const pg of model.value.polys) {
      const dead = pg.faceIds.some((fid) => exclude.has(fid))
      pg.faceIds.forEach((fid) => exclude.add(fid))
      if (dead) continue
      const pts = pg.vertexIds.map((vi) => model.value.vertices[vi].position)
      // Newell normal + tangent basis -> flatten to 2D, working units.
      let nx = 0
      let ny = 0
      let nz = 0
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        const q = pts[(i + 1) % pts.length]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
      }
      const nl = Math.hypot(nx, ny, nz) || 1
      const n: [number, number, number] = [nx / nl, ny / nl, nz / nl]
      const ref: [number, number, number] = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
      const e1x = n[1] * ref[2] - n[2] * ref[1]
      const e1y = n[2] * ref[0] - n[0] * ref[2]
      const e1z = n[0] * ref[1] - n[1] * ref[0]
      const e1l = Math.hypot(e1x, e1y, e1z) || 1
      const e1: [number, number, number] = [e1x / e1l, e1y / e1l, e1z / e1l]
      const e2: [number, number, number] = [
        n[1] * e1[2] - n[2] * e1[1],
        n[2] * e1[0] - n[0] * e1[2],
        n[0] * e1[1] - n[1] * e1[0],
      ]
      polyOutlines.push(
        pts.map(
          (p) =>
            [
              (p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2]) * radius.value,
              (p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]) * radius.value,
            ] as [number, number],
        ),
      )
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
    polyOutlines,
  })
})

/** Paint/erase a panel with the active opening tool (viewer click handler).
 * Doors and framed windows are parametric — only vents (and erase) paint. */
function paintFace(faceId: number) {
  if (state.openingTool === 'off' || state.openingTool === 'door' || state.openingTool === 'window')
    return
  // Zome rhombi / goldberg polygons paint as one unit.
  const group =
    model.value.polys?.find((r) => r.faceIds.includes(faceId)) ??
    model.value.rhombi?.find((r) => r.faceIds.includes(faceId))
  const targets = group ? group.faceIds : [faceId]
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
    shape: 'rect',
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
    shape: 'rect',
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
    // Candidate scoring re-cuts the doorway per bearing — without the riser
    // height every candidate is scored against a riser-less dome.
    riserHeight: workingRiserHeight.value,
  })
  state.doors[index].azimuthDeg = result.azimuthDeg
  return result
}

function optimizeWindowPosition(index: number): DoorPlacementResult | null {
  const spec = windowSpecs.value[index]
  if (!spec) return null
  const toMm = (v: number) => (state.units === 'imperial' ? v * MM_PER_INCH : v)
  const result = optimizeDoorPlacement(model.value, spec, radius.value, {
    minStubLength: minStubLength.value,
    increment: state.increment,
    otherDoors: portalSpecs.value.filter((s) => s.id !== spec.id),
    sillSearchHalfWidth: state.units === 'imperial' ? 12 : 300,
    // The sill-axis floor is max(riserHeight + margin + eps, ...) — omitting
    // this lets the search return a sill inside the riser band.
    riserHeight: workingRiserHeight.value,
  })
  state.framedWindows[index].azimuthDeg = result.azimuthDeg
  if (typeof result.sillHeight === 'number') state.framedWindows[index].sillMm = toMm(result.sillHeight)
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
  buildBom(model.value, doorway.value, riser.value, state.jointId, panelPlan.value, framePlan.value),
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
      jointId: state.jointId,
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
      : `${state.mode === 'goldberg' ? 'hex' : ''}${state.frequency}v-${state.fraction.replace('/', '')}`
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
  loadInputs: { ...state.loadInputs },
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
  framesCsv: () => {
    const plan = framePlan.value
    if (!plan) return
    download(`${fileStem.value}-frames.csv`, framesCsvText(plan, state.units), 'text/csv')
  },
  frameJigs: () => {
    const plan = framePlan.value
    if (!plan) return
    download(
      `${fileStem.value}-panel-jigs.svg`,
      frameJigsSvg(plan, state.units, titleOf()),
      'image/svg+xml',
    )
  },
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
  loadsCsv: () => {
    const r = loadsResult.value
    if (!r.ok) return
    download(
      `${fileStem.value}-loads.csv`,
      loadsCsvText(model.value, r, radius.value, state.units),
      'text/csv',
    )
  },
  assemblyGuide: () =>
    download(
      `${fileStem.value}-assembly-guide.svg`,
      assemblyGuideSvg(model.value, assemblyPlan.value, cutList.value, {
        units: state.units,
        radius: radius.value,
        title: titleOf(),
        framedPanel: state.jointId === 'framed-panel',
      }),
      'image/svg+xml',
    ),
  panelPatterns: () =>
    download(
      `${fileStem.value}-panel-patterns.svg`,
      panelPatternsSvg(panelPlan.value, { units: state.units, title: titleOf() }),
      'image/svg+xml',
    ),
  floorPlan: () =>
    download(
      `${fileStem.value}-floor-plan.svg`,
      planSvg(model.value, doorway.value, {
        units: state.units,
        radius: radius.value,
        riserHeight: workingRiserHeight.value,
        wallThickness:
          strutSectionWorking.value.kind === 'rect'
            ? strutSectionWorking.value.depth
            : strutSectionWorking.value.diameter,
        title: titleOf(),
      }),
      'image/svg+xml',
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
      : `${state.mode === 'goldberg' ? '⬡' : ''}${state.frequency}V ${state.fraction}`
  return `DOMEZ ${family} · ⌀ ${diameter.value} ${state.units === 'imperial' ? 'ft' : 'm'}`
}

function loadProjectFile(text: string): boolean {
  const settings = parseProjectJson(text)
  if (!settings) return false
  // Both import paths (file + share link) land here — settings may be
  // attacker-controlled (a crafted share URL), so the dangerous numeric
  // and identity fields are whitelisted exactly like restorePersisted,
  // leaving the current value in place on anything out of range.
  if (settings.units === 'imperial' || settings.units === 'metric') state.units = settings.units
  if (
    Number.isInteger(settings.frequency) &&
    settings.frequency >= 1 &&
    settings.frequency <= 6
  )
    state.frequency = settings.frequency as Frequency
  if (['3/8', '1/2', '5/8'].includes(settings.fraction as string))
    state.fraction = settings.fraction as Fraction
  state.baseMode = (settings.baseMode as 'natural' | 'leveled') ?? 'natural'
  state.mode =
    settings.mode === 'zome' ? 'zome' : settings.mode === 'goldberg' ? 'goldberg' : 'geodesic'
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
  if (MATERIALS.some((m) => m.id === settings.material)) state.materialId = settings.material
  // Sync watchers fire on units/materialId/jointId; set explicit values
  // after them (jointId before endOffset, or the joint-default reset would
  // clobber the loaded offset). The file stores display units; the setters
  // store canonical mm.
  if (JOINT_METHODS.some((j) => j.id === settings.jointMethod))
    state.jointId = settings.jointMethod as JointMethodId
  if (
    Number.isFinite(settings.diameter) &&
    settings.diameter > 0 &&
    settings.diameter <= 1000
  )
    diameter.value = settings.diameter
  if (Number.isFinite(settings.endOffset) && settings.endOffset >= 0)
    endOffset.value = settings.endOffset
  if (Number.isFinite(settings.kerf) && settings.kerf >= 0) kerf.value = settings.kerf
  // roundToIncrement divides by this — 0 or garbage means NaN cut lengths.
  if (
    typeof settings.increment === 'number' &&
    Number.isFinite(settings.increment) &&
    settings.increment > 0
  )
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
  const li = settings.loadInputs as Record<string, unknown> | undefined
  if (li && typeof li === 'object') {
    const num = (v: unknown, ok: (n: number) => boolean) =>
      typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : undefined
    state.loadInputs.snowKPa = num(li.snowKPa, (n) => n >= 0) ?? state.loadInputs.snowKPa
    state.loadInputs.windKPa = num(li.windKPa, (n) => n >= 0) ?? state.loadInputs.windKPa
    state.loadInputs.skinKgM2 = num(li.skinKgM2, (n) => n >= 0) ?? state.loadInputs.skinKgM2
  }
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
  state.doors = (Array.isArray(settings.doors) ? settings.doors : [])
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
      shape: d.shape === 'arch' ? 'arch' : 'rect',
    }))
  state.framedWindows = (Array.isArray(settings.windows) ? settings.windows : [])
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
      shape:
        w.shape === 'arch' || w.shape === 'circle' || w.shape === 'triangle' ? w.shape : 'rect',
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

/** Full share URL — the hash encodes the whole ProjectSettings. */
async function shareLink(): Promise<string> {
  return `${location.origin}${location.pathname}#${await encodeShare(projectSettings.value)}`
}

/** Set when the clipboard write fails — App.vue shows a themed dialog
 * with the URL and a manual Copy button. */
const shareFallbackUrl = ref<string | null>(null)

/** Copy the share URL. Safari revokes the user-gesture activation across
 * an await, so the encode promise is handed to ClipboardItem instead of
 * being awaited before the write. Returns true when the write succeeded;
 * on failure the fallback dialog takes over. */
async function copyShareLink(): Promise<boolean> {
  const urlPromise = shareLink()
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/plain': urlPromise.then((u) => new Blob([u], { type: 'text/plain' })),
      })
      await navigator.clipboard.write([item])
    } else {
      await navigator.clipboard.writeText(await urlPromise)
    }
    return true
  } catch {
    shareFallbackUrl.value = await urlPromise
    return false
  }
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
    showFigure: state.showFigure,
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
    loadInputs: { ...state.loadInputs },
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
    if (p.mode === 'geodesic' || p.mode === 'zome' || p.mode === 'goldberg') state.mode = p.mode
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
    if (['assembly', 'frame', 'surface', 'exploded', 'loads', 'plan'].includes(p.viewMode as string)) {
      state.viewMode = p.viewMode as ViewMode
    }
    state.explode = num(p.explode, (n) => n >= 0 && n <= 1) ?? state.explode
    state.trueSize = !!p.trueSize
    state.showFigure = p.showFigure !== false
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
    const li = p.loadInputs as Record<string, unknown> | undefined
    if (li && typeof li === 'object') {
      state.loadInputs.snowKPa = num(li.snowKPa, (n) => n >= 0) ?? state.loadInputs.snowKPa
      state.loadInputs.windKPa = num(li.windKPa, (n) => n >= 0) ?? state.loadInputs.windKPa
      state.loadInputs.skinKgM2 = num(li.skinKgM2, (n) => n >= 0) ?? state.loadInputs.skinKgM2
    }
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
            shape: d.shape === 'arch' ? ('arch' as const) : ('rect' as const),
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
            shape:
              w.shape === 'arch' || w.shape === 'circle' || w.shape === 'triangle'
                ? (w.shape as 'arch' | 'circle' | 'triangle')
                : ('rect' as const),
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

const hadStoredProject =
  typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) !== null

restorePersisted()

/** A decoded share-link payload awaiting the returning-user's decision
 * (shown as a dialog by App.vue). Null when there is nothing pending. */
const pendingShare = ref<ProjectSettings | null>(null)

/** Resolve a pending share-link prompt: apply the settings when accepted,
 * discard them either way. Called by the dialog's two actions. */
function applyPendingShare(accept: boolean) {
  if (accept && pendingShare.value) {
    loadProjectFile(JSON.stringify({ app: 'domez', settings: pendingShare.value }))
  }
  pendingShare.value = null
}

// Shared-project links: #p1:<payload> applies the encoded settings —
// instantly for fresh visitors, or queued behind a dialog (pendingShare)
// for returning users. The hash is single-use — its settings live in
// pendingShare/loadProjectFile from here on — so it is cleared as soon as
// decode resolves, in a finally covering every outcome (applied, queued,
// invalid, or a throw partway through apply).
if (typeof window !== 'undefined' && window.location.hash.length > 1) {
  void decodeShare(window.location.hash.slice(1)).then((settings) => {
    try {
      if (settings) {
        if (!hadStoredProject) {
          loadProjectFile(JSON.stringify({ app: 'domez', settings }))
        } else {
          pendingShare.value = settings
        }
      }
    } finally {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  })
}

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
  state.showFigure = true
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
  state.loadInputs.snowKPa = 0.96
  state.loadInputs.windKPa = 0.96
  state.loadInputs.skinKgM2 = 8.5
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
    framePlan,
    panelClips,
    bom,
    costEstimate,
    loadsResult,
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
    shareLink,
    copyShareLink,
    shareFallbackUrl,
    pendingShare,
    applyPendingShare,
    titleOf,
  }
}
