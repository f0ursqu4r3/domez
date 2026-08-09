import { reactive, watch } from 'vue'

const UI_KEY = 'domez:ui'

/** UI-only preferences — deliberately outside ProjectSettings/JSON export. */
interface UiState {
  /** Collapsed section ids — sparse; absent = open. */
  collapsed: Record<string, boolean>
}

export function createUiState(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  const state = reactive<UiState>({ collapsed: {} })
  try {
    const raw = storage?.getItem(UI_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      const collapsed = (parsed as { collapsed?: unknown })?.collapsed
      if (collapsed && typeof collapsed === 'object') {
        for (const [k, v] of Object.entries(collapsed)) {
          if (v === true) state.collapsed[k] = true
        }
      }
    }
  } catch {
    // Corrupt storage — fresh all-open state.
  }
  watch(
    () => JSON.stringify(state.collapsed),
    () => {
      try {
        storage?.setItem(UI_KEY, JSON.stringify({ collapsed: state.collapsed }))
      } catch {
        // Storage full/unavailable — persistence is best-effort.
      }
    },
  )
  return {
    isOpen: (id: string) => state.collapsed[id] !== true,
    setOpen: (id: string, open: boolean) => {
      if (open) delete state.collapsed[id]
      else state.collapsed[id] = true
    },
  }
}

let singleton: ReturnType<typeof createUiState> | null = null

export function useUiState() {
  if (!singleton) {
    singleton = createUiState(typeof localStorage === 'undefined' ? null : localStorage)
  }
  return singleton
}
