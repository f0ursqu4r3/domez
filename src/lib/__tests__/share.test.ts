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

  it('accepts out-of-range numeric fields at the codec layer — the codec only checks shape; clamping untrusted values (frequency, diameter, etc.) is the composable\'s job at apply time', async () => {
    const wild = { ...SETTINGS, frequency: 200 } as unknown as ProjectSettings
    const payload = await encodeShare(wild)
    const back = await decodeShare(payload)
    expect(back).not.toBeNull()
    expect(back?.frequency).toBe(200)
  })

  it('rejects a payload that inflates past the 256 KiB cap (deflate-bomb guard)', async () => {
    const bomb = { ...SETTINGS, notes: 'x'.repeat(300_000) } as unknown as ProjectSettings
    const payload = await encodeShare(bomb)
    expect(await decodeShare(payload)).toBeNull()
  })
})
