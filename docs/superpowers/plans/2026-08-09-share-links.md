# Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend-free sharing — ProjectSettings deflate-compressed into the URL hash, with a header copy button, a Build-tab entry, and a confirm-gated apply flow on open.

**Architecture:** `src/lib/share.ts` holds pure `encodeShare`/`decodeShare` (native CompressionStream, base64url, versioned `p1:` prefix, null-on-failure). The composable adds `shareLink`/`copyShareLink` and a boot-time hash handler that reuses `loadProjectFile` (which validates the `{app:'domez', settings}` envelope via `parseProjectJson`). Two small UI touchpoints.

**Tech Stack:** Vue 3 + TypeScript, native CompressionStream/DecompressionStream (browsers + Node ≥ 18, so vitest covers it), no new dependencies.

## Global Constraints

- Hash payload format exactly `p1:<base64url>` where base64url = standard base64 with `+`→`-`, `/`→`_`, trailing `=` stripped. Compression `deflate-raw`.
- `decodeShare` returns `null` on ANY failure (prefix, base64, inflate, JSON, shape) and never throws. Shape check: plain object with `typeof diameter === 'number'` and `typeof units === 'string'`.
- Open flow: fresh visitor (no `domez-project-v1` in localStorage BEFORE restore runs) applies instantly; returning user gets `window.confirm('Load shared project? Your current project will be replaced.')`. Hash cleared via `history.replaceState(null, '', location.pathname + location.search)` in every outcome (applied / declined / invalid).
- `bun run build` and `bun run test` must pass before every commit; gate on exit codes (`cmd > /tmp/x.out 2>&1; RC=$?; …; [ $RC -eq 0 ] && git commit …`). Baseline 128 tests.

---

### Task 1: `share.ts` codec

**Files:**
- Create: `src/lib/share.ts`
- Test: `src/lib/__tests__/share.test.ts`

**Interfaces:**
- Consumes: `ProjectSettings` type from `@/engine/exports/json`.
- Produces: `encodeShare(settings: ProjectSettings): Promise<string>`, `decodeShare(payload: string): Promise<ProjectSettings | null>` — Task 2 calls both.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/share.test.ts
import { describe, expect, it } from 'vitest'
import type { ProjectSettings } from '@/engine/exports/json'
import { decodeShare, encodeShare } from '../share'

const SETTINGS: ProjectSettings = {
  frequency: 3,
  fraction: '1/2',
  baseMode: 'leveled',
  diameter: 26,
  units: 'imperial',
  material: 'lumber-2x4',
  jointMethod: 'timber-plate',
  endOffset: 1.5,
  increment: 0.125,
  kerf: 0.125,
  stock: [{ length: 96, label: '8 ft' }],
  openings: { '3': 'window', '7': 'door' },
  doors: [{ azimuthDeg: 45, widthMm: 914, heightMm: 2032 }],
  windows: [{ azimuthDeg: 120, sillMm: 900, widthMm: 610, heightMm: 914 }],
  panelPlacement: 'outside',
  riserHeightMm: 600,
  mode: 'geodesic',
  prices: { bolt: 0.75 },
  currency: '$',
  loadInputs: { snowKPa: 0.96, windKPa: 0.96, skinKgM2: 8.5 },
}

