import { isTauri, readVodEvents, createManualClip } from './tauri.js'
import { computeHighlights, highlightId, highlightLabel } from './highlights.js'

export const HL_STORE_KEY = 'rh-hl-store'

export function hlAutoEnabled() {
  try {
    const s = JSON.parse(localStorage.getItem('rh-vod-settings') || '{}')
    return s.autoHighlights !== false
  } catch { return true }
}

export function loadHlStore() {
  try { return JSON.parse(localStorage.getItem(HL_STORE_KEY) || '{}') } catch { return {} }
}

export function saveHlStore(store) {
  try { localStorage.setItem(HL_STORE_KEY, JSON.stringify(store)) } catch {}
}

/* Cut a single highlight into its own mp4 clip (+ thumbnail) and persist it in
   the store. Used by the game-end pre-cut and the on-demand fallbacks. Returns
   the updated store entry (with clipPath), or null when no clip could be made. */
export async function buildHighlightClip(storeEntry, vod, lang) {
  if (!storeEntry || !storeEntry.id) return null
  const st0 = loadHlStore()
  if (st0[storeEntry.id] && st0[storeEntry.id].clipPath) return st0[storeEntry.id]
  if (!vod || !vod.videoPath || !isTauri()) return null
  const hl = storeEntry.hl || {}
  const start = Math.max(0, hl.startVideoSec || 0)
  const end = Math.min(Math.max(0, hl.endVideoSec || 0), Math.max(0, vod.duration || 0) || Math.max(0, hl.endVideoSec || 0))
  if (end - start < 1) return null
  const label = highlightLabel(lang, hl, vod.champion || '')
  const res = await createManualClip(vod.videoPath, start, end, label)
  if (res && res.path) {
    const st = loadHlStore()
    if (st[storeEntry.id]) {
      st[storeEntry.id].clipPath = res.path
      if (res.thumb) st[storeEntry.id].thumb = res.thumb
      saveHlStore(st)
      return st[storeEntry.id]
    }
  }
  return null
}

/* Detect a VOD's highlights and pre-cut each one into a standalone mp4 so they
   are ready the moment the user opens the Highlights tab (no on-demand cuts).
   Runs in the background; new clips are guarded by hlStore.clipPath. Safe to
   call right after a recording ends. */
export async function preCutVodHighlights(vod, lang) {
  if (!vod || !vod.videoPath || !isTauri()) return
  let raw = null
  try { raw = await readVodEvents(vod.videoPath) } catch {}
  if (!raw) return
  let parsed = null
  try { parsed = JSON.parse(raw) } catch {}
  if (!parsed || !Array.isArray(parsed.events)) return
  const items = computeHighlights(parsed.events || [], {
    me: parsed.me || '',
    gameTimeOffset: vod.gameTimeOffset || 0,
    vodDurationSec: vod.duration || 0,
    max: 3,
  })
  if (!items.length) return
  const store = loadHlStore()
  const pending = []
  for (const hl of items) {
    const id = highlightId(vod.id, hl)
    if (store[id] && store[id].clipPath) continue
    store[id] = {
      id,
      vodId: vod.id,
      hl,
      champion: vod.champion || '',
      championIcon: vod.championIcon || '',
      date: vod.date,
      queue: vod.queue || '',
    }
    pending.push(store[id])
  }
  if (!pending.length) return
  saveHlStore(store)
  for (const entry of pending) {
    await buildHighlightClip(entry, vod, lang)
  }
  window.dispatchEvent(new Event('rh-highlights-changed'))
}