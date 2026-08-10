# Share Links — Design Spec

**Date:** 2026-08-09
**Status:** Approved for planning

## Summary

Backend-free project sharing: the full `ProjectSettings` object compressed
into the URL hash. A header share button (and a Build-tab entry) copies
the link; opening a link applies the shared project — instantly for fresh
visitors, behind a confirm for returning users — then clears the hash.

## Decisions (from brainstorming)

1. Share button in the header (next to Reset, with a ✓ copied state) AND
   in the Build tab's Project group.
2. Open flow: fresh visitor (no `domez-project-v1` in localStorage)
   applies instantly; returning user gets
   ~~`window.confirm('Load shared project? Your current project will be replaced.')`~~.
   **Amended:** Reversed at user request post-review: a shadcn Dialog
   (Load shared project? / Keep my project) replaces the native confirm;
   hash cleared immediately at decode time.
3. Hash cleared via `history.replaceState` after apply AND after decline.
   **Amended:** Reversed at user request post-review: a shadcn Dialog
   (Load shared project? / Keep my project) replaces the native confirm;
   hash cleared immediately at decode time.

## Encoding: `src/lib/share.ts`

```ts
/** Compress settings into a versioned URL-hash payload: `p1:<base64url>`. */
export async function encodeShare(settings: ProjectSettings): Promise<string>
/** Decode a hash payload. Null on ANY failure — never throws. */
export async function decodeShare(payload: string): Promise<ProjectSettings | null>
```

- Pipeline: `JSON.stringify` → `CompressionStream('deflate-raw')` →
  base64url (standard base64 with `+/` → `-_`, `=` padding stripped).
  Decode reverses with `DecompressionStream('deflate-raw')`.
- Prefix `p1:` versions the format. `decodeShare` returns null for a
  missing/unknown prefix, base64 errors, inflate errors, JSON errors, or
  a payload that fails the shape check: parsed value must be a plain
  object with `typeof parsed.diameter === 'number'` and
  `typeof parsed.units === 'string'`.
- Native `CompressionStream`/`DecompressionStream` only — no new
  dependency. These exist in all modern browsers and Node ≥ 18 (vitest
  can test the round trip directly).

## Composable wiring: `useDomeProject.ts`

- `shareLink(): Promise<string>` — returns
  `location.origin + location.pathname + '#' + await encodeShare(projectSettings.value)`.
- Init-time hash handling (runs once during composable setup, after
  `restorePersisted`): if `location.hash.length > 1`, attempt
  `decodeShare(location.hash.slice(1))` asynchronously; on valid
  settings:
  - fresh visitor (no `localStorage['domez-project-v1']` at the moment
    the app booted) → apply immediately;
  - ~~returning user → `window.confirm(...)`; apply only on OK.~~
    **Amended:** Reversed at user request post-review: a shadcn Dialog
    (Load shared project? / Keep my project) replaces the native confirm;
    the decoded settings are held in a `pendingShare` ref (not the hash —
    that is cleared immediately, see below) and the dialog's two actions
    call `applyPendingShare(accept)`, which applies-and-clears or just
    clears.
  - Apply path reuses the existing `loadProjectFile` restore logic (wrap
    the settings in whatever envelope `loadProjectFile` validates, or
    call the shared internal restore directly — implementer picks after
    reading `loadProjectFile`; behavior must equal loading the same
    settings as a project file).
  - ~~In every outcome (applied, declined, invalid) the hash is cleared:~~
    **Amended:** the hash is cleared immediately once decode resolves —
    not deferred to the dialog decision — since the settings are kept in
    memory (`pendingShare`) from that point on and the hash is never
    needed again. Wrapped in try/finally so a throw during apply still
    clears it:
    `history.replaceState(null, '', location.pathname + location.search)`.
- Exposed from the composable: `shareLink` (the Build-tab exporter and
  header button both use it).

## UI

- **Header (App.vue):** a ghost icon button (lucide `Share2`) next to the
  Reset button. Click → `await shareLink()` →
  `navigator.clipboard.writeText(url)`; on success the icon becomes
  lucide `Check` for 1.5 s (local ref + setTimeout), then reverts. If the
  clipboard write throws, fall back to `window.prompt('Copy share link:', url)`.
  Title: "Copy share link — the URL encodes the whole project".
- **Build tab (ExportPanel.vue):** in the Project group after Project
  JSON: label "Copy share link", desc "URL encodes the whole project",
  icon `Share2`, runs the same copy-with-fallback action (a small shared
  handler in the composable or duplicated 5-liner in each component —
  implementer's call; prefer a composable `copyShareLink(): Promise<boolean>`
  returning clipboard success so both buttons share it).

## Testing

- vitest (`src/lib/__tests__/share.test.ts`): round-trip — a
  representative ProjectSettings (with doors, openings map, prices,
  loadInputs) encodes then decodes deep-equal; tampered payload (flip a
  middle character) → null; wrong prefix (`p2:...`, no prefix) → null;
  empty string → null.
- Live: copy from header (✓ state appears); open the link in a fresh
  tab-context (cleared localStorage) → project applies with no prompt,
  hash cleared; open with existing local project → confirm shown, OK
  applies / Cancel keeps local, hash cleared both ways; garbage hash
  (`#p1:zzzz`) → ignored, app boots normally.

## Out of scope

- Backend/shortened URLs, share analytics, read-only viewer mode,
  encoding derived data (cut lists etc. — recipients recompute).
