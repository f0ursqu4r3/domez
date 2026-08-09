import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createUiState } from '../useUiState'

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('ui collapse state', () => {
  it('defaults open, persists collapses, restores on reload', async () => {
    const storage = memoryStorage()
    const ui = createUiState(storage)
    expect(ui.isOpen('left:geometry')).toBe(true)
    ui.setOpen('left:geometry', false)
    expect(ui.isOpen('left:geometry')).toBe(false)
    await nextTick() // persistence watcher flush
    const reloaded = createUiState(storage)
    expect(reloaded.isOpen('left:geometry')).toBe(false)
    expect(reloaded.isOpen('right:struts')).toBe(true)
  })

  it('reopen removes the key; corrupt storage falls back to all-open', async () => {
    const corrupt = memoryStorage({ 'domez:ui': 'not json{{' })
    const ui = createUiState(corrupt)
    expect(ui.isOpen('anything')).toBe(true)
    ui.setOpen('a', false)
    ui.setOpen('a', true)
    await nextTick()
    const reloaded = createUiState(corrupt)
    expect(reloaded.isOpen('a')).toBe(true)
  })

  it('survives a null storage (SSR/tests)', () => {
    const ui = createUiState(null)
    ui.setOpen('x', false)
    expect(ui.isOpen('x')).toBe(false)
  })
})
