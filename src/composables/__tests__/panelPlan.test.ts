import { describe, expect, it } from 'vitest'

// Node ≥ 21 exposes a localStorage global that throws unless the runtime
// was started with --localstorage-file — install a working in-memory shim
// BEFORE the composable module initializes (it reads storage at import).
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const { useDomeProject } = await import('../useDomeProject')
const { panelUnits } = await import('@/engine/panelClip')
const { panelsCsv } = await import('@/engine/exports/csv')

const MM_PER_INCH = 25.4

// `useDomeProject` is a singleton (module-scoped `state`) — every call
// returns the SAME reactive state, so each test must reset it first or it
// leaks the previous test's doors/mode/etc.
function freshProject() {
  const project = useDomeProject()
  project.resetProject()
  return project
}

// Same 3V leveled dome + arch door as panelFrames.test.ts's "clip-driven
// X-types" describe — proven to clip several real panels of the golden 3V
// dome, so this exercises the actual clip → skin-takeoff wiring end to end
// instead of a synthetic ClippedPanelType.
function domeWithArchDoor() {
  const project = freshProject()
  project.state.frequency = 3
  project.state.fraction = '1/2'
  project.state.baseMode = 'leveled'
  project.state.doors = [
    {
      azimuthDeg: 0,
      widthMm: 60 * MM_PER_INCH,
      heightMm: 90 * MM_PER_INCH,
      depthMm: 0,
      marginMm: 1.5 * MM_PER_INCH,
      shape: 'arch',
    },
  ]
  return project
}

describe('panelPlan: clipped skin panels feed the takeoff', () => {
  it('a door that clips real panels produces X-labeled ClippedPanelType pieces with positive area/bbox', () => {
    const project = domeWithArchDoor()
    const clips = project.panelClips.value
    expect(clips.some((c) => c.status === 'clipped')).toBe(true)

    const plan = project.panelPlan.value
    expect(plan.clipped.length).toBeGreaterThan(0)
    for (const c of plan.clipped) {
      expect(c.label).toMatch(/^X\d+$/)
      expect(c.trueArea).toBeGreaterThan(0)
      expect(c.bboxW).toBeGreaterThan(0)
      expect(c.bboxH).toBeGreaterThan(0)
      // outline/holes translated so the bbox min sits at the origin.
      expect(Math.min(...c.outline.map((p) => p[0]))).toBeCloseTo(0, 6)
      expect(Math.min(...c.outline.map((p) => p[1]))).toBeCloseTo(0, 6)
    }
    // Labels are unique and sequential in unit order.
    expect(plan.clipped.map((c) => c.label)).toEqual(
      plan.clipped.map((_, i) => `X${i + 1}`),
    )
  })

  it('every removed/clipped unit is absent from the whole-triangle count, every whole unit is present', () => {
    const project = domeWithArchDoor()
    const clips = project.panelClips.value
    const wholeSingleFaceCount = clips.filter((c) => c.status === 'whole').length
    const plan = project.panelPlan.value
    // No rhombi/polys on a plain geodesic dome — every surviving whole unit
    // is exactly one triangle in `plan.types`.
    expect(plan.types.reduce((n, t) => n + t.count, 0)).toBe(wholeSingleFaceCount)
  })

  it('a painted opening on an otherwise-whole unit excludes it, independent of clip status', () => {
    const project = domeWithArchDoor()
    const units = panelUnits(project.model.value)
    const clips = project.panelClips.value
    const wholeIdx = clips.findIndex((c) => c.status === 'whole')
    expect(wholeIdx).toBeGreaterThanOrEqual(0)
    const faceId = units[wholeIdx].faceIds[0]

    const before = project.panelPlan.value
    const beforeCount = before.types.reduce((n, t) => n + t.count, 0)
    project.state.openings[faceId] = 'vent'
    const after = project.panelPlan.value
    const afterCount = after.types.reduce((n, t) => n + t.count, 0)
    expect(afterCount).toBe(beforeCount - 1)
    // The clip-driven clipped pieces are untouched by an unrelated paint.
    expect(after.clipped.length).toBe(before.clipped.length)
  })

  it('zome rhombi (no openings) still take the whole-rhomb path, not the base triangle path', () => {
    const project = freshProject()
    project.state.mode = 'zome'
    project.state.zomeSides = 8
    project.state.zomePitchDeg = 45
    project.state.zomeRows = 4
    const model = project.model.value
    expect(model.rhombi?.length).toBeGreaterThan(0)
    const plan = project.panelPlan.value
    expect(plan.clipped.length).toBe(0)
    expect(plan.rhombs.reduce((n, r) => n + r.count, 0)).toBe(model.rhombi!.length)
  })

  it('goldberg polygons (no openings) still take the whole-poly path, not the base triangle path', () => {
    const project = freshProject()
    project.state.mode = 'goldberg'
    project.state.frequency = 3
    project.state.fraction = 'full'
    const model = project.model.value
    expect(model.polys?.length).toBeGreaterThan(0)
    const plan = project.panelPlan.value
    expect(plan.clipped.length).toBe(0)
    expect(plan.polys.reduce((n, p) => n + p.count, 0)).toBe(model.polys!.length)
  })

  it('panelsCsv emits one row per clipped piece, with its label and bbox', () => {
    const project = domeWithArchDoor()
    const plan = project.panelPlan.value
    expect(plan.clipped.length).toBeGreaterThan(0)
    const csv = panelsCsv(plan, 'imperial')
    for (const c of plan.clipped) {
      const line = csv.split('\n').find((l) => l.startsWith(`${c.label},`))
      expect(line).toBeDefined()
      expect(line).toContain(c.bboxW.toFixed(2))
      expect(line).toContain(c.bboxH.toFixed(2))
    }
  })
})