describe('share link codec', () => {
  it('round-trips a representative project', async () => {
    const payload = await encodeShare(SETTINGS)
    expect(payload.startsWith('p1:')).toBe(true)
    // URL-safe: no +, /, or = anywhere.
    expect(/^p1:[A-Za-z0-9_-]+$/.test(payload)).toBe(true)
    const back = await decodeShare(payload)
    expect(back).toEqual(SETTINGS)
  })

  it('rejects tampered, foreign, and empty payloads with null', async () => {
    const payload = await encodeShare(SETTINGS)
    const mid = Math.floor(payload.length / 2)
    const flipped =
      payload.slice(0, mid) + (payload[mid] === 'A' ? 'B' : 'A') + payload.slice(mid + 1)
    expect(await decodeShare(flipped)).toBeNull()
    expect(await decodeShare('p2:' + payload.slice(3))).toBeNull()
    expect(await decodeShare(payload.slice(3))).toBeNull()
    expect(await decodeShare('')).toBeNull()
    // Valid deflate of NON-settings JSON must also be rejected (shape check).
    const notSettings = await encodeShare({ hello: 'world' } as unknown as ProjectSettings)
    expect(await decodeShare(notSettings)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test 2>&1 | tail -8`
Expected: FAIL — cannot resolve `../share`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/share.ts
import type { ProjectSettings } from '@/engine/exports/json'

/** Versioned prefix — bump to p2 if the payload format ever changes. */
const PREFIX = 'p1:'

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/')
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
  const bin = atob(padded)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** Compress settings into a versioned URL-hash payload: `p1:<base64url>`. */
export async function encodeShare(settings: ProjectSettings): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(settings))
  const packed = await pipe(bytes, new CompressionStream('deflate-raw'))
  return PREFIX + toBase64Url(packed)
}

/** Decode a hash payload. Null on ANY failure — never throws. */
export async function decodeShare(payload: string): Promise<ProjectSettings | null> {
  try {
    if (!payload.startsWith(PREFIX)) return null
    const packed = fromBase64Url(payload.slice(PREFIX.length))
    const bytes = await pipe(packed, new DecompressionStream('deflate-raw'))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as { diameter?: unknown }).diameter !== 'number' ||
      typeof (parsed as { units?: unknown }).units !== 'string'
    ) {
      return null
    }
    return parsed as ProjectSettings
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test 2>&1 | tail -5`
Expected: PASS, 130 tests (128 + 2).

- [ ] **Step 5: Commit**

```bash
bun run test > /tmp/t.out 2>&1; RC=$?; tail -3 /tmp/t.out
[ $RC -eq 0 ] && git add src/lib/share.ts src/lib/__tests__/share.test.ts && git commit -m "feat: share-link codec — deflate + base64url, versioned, null-safe

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Composable wiring

**Files:**
- Modify: `src/composables/useDomeProject.ts`

**Interfaces:**
- Consumes: `encodeShare`, `decodeShare` (Task 1); existing `projectSettings` computed, `loadProjectFile`, `restorePersisted`, `STORAGE_KEY`.
- Produces: `shareLink(): Promise<string>` and `copyShareLink(): Promise<boolean>` exported from the composable return — Task 3's two buttons call `copyShareLink`.

- [ ] **Step 1: Add the functions** (near `loadProjectFile`):

```ts
/** Full share URL — the hash encodes the whole ProjectSettings. */
async function shareLink(): Promise<string> {
  return `${location.origin}${location.pathname}#${await encodeShare(projectSettings.value)}`
}

/** Copy the share URL; prompt() fallback when the clipboard is denied.
 * Returns true when the clipboard write succeeded. */
async function copyShareLink(): Promise<boolean> {
  const url = await shareLink()
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    window.prompt('Copy share link:', url)
    return false
  }
}
```

- [ ] **Step 2: Boot-time hash handling.** Find the module-scope `restorePersisted()` call. Immediately BEFORE it, capture the returning-user flag (the persistence watcher writes the key as soon as state mutates, so it must be read first):

```ts
const hadStoredProject =
  typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) !== null
```

Immediately AFTER the `restorePersisted()` call:

```ts
// Shared-project links: #p1:<payload> applies the encoded settings —
// instantly for fresh visitors, behind a confirm for returning users.
if (typeof window !== 'undefined' && window.location.hash.length > 1) {
  void decodeShare(window.location.hash.slice(1)).then((settings) => {
    if (settings) {
      const apply =
        !hadStoredProject ||
        window.confirm('Load shared project? Your current project will be replaced.')
      if (apply) loadProjectFile(JSON.stringify({ app: 'domez', settings }))
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  })
}
```

(`loadProjectFile` is a hoisted function declaration — callable here. The `{app:'domez', settings}` envelope is exactly what `parseProjectJson` validates.)

- [ ] **Step 3: Export** `shareLink` and `copyShareLink` from the composable's return object.

- [ ] **Step 4: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: both clean (130 tests).

- [ ] **Step 5: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/composables/useDomeProject.ts && git commit -m "feat: share-link generation + boot-time hash apply with confirm

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: UI — header button + Build-tab entry

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/panels/ExportPanel.vue`

**Interfaces:**
- Consumes: `copyShareLink` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Header button (App.vue).** Imports: add `Share2, Check` to the `@lucide/vue` import; `ref` is already imported from vue (verify; add if not — the file currently imports `computed` only). Script additions:

```ts
const copied = ref(false)
async function onShare() {
  if (await project.copyShareLink()) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}
```

Template — insert BEFORE the Reset button in the header:

```html
        <Button
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:text-foreground"
          title="Copy share link — the URL encodes the whole project"
          @click="onShare"
        >
          <Check v-if="copied" class="text-emerald-500" />
          <Share2 v-else />
        </Button>
```

- [ ] **Step 2: Build-tab entry (ExportPanel.vue).** Add `Share2` to the lucide import. In the `groups` computed, Project group, after the Project JSON item:

```ts
      {
        label: 'Copy share link',
        desc: 'URL encodes the whole project',
        icon: Share2,
        run: () => void project.copyShareLink(),
      },
```

(The component already holds `project` from `useDomeProject()`; item `run` signatures are `() => void` — the `void` wrapper keeps the async result unawaited like other handlers.)

- [ ] **Step 3: Verify build + tests**

Run: `bun run build 2>&1 | tail -3 && bun run test 2>&1 | tail -3`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
bun run build > /tmp/b.out 2>&1; RC=$?; tail -3 /tmp/b.out
[ $RC -eq 0 ] && git add src/App.vue src/components/panels/ExportPanel.vue && git commit -m "feat: share buttons — header copy-with-check + Build tab entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Live verification

**Files:** none (browser; fix-forward commits if needed).

- [ ] **Step 1:** Reload the preview. Configure a distinctive project (e.g. zome Z8, metric, a door).
- [ ] **Step 2:** Header share click → ✓ state appears; read the clipboard (or capture the URL via a hooked `navigator.clipboard.writeText` if clipboard read is blocked in the pane) and confirm it matches `#p1:[A-Za-z0-9_-]+`.
- [ ] **Step 3:** Fresh-visitor flow: clear localStorage, navigate to the captured URL → project applies with NO confirm; hash cleared from the address bar; dome matches the shared config.
- [ ] **Step 4:** Returning-user flow: with local state present, navigate to the URL again with `window.confirm` stubbed to return false → local project retained, hash cleared. Repeat with confirm stubbed true → shared project applied.
- [ ] **Step 5:** Garbage hash `#p1:zzzz` → app boots normally, hash cleared, no console errors.
- [ ] **Step 6:** Build-tab entry fires the same copy path.
- [ ] **Step 7:** Any fixes: commit gated on build+tests.
