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

const VALID = {
  app: 'domez',
  settings: {
    frequency: 3,
    fraction: '1/2',
    baseMode: 'natural',
    diameter: 20,
    units: 'imperial',
    material: 'lumber-2x4',
    jointMethod: 'timber-plate',
    endOffset: 0,
    increment: 0.125,
    kerf: 0.125,
    stock: [],
  },
}

describe('loadProjectFile input clamps', () => {
  const project = useDomeProject()

  it('ignores zero/garbage increment instead of poisoning cut lengths', () => {
    expect(project.loadProjectFile(JSON.stringify(VALID))).toBe(true)
    expect(project.state.increment).toBe(0.125)

    for (const bad of [0, -1, Number.NaN, 'x', null, undefined]) {
      const payload = structuredClone(VALID) as { settings: Record<string, unknown> }
      payload.settings.increment = bad
      expect(project.loadProjectFile(JSON.stringify(payload))).toBe(true)
      expect(project.state.increment).toBe(0.125)
    }
    // The downstream symptom the clamp prevents: NaN in the cut list.
    expect(
      project.cutList.value.rows.every((r) => Number.isFinite(r.roundedCutLength)),
    ).toBe(true)
  })
})
