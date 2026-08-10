import type { ProjectSettings } from '@/engine/exports/json'

/** Versioned prefix — bump to p2 if the payload format ever changes. */
const PREFIX = 'p1:'

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** deflate-bomb guard: 256 KiB is two orders of magnitude above any real
 * project. Inflation streams chunk by chunk and ABORTS past the cap, so
 * peak memory stays bounded — a bomb never fully materializes. */
const MAX_INFLATED_BYTES = 262144

async function inflateCapped(packed: Uint8Array): Promise<Uint8Array | null> {
  const stream = new Blob([packed.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
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
    const bytes = await inflateCapped(packed)
    if (bytes === null) return null
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
