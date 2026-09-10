import { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '../i18n.js'
import { isTauri, showInFolder, getAudioMode, vodThumbUrl, getDiskUsage, readVodEvents } from '../tauri.js'
import { deleteRecordingBlob } from '../video-recorder.js'
import { deleteVodFiles, exportHighlightCopy, createManualClip, localFileSrc, shareClip, renameClipFile, readShareLog } from '../tauri.js'
import { computeHighlights, highlightId, highlightLabel } from '../highlights.js'
import { warmShareServer } from '../api.js'

const VOD_STORAGE_KEY = 'rh-vods'
const VOD_SETTINGS_KEY = 'rh-vod-settings'
const CLIPS_STORAGE_KEY = 'rh-clips'
const FAV_STORAGE_KEY = 'rh-vod-favorites'
const HL_FAV_KEY = 'rh-hl-favorites'
const HL_HIDDEN_KEY = 'rh-hl-hidden'
const HL_STORE_KEY = 'rh-hl-store'

const ROLE_GLYPHS = {
  TOP: (
    <>
      <path opacity="0.5" fill="#785a28" fillRule="evenodd" d="M21,14H14v7h7V14Zm5-3V26L11.014,26l-4,4H30V7.016Z" />
      <polygon fill="#c8aa6e" points="4 4 4.003 28.045 9 23 9 9 23 9 28.045 4.003 4 4" />
    </>
  ),
  JUNGLE: (
    <path fill="#c8aa6e" fillRule="evenodd" d="M25,3c-2.128,3.3-5.147,6.851-6.966,11.469A42.373,42.373,0,0,1,20,20a27.7,27.7,0,0,1,1-3C21,12.023,22.856,8.277,25,3ZM13,20c-1.488-4.487-4.76-6.966-9-9,3.868,3.136,4.422,7.52,5,12l3.743,3.312C14.215,27.917,16.527,30.451,17,31c4.555-9.445-3.366-20.8-8-28C11.67,9.573,13.717,13.342,13,20Zm8,5a15.271,15.271,0,0,1,0,2l4-4c0.578-4.48,1.132-8.864,5-12C24.712,13.537,22.134,18.854,21,25Z" />
  ),
  MID: (
    <>
      <path opacity="0.5" fill="#785a28" fillRule="evenodd" d="M30,12.968l-4.008,4L26,26H17l-4,4H30ZM16.979,8L21,4H4V20.977L8,17,8,8h8.981Z" />
      <polygon fill="#c8aa6e" points="25 4 4 25 4 30 9 30 30 9 30 4 25 4" />
    </>
  ),
  BOT: (
    <>
      <path opacity="0.5" fill="#785a28" fillRule="evenodd" d="M13,20h7V13H13v7ZM4,4V26.984l3.955-4L8,8,22.986,8l4-4H4Z" />
      <polygon fill="#c8aa6e" points="29.997 5.955 25 11 25 25 11 25 5.955 29.997 30 30 29.997 5.955" />
    </>
  ),
  SUPPORT: (
    <path fill="#c8aa6e" fillRule="evenodd" d="M26,13c3.535,0,8-4,8-4H23l-3,3,2,7,5-2-3-4h2ZM22,5L20.827,3H13.062L12,5l5,6Zm-5,9-1-1L13,28l4,3,4-3L18,13ZM11,9H0s4.465,4,8,4h2L7,17l5,2,2-7Z" />
  ),
}

function RoleIcon({ role }) {
  const key = String(role || '').toUpperCase()
  const norm = key === 'TOP' ? 'TOP'
    : key === 'JUNGLE' ? 'JUNGLE'
    : (key === 'MID' || key === 'MIDDLE') ? 'MID'
    : (key === 'BOT' || key === 'BOTTOM' || key === 'ADC') ? 'BOT'
    : 'SUPPORT'
  return (
    <svg className="rt-role-icon" width="16" height="16" viewBox="0 0 34 34" aria-hidden="true">
      {ROLE_GLYPHS[norm]}
    </svg>
  )
}

function loadVods() {
  try {
    return JSON.parse(localStorage.getItem(VOD_STORAGE_KEY) || '[]')
  } catch { return [] }
}

function saveVods(vods) {
  localStorage.setItem(VOD_STORAGE_KEY, JSON.stringify(vods))
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(VOD_SETTINGS_KEY) || '{}')
  } catch { return {} }
}

function saveSettings(s) {
  localStorage.setItem(VOD_SETTINGS_KEY, JSON.stringify(s))
}

function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) || '[]'))
  } catch { return new Set() }
}

function saveFavorites(favs) {
  localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...favs]))
}

function loadHlFav() {
  try { return new Set(JSON.parse(localStorage.getItem(HL_FAV_KEY) || '[]')) } catch { return new Set() }
}

function loadHlHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(HL_HIDDEN_KEY) || '[]')) } catch { return new Set() }
}

/* Persisted highlight cards. Highlights are snapshotted into this store so they
   survive even after their source VOD is deleted. Keyed by `vodId::firstSec`. */
function loadHlStore() {
  try { return JSON.parse(localStorage.getItem(HL_STORE_KEY) || '{}') } catch { return {} }
}

function saveHlStore(store) {
  try { localStorage.setItem(HL_STORE_KEY, JSON.stringify(store)) } catch {}
}

/* Convert the persisted highlight store into renderable cards. A card survives
   VOD deletion; if the source VOD no longer exists we render it without video. */
function buildHlCards(store, vods, hlHidden, lang) {
  const vodMap = new Map(vods.map(v => [v.id, v]))
  return Object.keys(store)
    .filter(id => !hlHidden.has(id))
    .map(id => {
      const e = store[id]
      const vod = vodMap.get(e.vodId)
      const hasClip = !!e.clipPath
      const vodPath = hasClip ? e.clipPath : (vod && vod.videoPath)
      const hasVideo = hasClip || !!(vod && vod.hasVideo && vod.videoPath)
      const hl = hasClip ? { ...e.hl, startVideoSec: 0 } : e.hl
      return {
        key: hasClip ? `${id}::clip` : id,
        id,
        hl,
        label: (e.name && e.name.trim()) || highlightLabel(lang, e.hl, e.champion || ''),
        hasVideo,
        thumbPath: e.thumb || '',
        shareUrl: e.shareUrl || '',
        videoUrl: e.videoUrl || '',
        vod: {
          id: hasClip ? `${e.vodId}::clip` : e.vodId,
          champion: e.champion,
          championIcon: e.championIcon,
          date: e.date,
          queue: e.queue,
          hasVideo,
          videoPath: vodPath,
          duration: (vod && vod.duration) || 0,
        },
      }
    })
    .sort((a, b) => (b.vod.date || 0) - (a.vod.date || 0))
}

function formatDuration(sec) {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  const s2 = Math.floor(sec % 60)
  return `${m}:${s2.toString().padStart(2, '0')}`
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function relTime(lang, ts) {
  if (!ts) return ''
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 90) return t(lang, 'relNow')
  const m = s / 60
  if (m < 60) return t(lang, 'relMinAgo').replace('{n}', Math.floor(m))
  const h = m / 60
  if (h < 24) return t(lang, 'relHourAgo').replace('{n}', Math.floor(h))
  const d = h / 24
  return t(lang, 'relDayAgo').replace('{n}', Math.floor(d))
}

/* Thumbnail extracted from the recording a few seconds in (generated
   natively while the video is being written); falls back to placeholder. */
function VodThumb({ vod }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let dead = false
    setSrc(null)
    if (!vod.videoPath || !isTauri()) return undefined
    vodThumbUrl(vod.videoPath)
      .then((u) => { if (!dead && u) setSrc(u) })
      .catch(() => {})
    /* Retry shortly after: the thumb may still be being extracted */
    const retry = setTimeout(() => {
      vodThumbUrl(vod.videoPath)
        .then((u) => { if (!dead && u) setSrc(u) })
        .catch(() => {})
    }, 6000)
    return () => { dead = true; clearTimeout(retry) }
  }, [vod.id, vod.videoPath])
  if (!src) return <div className="rt-card-thumb-placeholder" />
  return <img src={src} alt="" />
}

export { loadVods, saveVods, loadSettings, saveSettings, VOD_STORAGE_KEY, VOD_SETTINGS_KEY }

export default function RiftTimeline({ lang, onOpenVod, profile, subTab, onSubTabChange, onDelete, onSeekTo, onOpenHighlight }) {
  const [vods, setVods] = useState(loadVods)
  const [clips, setClips] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) || '[]') } catch { return [] }
  })
  const [favorites, setFavorites] = useState(loadFavorites)
  const [hlFav, setHlFav] = useState(loadHlFav)
  const [hlHidden, setHlHidden] = useState(loadHlHidden)
  const [highlights, setHighlights] = useState([])
  const [hlStore, setHlStore] = useState(loadHlStore)
  const [hlBump, setHlBump] = useState(0)
  const [sharingId, setSharingId] = useState(null)
  const [shareModal, setShareModal] = useState(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
  const [filterQueue, setFilterQueue] = useState('all')
  const [filterRole, setFilterRole] = useState('all')
  const [filterResult, setFilterResult] = useState('all')
  const [filterChamp, setFilterChamp] = useState('all')
  const [filterFav, setFilterFav] = useState('all')
  const [openDropdown, setOpenDropdown] = useState(null)
  const [diskUsage, setDiskUsage] = useState(null)
  const [settings, setSettings] = useState(() => {
    const s = loadSettings()
    return {
      autoRecord: s.autoRecord ?? true,
      closeToTray: s.closeToTray ?? true,
      autoStart: s.autoStart ?? false,
      autoHighlights: s.autoHighlights ?? true,
      vodPath: s.vodPath ?? '',
      audioMode: s.audioMode ?? 'game',
      ...s,
    }
  })
  const autoCutRunning = useRef(false)
  /* Highlights currently being cut (worker + the on-open fallback). Prevents
     two concurrent Media Foundation transcodes of the SAME highlight, which
     double the decode work and made cards sit on "cargando" for minutes. */
  const inflightCuts = useRef(new Set())
  const [renameModal, setRenameModal] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [renaming, setRenaming] = useState(false)

  useEffect(() => { saveSettings(settings) }, [settings])

  useEffect(() => {
    if (!isTauri()) return
    getDiskUsage().then(setDiskUsage).catch(() => {})
    const interval = setInterval(() => {
      getDiskUsage().then(setDiskUsage).catch(() => {})
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  /* Rust config is the source of truth for the recording audio mode */
  useEffect(() => {
    if (!isTauri()) return
    getAudioMode().then((mode) => {
      if (mode) setSettings(s => ({ ...s, audioMode: mode }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const reloadSettings = () => {
      const s = loadSettings()
      setSettings({
        autoRecord: s.autoRecord ?? true,
        closeToTray: s.closeToTray ?? true,
        autoStart: s.autoStart ?? false,
        autoHighlights: s.autoHighlights ?? true,
        vodPath: s.vodPath ?? '',
        audioMode: s.audioMode ?? 'game',
        ...s,
      })
    }
    const onStorage = (e) => {
      if (e.key === VOD_STORAGE_KEY) setVods(loadVods())
      if (e.key === CLIPS_STORAGE_KEY) {
        try { setClips(JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) || '[]')) } catch { setClips([]) }
      }
      if (e.key === VOD_SETTINGS_KEY) reloadSettings()
    }
    window.addEventListener('storage', onStorage)
    const onCustom = () => setVods(loadVods())
    const onSettingsCustom = () => reloadSettings()
    const onClipsCustom = () => {
      try { setClips(JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) || '[]')) } catch { setClips([]) }
    }
    const onHlCustom = () => setHlBump(b => b + 1)
    window.addEventListener('rh-vods-changed', onCustom)
    window.addEventListener('rh-settings-changed', onSettingsCustom)
    window.addEventListener('rh-clips-changed', onClipsCustom)
    window.addEventListener('rh-highlights-changed', onHlCustom)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('rh-vods-changed', onCustom)
      window.removeEventListener('rh-settings-changed', onSettingsCustom)
      window.removeEventListener('rh-clips-changed', onClipsCustom)
      window.removeEventListener('rh-highlights-changed', onHlCustom)
    }
  }, [])

  const deleteVod = useCallback((id) => {
    const target = vods.find(v => v.id === id)
    if (target && target.videoPath) {
      deleteVodFiles(target.videoPath).catch(() => {})
    }
    const filtered = vods.filter(v => v.id !== id)
    setVods(filtered)
    saveVods(filtered)
    window.dispatchEvent(new Event('rh-vods-changed'))
    deleteRecordingBlob(id).catch(() => {})
    /* Highlights that already have their own clip file (or a shared link) keep
       working after the VOD is gone. Entries that were never cut have no source
       anymore, so drop them instead of leaving dead cards behind. */
    const st = loadHlStore()
    let pruned = false
    for (const key of Object.keys(st)) {
      const e = st[key]
      if (e && e.vodId === id && !e.clipPath && !e.shareUrl) {
        delete st[key]
        pruned = true
      }
    }
    if (pruned) {
      saveHlStore(st)
      setHlStore(st)
      setHighlights(buildHlCards(st, vods, hlHidden, lang))
    }
  }, [vods, hlHidden, lang])

  const toggleFavorite = useCallback((id, e) => {
    e.stopPropagation()
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveFavorites(next)
      return next
    })
  }, [])

  const deleteClip = useCallback((clipId) => {
    const filtered = clips.filter(c => c.id !== clipId)
    setClips(filtered)
    try { localStorage.setItem(CLIPS_STORAGE_KEY, JSON.stringify(filtered)) } catch {}
  }, [clips])

  const openClipItem = useCallback((clip) => {
    const vod = vods.find(v => v.id === clip.vodId)
    if (clip.path) {
      onOpenVod({ ...vod, videoPath: clip.path })
    } else {
      onOpenVod(vod)
      if (onSeekTo) onSeekTo(clip.start)
    }
  }, [vods, onOpenVod, onSeekTo])

  const openRename = useCallback((target, kind) => {
    if (!target || !target.id) return
    const isClip = kind === 'clip' || target.kind === 'clip'
    let currentName = ''
    let path = ''
    let thumbPath = ''
    if (isClip) {
      const clip = clips.find(c => c.id === target.id)
      if (clip) { currentName = clip.name || ''; path = clip.path || ''; thumbPath = clip.thumbPath || '' }
    } else {
      const entry = loadHlStore()[target.id]
      if (entry) { currentName = entry.name || ''; path = entry.clipPath || ''; thumbPath = entry.thumb || '' }
    }
    setRenameModal({ kind: isClip ? 'clip' : 'highlight', id: target.id, path, thumbPath, currentName })
    setRenameVal((currentName && currentName.trim()) ? currentName.trim() : '')
  }, [clips])

  const doRename = useCallback(async (name) => {
    if (!renameModal) return
    const trimmed = (name || '').trim().slice(0, 30)
    if (!trimmed) return
    setRenaming(true)
    try {
      if (renameModal.kind === 'clip') {
        let newPath = renameModal.path
        if (renameModal.path) {
          const r = await renameClipFile(renameModal.path, renameModal.thumbPath, trimmed)
          if (r && r.error) return
          if (r && typeof r === 'string') newPath = r
        }
        setClips(prev => {
          const next = prev.map(c => c.id === renameModal.id ? { ...c, name: trimmed, path: newPath } : c)
          try { localStorage.setItem(CLIPS_STORAGE_KEY, JSON.stringify(next)) } catch {}
          window.dispatchEvent(new Event('rh-clips-changed'))
          return next
        })
      } else {
        const st = loadHlStore()
        const entry = st[renameModal.id]
        if (!entry) return
        let newPath = entry.clipPath
        if (entry.clipPath) {
          const r = await renameClipFile(entry.clipPath, entry.thumb, trimmed)
          if (r && r.error) return
          if (r && typeof r === 'string') newPath = r
        }
        entry.name = trimmed
        if (newPath) entry.clipPath = newPath
        saveHlStore(st)
        setHlStore(st)
        setHighlights(buildHlCards(st, vods, hlHidden, lang))
        window.dispatchEvent(new Event('rh-highlights-changed'))
      }
      setRenameModal(null)
    } finally {
      setRenaming(false)
    }
  }, [renameModal, vods, hlHidden, lang])

  /* Automatic highlights: load each recorded match's local LCD events, detect
     plays, and build cards (chronologically + favorites first). */
  useEffect(() => {
    if (subTab !== 'highlights') return
    if (!settings.autoHighlights) {
      setHighlights([])
      return
    }
    let dead = false
    /* Render instantly from whatever is already in the store so the list never
       sits on an empty/spinner state while the scan refreshes it. */
    try { setHighlights(buildHlCards(loadHlStore(), vods, hlHidden, lang)) } catch {}
    const candidates = [...vods]
      .filter(v => v.hasVideo && v.videoPath && isTauri())
      .sort((a, b) => (b.date || 0) - (a.date || 0))
      .slice(0, 60)
    Promise.all(candidates.map(async (vod) => {
      if (!vod.videoPath) return null
      try {
        const raw = await readVodEvents(vod.videoPath)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        const items = computeHighlights(parsed.events || [], {
          me: parsed.me || '',
          gameTimeOffset: vod.gameTimeOffset || 0,
          vodDurationSec: vod.duration || 0,
          max: Math.max(1, Math.min(12, Number(settings.hlMaxPerVod) || 3)),
          minKills: Math.max(0, Number(settings.hlMinKills) || 0),
          includeDied: settings.hlIncludeDied === undefined ? true : settings.hlIncludeDied !== false,
          leadSec: Math.max(0, Math.min(30, Number(settings.hlLeadSec) || 10)),
          tailSec: Math.max(0, Math.min(30, Number(settings.hlTailSec) || 3)),
        })
        if (!items.length) return null
        return {
          vod,
          items: items.map(hl => ({
            id: highlightId(vod.id, hl),
            hl,
          })),
        }
      } catch { return null }
    })).then(results => {
      const store = { ...loadHlStore() }
      for (const r of results) {
        if (!r) continue
        for (const item of r.items) {
          const vod = r.vod
          store[item.id] = {
            id: item.id,
            vodId: vod.id,
            hl: item.hl,
            champion: vod.champion || '',
            championIcon: vod.championIcon || '',
            date: vod.date,
            queue: vod.queue || '',
          }
        }
      }
      saveHlStore(store)
      setHlStore(store)
      if (dead) return
      setHighlights(buildHlCards(store, vods, hlHidden, lang))
    })
    return () => { dead = true }
  }, [subTab, vods, hlHidden, lang, settings, hlBump])

  /* Auto-cut each detected highlight into its own mp4 clip so highlights behave
     like manual clips: they have a standalone file and keep being playable even
     after the source VOD is deleted. Runs once per highlight (guarded by
     hlStore.clipPath), in the background to avoid blocking the UI. Only the
     most recent few are cut per visit (source VODs are huge; cutting every
     detected highlight of 60 VODs at once is what made the app/PC feel slow),
     and cuts are spaced out + serialized so Media Foundation never pegs the CPU
     with several concurrent decodes. */
  useEffect(() => {
    if (subTab !== 'highlights') return
    if (!settings.autoHighlights) return
    if (!isTauri()) return
    if (autoCutRunning.current) return
    const entries = Object.values(loadHlStore())
      .filter(e => e && e.id && !e.clipPath && e.hl && e.vodId)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 30)
    if (!entries.length) return
    autoCutRunning.current = true
    let dead = false
    ;(async () => {
      try {
        for (const entry of entries) {
          if (dead) return
          const id = entry.id
          if (inflightCuts.current.has(id)) continue
          const vod = vods.find(v => v.id === entry.vodId)
          if (!vod || !vod.videoPath || !vod.hasVideo) continue
          const hl = entry.hl || {}
          const dur = Math.max(0, vod.duration || 0)
          const start = Math.max(0, hl.startVideoSec || 0)
          const end = Math.min(Math.max(0, hl.endVideoSec || 0), dur || Math.max(0, hl.endVideoSec || 0))
          if (end - start < 1) continue
          inflightCuts.current.add(id)
          try {
            const label = (entry.name && entry.name.trim()) || highlightLabel(lang, hl, vod.champion || '')
            const res = await createManualClip(vod.videoPath, start, end, label)
            if (dead) return
            if (res && res.path) {
              const st = loadHlStore()
              if (st[id] && !st[id].clipPath) {
                st[id].clipPath = res.path
                if (res.thumb) st[id].thumb = res.thumb
                saveHlStore(st)
                setHlStore(st)
                setHighlights(buildHlCards(st, vods, hlHidden, lang))
              }
            } else if (res && res.error) {
              console.warn('[autocut] cut failed', id, res.error)
            }
          } catch (e) {
            console.warn('[autocut] cut failed', id, String(e && (e.message || e.detail) || e || ''))
          } finally {
            inflightCuts.current.delete(id)
          }
          await new Promise(r => setTimeout(r, 400))
        }
      } finally {
        autoCutRunning.current = false
      }
    })()
    return () => { dead = true }
  }, [subTab, vods, hlHidden, lang, settings.autoHighlights, hlStore, hlBump])

  const toggleHlFavorite = useCallback((id, e, hlItem) => {
    if (e) e.stopPropagation()
    const currentlyFav = hlFav.has(id)
    setHlFav(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(HL_FAV_KEY, JSON.stringify([...next]))
      return next
    })
    if (!currentlyFav) {
      ;(async () => {
        const store = loadHlStore()
        const entry = store[id]
        if (!entry || entry.clipPath || !hlItem) return
        const src = hlItem.vod && hlItem.vod.videoPath
        if (!src) return
        const hl = hlItem.hl || {}
        const clipPath = await exportHighlightCopy(src, hl.startVideoSec || 0, hl.endVideoSec || 0)
        if (!clipPath) return
        const st2 = loadHlStore()
        if (st2[id]) {
          st2[id].clipPath = clipPath
          saveHlStore(st2)
          setHlStore(st2)
        }
      })()
    }
  }, [hlFav])

  const hideHighlight = useCallback((id, e) => {
    if (e) e.stopPropagation()
    if (hlFav.has(id)) return
    setHlHidden(prev => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem(HL_HIDDEN_KEY, JSON.stringify([...next]))
      return next
    })
  }, [hlFav])

  /* Build (once) the trimmed clip for a highlight. The cut starts 10s before
     the first event and ends 3s after the last one (already baked into the
     highlight's startVideoSec/endVideoSec); the resulting file + thumbnail are
     cached in the highlight store so reopening is instant. */
  const ensureHighlightClip = useCallback(async (h) => {
    const id = h && h.id
    if (!id) return null
    const store0 = loadHlStore()
    if (store0[id] && store0[id].clipPath) return store0[id]
    if (inflightCuts.current.has(id)) return null
    const src = h.vod && h.vod.videoPath
    const hl = h.hl || {}
    if (!src || !isTauri()) return null
    const start = Math.max(0, hl.startVideoSec || 0)
    const end = Math.min(Math.max(0, hl.endVideoSec || 0), Math.max(0, h.vod.duration || 0) || Math.max(0, hl.endVideoSec || 0))
    if (end - start < 1) return null
    inflightCuts.current.add(id)
    try {
      const storeEntry = loadHlStore()[id]
      const customName = (storeEntry && storeEntry.name && storeEntry.name.trim()) || ''
      const label = customName || highlightLabel(lang, hl, (h.vod && h.vod.champion) || '')
      const res = await createManualClip(src, start, end, label)
      if (res && res.path) {
        const st = loadHlStore()
        if (st[id]) {
          st[id].clipPath = res.path
          if (res.thumb) st[id].thumb = res.thumb
          saveHlStore(st)
          setHlStore(st)
          setHighlights(buildHlCards(st, vods, hlHidden, lang))
          return st[id]
        }
      }
    } catch {} finally {
      inflightCuts.current.delete(id)
    }
    return null
  }, [vods, hlHidden, lang])

  const openHighlight = useCallback((h) => {
    const doOpen = (vod, hl) => {
      if (onOpenHighlight) onOpenHighlight(vod, hl)
      else if (onOpenVod) onOpenVod(vod)
    }
    const hlWithLabel = (vod, hl) => ({
      ...hl,
      startVideoSec: 0,
      label: highlightLabel(lang, hl, (vod.champion) || ''),
    })
    const vod = h.vod
    /* If the standalone clip already exists, play it directly. */
    const cached = loadHlStore()[h.id]
    if (cached && cached.clipPath) {
      const mv = { ...h.vod, videoPath: cached.clipPath, hasVideo: true }
      doOpen(mv, hlWithLabel(mv, h.hl))
      return
    }
    /* No clip yet: open the full VOD right away at the highlight's time so
       playback is instant (VODPlayer seeks to startVideoSec), and pre-cut the
       clip in the background so the next open is instant. Never block playback
       on a Media Foundation transcode � that was the "slow to open" and the
       reason the app/PC felt sluggish. */
    if (vod && vod.videoPath) {
      doOpen(h.vod, h.hl)
      ensureHighlightClip(h).catch(() => {})
    } else {
      doOpen(h.vod, h.hl)
    }
  }, [onOpenHighlight, onOpenVod, ensureHighlightClip, lang])

  /* Share a clip or highlight: generate the highlight's clip if needed, upload
     the mp4 (+ thumbnail) to the public server and surface the link. Already
     shared items reuse their stored link without re-uploading. The popup opens
     instantly with an "uploading" state so the user sees feedback instead of
     an unresponsive UI while the cut/upload runs. */
  const doShare = useCallback(async ({ id, kind }) => {
    if (sharingId) return
    setSharingId(id)
    // Open the modal right away with a placeholder so the UI feels instant.
    setShareModal({ kind, id, name: '', uploading: true, error: false })
    // Wake the backend in parallel, so the upload that follows is fast
    // (free-tier Render sleeps after ~15 min of inactivity).
    warmShareServer()
    // Every failure lands the modal on a real error (the "stuck forever on
    // uploading" bug was silent `return`s / empty catches leaving the popup
    // spinning). apply() is the ONLY exit that touches the modal.
    const apply = (modal) => setShareModal((m) => {
      const open = m && m.kind === kind && m.id === id
      return open ? modal : m
    })
    const patch = (fn) => setShareModal((m) => {
      const open = m && m.kind === kind && m.id === id
      return open ? fn(m) : m
    })
    const t0 = Date.now()
    const stageLog = (stage, extra) => console.warn(`[share:${kind}:${id}] ${stage} +${Date.now() - t0}ms`, extra || '')
    const fail = (detail, errType) => {
      stageLog('fail', { detail, errType })
      apply({ kind, id, url: '', videoUrl: '', name: '', uploading: false, error: true, errorDetail: detail || '', errType: errType || 'unknown', logTail: '' })
      /* Surface the backend diagnostic tail right in the popup so the real
         failing step is visible without opening devtools. */
      readShareLog().then((tail) => {
        if (tail && tail.trim()) {
          console.warn(`[share:${kind}:${id}] log tail:\n${tail}`)
          patch((m) => (m.error ? { ...m, logTail: tail } : m))
        }
      }).catch(() => {})
    }
    /* Race each long-running step against a hard timeout so the popup can never
       spin forever: on timeout we fail fast with a real message and the late
       result is discarded. */
    const withTimeout = (promise, ms, label) => new Promise((resolve) => {
      let settled = false
      const done = (v) => { if (!settled) { settled = true; resolve(v) } }
      const timer = setTimeout(() => { stageLog('timeout', label); clearTimeout(timer); done({ timedOut: true }) }, ms)
      promise.then(
        (v) => { clearTimeout(timer); done(v || {}) },
        (e) => { clearTimeout(timer); done({ error: String((e && (e.message || e.detail)) || e || '') }) }
      )
    })
    try {
      let videoPath = ''
      let thumbPath = ''
      let shareUrl = ''
      let videoUrl = ''
      let shareName = ''
      if (kind === 'highlight') {
        const store = loadHlStore()
        const entry = store[id]
        if (!entry) { fail(t(lang, 'shareNoClip'), 'missing'); return }
        videoPath = entry.clipPath || ''
        thumbPath = entry.thumb || ''
        shareUrl = entry.shareUrl || ''
        videoUrl = entry.videoUrl || ''
        shareName = (entry.name && entry.name.trim()) || highlightLabel(lang, entry.hl, entry.champion || '')
        /* Sharing never blocks on a background job: if the standalone clip isn't
           cut yet, cut it RIGHT NOW from the VOD (fast, verified seek). The link
           only appears once the file is ready, so it always works even if the
           worker hasn't gotten to this highlight yet. */
        if (!videoPath) {
          const hl = entry.hl || {}
          const vod = vods.find(v => v.id === entry.vodId)
          const dur = Math.max(0, vod && vod.duration || 0)
          const start = Math.max(0, hl.startVideoSec || 0)
          const end = Math.min(Math.max(0, hl.endVideoSec || 0), dur || Math.max(0, hl.endVideoSec || 0))
          if (!vod || !vod.videoPath || !vod.hasVideo || !isTauri() || end - start < 1) {
            stageLog('no-source', { vodId: entry.vodId, hasVideo: vod && vod.hasVideo, videoPath: vod && vod.videoPath })
            fail(t(lang, 'shareNoClip'), 'missing')
            return
          }
          /* If the standalone clip is already being cut (worker / opened the VOD),
             WAIT for it and reuse the file. Never start a second Media
             Foundation transcode on the same source: two concurrent cuts of
             the same VOD starve each other — that is exactly the "stuck for
             minutes then timeout" seen in the share logs. */
          const cachedNow = loadHlStore()[id]
          let cut = null
          if (cachedNow && cachedNow.clipPath) {
            cut = { path: cachedNow.clipPath, thumb: cachedNow.thumb || '' }
          } else if (inflightCuts.current.has(id)) {
            stageLog('cut-wait-worker')
            for (let i = 0; i < 600; i++) {
              await new Promise(r => setTimeout(r, 500))
              const st = loadHlStore()[id]
              if (st && st.clipPath) {
                cut = { path: st.clipPath, thumb: st.thumb || '' }
                break
              }
              if (!inflightCuts.current.has(id)) break
            }
            if (cut) stageLog('worker-cut-done', cut.path)
            else if (inflightCuts.current.has(id)) {
              stageLog('cut-wait-timeout')
              fail(t(lang, 'shareTimeoutDesc'), 'timeout')
              return
            }
          }
          if (!cut) {
            stageLog('cut-start', { start, end, vod: vod.videoPath })
            inflightCuts.current.add(id)
            let r
            try {
              r = await withTimeout(createManualClip(vod.videoPath, start, end, shareName), 300000, 'cut')
            } finally {
              inflightCuts.current.delete(id)
            }
            if (r && r.timedOut) { fail(t(lang, 'shareTimeoutDesc'), 'timeout'); return }
            if (r && r.error) { fail(t(lang, 'shareCutFailedDesc') + ' ' + r.error, 'cut'); return }
            cut = r || null
          }
          if (!cut || !cut.path) { fail(t(lang, 'shareNoClip'), 'missing'); return }
          stageLog('cut-done', cut.path)
          videoPath = cut.path
          if (cut.thumb) thumbPath = cut.thumb
          const st = loadHlStore()
          if (st[id]) {
            st[id].clipPath = cut.path
            if (cut.thumb) st[id].thumb = cut.thumb
            saveHlStore(st)
            setHlStore(st)
            setHighlights(buildHlCards(st, vods, hlHidden, lang))
          }
        }
      } else {
        const list = JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) || '[]')
        const clip = list.find((c) => c.id === id)
        if (!clip || !clip.path) { fail(t(lang, 'shareNoClip'), 'missing'); return }
        videoPath = clip.path
        thumbPath = clip.thumbPath || ''
        shareUrl = clip.shareUrl || ''
        videoUrl = clip.videoUrl || ''
        shareName = clip.name || 'clip'
      }
      if (shareUrl) {
        apply({ kind, id, url: shareUrl, videoUrl, name: shareName, uploading: false, error: false })
        return
      }
      if (!isTauri() || !videoPath) { fail(t(lang, 'shareNoClip'), 'missing'); return }
      stageLog('upload-start', videoPath)
      const r = await withTimeout(shareClip(videoPath, thumbPath, shareName, kind), 320000, 'upload')
      if (r && r.timedOut) { fail(t(lang, 'shareTimeoutDesc'), 'timeout'); return }
      if (r && r.error) { fail(r.error, 'upload'); return }
      const res = r || {}
      if (res.error) { fail(res.error, 'upload'); return }
      if (!res.shareUrl) { fail(t(lang, 'shareFailedDesc'), 'upload'); return }
      stageLog('upload-done', res.shareUrl)
      if (kind === 'highlight') {
        const st = loadHlStore()
        if (st[id]) {
          st[id].shareUrl = res.shareUrl
          st[id].videoUrl = res.videoUrl || ''
          saveHlStore(st)
          setHlStore(st)
          setHighlights(buildHlCards(st, vods, hlHidden, lang))
        }
      } else {
        const list = JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) || '[]')
        const c = list.find((x) => x.id === id)
        if (c) {
          c.shareUrl = res.shareUrl
          c.videoUrl = res.videoUrl || ''
          localStorage.setItem(CLIPS_STORAGE_KEY, JSON.stringify(list))
          setClips(list)
        }
      }
      apply({ kind, id, url: res.shareUrl, videoUrl: res.videoUrl || '', name: shareName, uploading: false, error: false })
    } catch (e) {
      fail(String((e && (e.message || e.detail)) || e || ''), 'unknown')
    } finally {
      setSharingId(null)
    }
  }, [sharingId, highlights, vods, hlHidden, lang])

  const copyShareLink = () => {
    if (!shareModal || !shareModal.url) return
    try {
      navigator.clipboard.writeText(shareModal.url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {}
  }

  const handleContextMenu = useCallback((e, vod) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, vod })
  }, [])

  const handleHlContextMenu = useCallback((e, hlCard) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'highlight', hl: hlCard })
  }, [])

  const handleClipContextMenu = useCallback((e, clip) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'clip', clip })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!openDropdown) return
    const close = () => setOpenDropdown(null)
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('click', close)
    }
  }, [openDropdown])

  const openFolder = async () => {
    if (window.__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('open_vod_folder')
      } catch {}
    } else if (settings.vodPath) {
      window.open('file:///' + settings.vodPath.replace(/\\/g, '/'))
    }
  }

  const totalGames = vods.length
  const totalDuration = vods.reduce((a, v) => a + (v.duration || 0), 0)

  const matchQueue = (vod) => {
    if (filterQueue === 'all') return true
    const q = String(vod.queue || '').toLowerCase()
    const has = (re) => re.test(q)
    switch (filterQueue) {
      case 'solo': return has(/solo\/duo|solo/)
      case 'flex': return has(/flex/)
      case 'aram': return has(/aram/)
      case 'normal': return has(/blind pick|draft pick|normal/)
      case 'custom': return has(/custom/)
      default: return true
    }
  }
  const matchRole = (vod) => {
    if (filterRole === 'all') return true
    let r = String(vod.role || '').toUpperCase()
    /* Fallback: some VODs (pre-role-capture or ARAM) have no stored role, so
       derive it from the resolved match participants' lane/role. */
    if (!r) {
      const me = [...(vod.team1 || []), ...(vod.team2 || [])].find(p => p.isPlayer || p.is_player)
      if (me) r = String(me.lane || me.role || me.position || '').toUpperCase()
    }
    switch (filterRole) {
      case 'TOP': return r === 'TOP'
      case 'JUNGLE': return r === 'JUNGLE'
      case 'MID': return r === 'MID' || r === 'MIDDLE'
      case 'BOT': return r === 'BOT' || r === 'BOTTOM' || r === 'ADC'
      case 'SUPPORT': return r === 'SUPPORT' || r === 'UTILITY'
      default: return true
    }
  }
  const matchResult = (vod) => {
    if (filterResult === 'all') return true
    if (filterResult === 'win') return vod.result === 'win'
    if (filterResult === 'loss') return vod.result === 'loss'
    return true
  }
  const matchChamp = (vod) => {
    if (filterChamp === 'all') return true
    return String(vod.champion || '') === filterChamp
  }
  const matchFav = (vod) => {
    if (filterFav === 'all') return true
    if (filterFav === 'fav') return favorites.has(vod.id)
    if (filterFav === 'nofav') return !favorites.has(vod.id)
    return true
  }
  const filteredVods = vods.filter(v => matchQueue(v) && matchRole(v) && matchResult(v) && matchChamp(v) && matchFav(v))

  /* Distinct champions present in VODs, A-Z */
  const championList = [...new Set(vods.map(v => v.champion).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const champIconMap = {}
  vods.forEach(v => { if (v.champion && v.championIcon && !champIconMap[v.champion]) champIconMap[v.champion] = v.championIcon })

  const roleOptions = [
    { id: 'support', key: 'Support' },
    { id: 'top', key: 'Top' },
    { id: 'jungle', key: 'Jungle' },
    { id: 'mid', key: 'Mid' },
    { id: 'bot', key: 'Bottom' },
  ]

  const toggleDropdown = (name) => setOpenDropdown(openDropdown === name ? null : name)

  const setFilter = (name, value) => {
    if (name === 'queue') setFilterQueue(value)
    else if (name === 'role') setFilterRole(value)
    else if (name === 'result') setFilterResult(value)
    else if (name === 'champ') setFilterChamp(value)
    else if (name === 'fav') setFilterFav(value)
    setOpenDropdown(null)
  }

  return (
    <div className="rt-view">
      {!isTauri() && (
        <div className="rt-web-banner">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>{t(lang, 'riftTimelineWebOnly')}</span>
        </div>
      )}

      <div className="rt-header">
        <div className="rt-header-left">
          <h2 className="rt-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {t(lang, 'riftTimeline')}
          </h2>
          <span className="rt-subtitle">{totalGames} {t(lang, 'vodsRecorded')} · {formatDuration(totalDuration)}</span>
        </div>
        <div className="rt-header-actions">
          <button className="rt-btn rt-btn-ghost" onClick={openFolder} title={t(lang, 'openVodFolder')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {t(lang, 'openFolder')}
          </button>
        </div>
      </div>

      <div className="rt-recording-status">
        <span className={`rt-rec-dot ${settings.autoRecord ? 'active' : ''}`} />
        <span className="rt-rec-label">
          {settings.autoRecord ? t(lang, 'autoRecordingOn') : t(lang, 'autoRecordingOff')}
        </span>
      </div>

      {diskUsage && (() => {
        const totalGB = diskUsage.totalBytes / (1024 ** 3)
        const usedGB = diskUsage.usedBytes / (1024 ** 3)
        const freeGB = diskUsage.freeBytes / (1024 ** 3)
        const pct = Math.min(100, (usedGB / totalGB) * 100)
        const fmtGB = (gb) => gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb)} GB`
        const isLow = pct > 90
        const isWarn = pct > 75
        return (
          <div className="rt-storage">
            <div className="rt-storage-header">
              <div className="rt-storage-info">
                <svg className={`rt-storage-icon ${isLow ? 'danger' : isWarn ? 'warn' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                <span className="rt-storage-label">{t(lang, 'storageUsage')}</span>
                <span className="rt-storage-drive">{diskUsage.drive}</span>
              </div>
              <span className="rt-storage-text">{fmtGB(usedGB)} / {fmtGB(totalGB)}</span>
            </div>
            <div className="rt-storage-bar">
              <div
                className={`rt-storage-fill ${isLow ? 'danger' : isWarn ? 'warn' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="rt-storage-free">{fmtGB(freeGB)} {t(lang, 'storageUsageDesc')}</span>
          </div>
        )
      })()}

      {subTab === 'recordings' && (
        <div className="rt-filterbar">
          {[
            {
              name: 'queue',
              label: filterQueue === 'all' ? t(lang, 'allQueues') : t(lang, filterQueue === 'solo' ? 'soloDuo' : filterQueue === 'flex' ? 'flex' : filterQueue === 'aram' ? 'aram' : filterQueue === 'normal' ? 'normal' : 'custom'),
              options: [
                ['all', t(lang, 'allQueues')],
                ['solo', t(lang, 'soloDuo')],
                ['flex', t(lang, 'flex')],
                ['aram', t(lang, 'aram')],
                ['normal', t(lang, 'normal')],
                ['custom', t(lang, 'custom')],
              ],
            },
            {
              name: 'role',
              label: filterRole === 'all' ? t(lang, 'allRoles') : t(lang, filterRole.toLowerCase()),
              options: [
                ['all', t(lang, 'allRoles')],
                ['TOP', t(lang, 'top')],
                ['JUNGLE', t(lang, 'jungle')],
                ['MID', t(lang, 'mid')],
                ['BOT', t(lang, 'bot')],
                ['SUPPORT', t(lang, 'support')],
              ],
              role: true,
            },
            {
              name: 'result',
              label: filterResult === 'all' ? t(lang, 'allResults') : t(lang, filterResult === 'win' ? 'victory' : 'defeat'),
              options: [
                ['all', t(lang, 'allResults')],
                ['win', t(lang, 'victory')],
                ['loss', t(lang, 'defeat')],
              ],
              result: true,
            },
            {
              name: 'champ',
              label: filterChamp === 'all' ? t(lang, 'allChampions') : filterChamp,
              options: [['all', t(lang, 'allChampions')], ...championList.map(c => [c, c])],
              champs: true,
            },
            {
              name: 'fav',
              label: filterFav === 'all' ? t(lang, 'allGames') : t(lang, filterFav === 'fav' ? 'favorites' : 'noFavorites'),
              options: [
                ['all', t(lang, 'allGames')],
                ['fav', t(lang, 'favorites')],
                ['nofav', t(lang, 'noFavorites')],
              ],
            },
          ].map((f) => (
            <div key={f.name} className="rt-filter">
              <button className={`rt-filter-btn ${openDropdown === f.name ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); toggleDropdown(f.name) }}>
                {f.role && filterRole !== 'all' && <RoleIcon role={filterRole} />}
                {f.champs && filterChamp !== 'all' && champIconMap[filterChamp] && (
                  <img className="rt-filter-champ-icon" src={champIconMap[filterChamp]} alt="" />
                )}
                <span>{f.label}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rt-filter-chev">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {openDropdown === f.name && (
                <div className="rt-filter-menu">
                  {f.options.map(([val, text]) => {
                    const active = val === (f.name === 'queue' ? filterQueue : f.name === 'role' ? filterRole : f.name === 'result' ? filterResult : f.name === 'champ' ? filterChamp : filterFav)
                    return (
                      <button key={val} className={`rt-filter-opt ${active ? 'active' : ''}`} onClick={() => setFilter(f.name, val)}>
                        {f.role && val !== 'all' && <RoleIcon role={val} />}
                        {f.champs && val !== 'all' && champIconMap[val] && (
                          <img className="rt-filter-menu-icon" src={champIconMap[val]} alt="" />
                        )}
                        {f.result && val !== 'all' && (
                          <span className={`rt-filter-dot ${val}`} />
                        )}
                        <span>{val === 'all' ? text : text || val}</span>
                        {active && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="rt-filter-check">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {subTab === 'recordings' ? (
        filteredVods.length === 0 ? (
          <div className="rt-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" />
            </svg>
            <p className="rt-empty-title">{vods.length === 0 ? t(lang, 'noVods') : t(lang, 'noMatchesFilter')}</p>
            <p className="rt-empty-sub">{vods.length === 0 ? t(lang, 'noVodsHint') : t(lang, 'noMatchesFilterHint')}</p>
          </div>
        ) : (
          <div className="rt-grid">
            {[...filteredVods].sort((a, b) => {
              const fa = favorites.has(a.id) ? 0 : 1
              const fb = favorites.has(b.id) ? 0 : 1
              if (fa !== fb) return fa - fb
              return (b.date || 0) - (a.date || 0)
            }).map((vod) => (
              <div key={vod.id} className="rt-card" onClick={() => onOpenVod(vod)} onContextMenu={(e) => handleContextMenu(e, vod)}>
                <div className="rt-card-thumb">
                  {vod.thumbnail ? (
                    <img src={vod.thumbnail} alt="" />
                  ) : (
                    <VodThumb vod={vod} />
                  )}
                  <span className="rt-card-duration">{formatDuration(vod.duration)}</span>
                  {vod.pendingMatch && <span className="rt-card-badge pending">{t(lang, 'pendingBadge')}</span>}
                  {vod.result === 'win' && <span className="rt-card-badge win">W</span>}
                  {vod.result === 'loss' && <span className="rt-card-badge loss">L</span>}
                  <button
                    className={`rt-card-fav ${favorites.has(vod.id) ? 'active' : ''}`}
                    onClick={(e) => toggleFavorite(vod.id, e)}
                    title={favorites.has(vod.id) ? t(lang, 'removeFavorite') : t(lang, 'addFavorite')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={favorites.has(vod.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                </div>
                  <div className="rt-card-info">
                  <div className="rt-card-champ">
                    {vod.championIcon && <img className="rt-card-champ-icon" src={vod.championIcon} alt="" />}
                    <span className="rt-card-champ-name">{vod.champion || '�'}</span>
                  </div>
                  <div className="rt-card-meta">
                    <span className="rt-card-kda">{relTime(lang, vod.date)}</span>
                    <span className="rt-card-date">{formatDate(vod.date)}</span>
                  </div>
                  <div className="rt-card-queue">{vod.queue || ''}</div>
                  </div>
              </div>
            ))}
          </div>
        )
      ) : subTab === 'clips' ? (
        clips.length === 0 ? (
          <div className="rt-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
            <p className="rt-empty-title">{t(lang, 'noClips')}</p>
            <p className="rt-empty-sub">{t(lang, 'noClipsHint')}</p>
          </div>
        ) : (
          <div className="rt-grid">
            {clips.map((clip) => {
              const vod = vods.find(v => v.id === clip.vodId)
              const duration = clip.end - clip.start
              return (
                <div
                  key={clip.id}
                  className="rt-card rt-card-clip"
                  onClick={() => openClipItem(clip)}
                  onContextMenu={(e) => handleClipContextMenu(e, clip)}
                >
                  <div className="rt-card-clip-thumb">
                    {clip.thumb ? (
                      <img src={clip.thumb} alt="" />
                    ) : vod?.thumbnail ? (
                      <img src={vod.thumbnail} alt="" />
                    ) : (
                      <div className="rt-card-clip-thumb-fallback">
                        {vod?.championIcon && <img src={vod.championIcon} alt="" />}
                      </div>
                    )}
                    <span className="rt-card-clip-duration">{formatDuration(duration)}</span>
                    <span className="rt-card-clip-play">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                    </span>
                  </div>
<div className="rt-card-clip-bottom">
                    <div className="rt-card-clip-info">
                      {vod?.championIcon && <img className="rt-card-clip-champ" src={vod.championIcon} alt="" />}
                      <span className="rt-card-clip-name">{clip.name || t(lang, 'clip')}</span>
                      <span className="rt-card-clip-range">{formatDuration(clip.start)} — {formatDuration(clip.end)}</span>
                    </div>
                    <button
                      className="rt-card-clip-delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(t(lang, 'confirmDeleteClip'))) deleteClip(clip.id)
                      }}
                      title={t(lang, 'deleteVod')}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="rt-hl-view">
          <div className="rt-hl-head">
            <div className="rt-hl-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{t(lang, 'navHighlights')}</span>
            </div>
            <span className="rt-hl-count">{highlights.filter(h => !hlHidden.has(h.id)).length}</span>
          </div>

          {!settings.autoHighlights ? (
            <div className="rt-empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <p className="rt-empty-title">{t(lang, 'highlightsDisabled')}</p>
              <p className="rt-empty-sub">{t(lang, 'highlightsDisabledHint')}</p>
            </div>
          ) : (() => {
            const visible = highlights
              .filter(h => !hlHidden.has(h.id))
              .sort((a, b) => {
                const fa = hlFav.has(a.id) ? 0 : 1
                const fb = hlFav.has(b.id) ? 0 : 1
                if (fa !== fb) return fa - fb
                return ((b.vod.date || 0)) - ((a.vod.date || 0))
              })
            if (visible.length === 0) {
              return (
                <div className="rt-empty">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <p className="rt-empty-title">{t(lang, 'noHighlights')}</p>
                  <p className="rt-empty-sub">{t(lang, 'noHighlightsHint')}</p>
                </div>
              )
            }
            return (
              <div className="rt-grid">
                {visible.map((h) => {
                  const vod = h.vod
                  const fav = hlFav.has(h.id)
                  const hasVideo = h.hasVideo
                  return (
                    <div
                      key={h.id}
                      className={`rt-card rt-card-hl ${fav ? 'rt-card-hl-fav' : ''} ${hasVideo ? '' : 'rt-card-hl-novideo rt-card-nodrop'}`}
                      onClick={() => { if (hasVideo) openHighlight(h) }}
                      onContextMenu={(e) => handleHlContextMenu(e, h)}
                    >
                      <div className="rt-hl-top">
                        {vod.championIcon && <img className="rt-card-champ-icon" src={vod.championIcon} alt="" />}
                        <span className="rt-hl-kind">
                          {h.hl.solo && !h.hl.died ? t(lang, 'hlSolo')
                            : h.hl.kills >= 2 && h.hl.assists === 0 ? t(lang, 'hlMultikill')
                            : h.hl.kills >= 2 ? t(lang, 'hlMultikill')
                            : h.hl.died ? t(lang, 'hlTrade') : t(lang, 'hlAssist')}
                        </span>
                        <span className="rt-hl-fill" />
                        {hasVideo && (
                          <span className="rt-hl-play-icon">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          </span>
                        )}
                        <button
                          className={`rt-card-fav ${fav ? 'active' : ''}`}
                          onClick={(e) => toggleHlFavorite(h.id, e, h)}
                          title={fav ? t(lang, 'removeFavorite') : t(lang, 'addFavorite')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        </button>
                      </div>
                      <div className="rt-hl-body">
                        <div className="rt-hl-kda">
                          <span className="rt-hl-stat strong">{h.hl.kills}</span>
                          <span className="rt-hl-div"> / </span>
                          <span className="rt-hl-stat">{h.hl.assists}</span>
                          {h.hl.died && <span className="rt-hl-die">�</span>}
</div>
                        <div className="rt-hl-name">{h.label}</div>
                        <div className="rt-hl-meta">
                          <span className="rt-hl-champ">{vod.champion || vod.queue || ''}</span>
                          <span className="rt-hl-sep">·</span>
                          <span className="rt-hl-rel">{relTime(lang, vod.date)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {contextMenu && (() => {
        const isHl = contextMenu.kind === 'highlight'
        const isClip = contextMenu.kind === 'clip'
        return (
          <div
            className="rt-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {isHl && (
              <>
                {contextMenu.hl.hasVideo && (
                  <button className="rt-context-item" onClick={() => { openHighlight(contextMenu.hl); setContextMenu(null) }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {t(lang, 'open')}
                  </button>
                )}
                <button
                  className="rt-context-item"
                  disabled={!contextMenu.hl.hasVideo}
                  title={contextMenu.hl.hasVideo ? '' : t(lang, 'shareHighlight')}
                  onClick={() => { doShare({ id: contextMenu.hl.id, kind: 'highlight' }); setContextMenu(null) }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                  {t(lang, 'shareHighlight')}
                </button>
                <button
                  className="rt-context-item"
                  onClick={() => { toggleHlFavorite(contextMenu.hl.id, { stopPropagation: () => {} }, contextMenu.hl); setContextMenu(null) }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={hlFav.has(contextMenu.hl.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  {hlFav.has(contextMenu.hl.id) ? t(lang, 'removeFavorite') : t(lang, 'addFavorite')}
                </button>
                {contextMenu.hl.vod && contextMenu.hl.vod.videoPath && (
                  <button className="rt-context-item" onClick={() => { showInFolder(contextMenu.hl.vod.videoPath); setContextMenu(null) }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                    {t(lang, 'showInFolder')}
                  </button>
                )}
                <button className="rt-context-item" onClick={() => { openRename(contextMenu.hl, 'highlight'); setContextMenu(null) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  {t(lang, 'rename')}
                </button>
                <button
                  className={`rt-context-item rt-context-danger ${hlFav.has(contextMenu.hl.id) ? 'rt-context-disabled' : ''}`}
                  title={hlFav.has(contextMenu.hl.id) ? t(lang, 'hlLocked') : ''}
                  onClick={() => {
                    if (hlFav.has(contextMenu.hl.id)) return
                    hideHighlight(contextMenu.hl.id)
                    setContextMenu(null)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  {t(lang, 'deleteVod')}
                </button>
              </>
            )}
            {isClip && (
              <>
                  <button className="rt-context-item" onClick={() => { openClipItem(contextMenu.clip); setContextMenu(null) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {t(lang, 'open')}
                </button>
                {contextMenu.clip.path && (
                  <button className="rt-context-item" onClick={() => { showInFolder(contextMenu.clip.path); setContextMenu(null) }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                    {t(lang, 'showInFolder')}
                  </button>
                )}
                <button className="rt-context-item" onClick={() => { doShare({ id: contextMenu.clip.id, kind: 'clip' }); setContextMenu(null) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                  {t(lang, 'shareClip')}
                </button>
                <button className="rt-context-item" onClick={() => { openRename(contextMenu.clip, 'clip'); setContextMenu(null) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  {t(lang, 'rename')}
                </button>
                <button
                  className="rt-context-item rt-context-danger"
                  onClick={() => {
                    if (confirm(t(lang, 'confirmDeleteClip'))) deleteClip(contextMenu.clip.id)
                    setContextMenu(null)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  {t(lang, 'deleteVod')}
                </button>
              </>
            )}
            {!isHl && !isClip && (
              <>
                <button className="rt-context-item" onClick={() => { onOpenVod(contextMenu.vod); setContextMenu(null) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {t(lang, 'open')}
                </button>
                {(contextMenu.vod.videoPath || isTauri()) && (
                  <button className="rt-context-item" onClick={() => { showInFolder(contextMenu.vod.videoPath); setContextMenu(null) }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                    {t(lang, 'showInFolder')}
                  </button>
                )}
                <button className="rt-context-item" onClick={() => { toggleFavorite(contextMenu.vod.id, { stopPropagation: () => {} }); setContextMenu(null) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={favorites.has(contextMenu.vod.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  {favorites.has(contextMenu.vod.id) ? t(lang, 'removeFavorite') : t(lang, 'addFavorite')}
                </button>
                <button
                  className={`rt-context-item rt-context-danger ${favorites.has(contextMenu.vod.id) ? 'rt-context-disabled' : ''}`}
                  title={favorites.has(contextMenu.vod.id) ? t(lang, 'cannotDeleteFav') : ''}
                  onClick={() => {
                    if (favorites.has(contextMenu.vod.id)) return
                    setDeleteModal(contextMenu.vod)
                    setContextMenu(null)
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  {t(lang, 'deleteVod')}
                </button>
              </>
            )}
          </div>
        )
      })()}

      {deleteModal && (
        <div className="rt-modal-backdrop" onClick={() => setDeleteModal(null)}>
          <div className="rt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rt-modal-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>
            <h3 className="rt-modal-title">{t(lang, 'deleteRecording')}</h3>
            <p className="rt-modal-desc">{t(lang, 'deleteRecordingDesc')}</p>
            {deleteModal.champion && (
              <div className="rt-modal-vod-info">
                {deleteModal.championIcon && <img src={deleteModal.championIcon} alt="" />}
                <span>{deleteModal.champion}{deleteModal.queue ? ` � ${deleteModal.queue}` : ''}</span>
              </div>
            )}
            <div className="rt-modal-actions">
              <button className="rt-btn rt-btn-ghost" onClick={() => setDeleteModal(null)}>
                {t(lang, 'cancel')}
              </button>
              <button className="rt-btn rt-btn-danger" onClick={() => {
                deleteVod(deleteModal.id)
                setDeleteModal(null)
              }}>
                {t(lang, 'deleteVod')}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModal && (
        <div className="rt-modal-backdrop" onClick={() => setShareModal(null)}>
          <div className="rt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rt-modal-icon share">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </div>
            {shareModal.uploading ? (
              <>
                <div className="rt-share-spinner-out">
                  <span className="rt-share-spinner" aria-hidden="true" />
                </div>
                <h3 className="rt-modal-title">{t(lang, 'sharingTitle')}</h3>
                <p className="rt-modal-desc">{t(lang, 'sharingDesc')}</p>
              </>
            ) : shareModal.error ? (
              <>
                <h3 className="rt-modal-title">{t(lang, 'shareFailed')}</h3>
                <p className="rt-modal-desc">
                  {shareModal.errType === 'cut' ? t(lang, 'shareCutFailedDesc') : t(lang, 'shareFailedDesc')}
                </p>
                {shareModal.errorDetail && <p className="rt-share-err">{shareModal.errorDetail}</p>}
                {shareModal.logTail && shareModal.logTail.trim() && (
                  <pre className="rt-share-log">{t(lang, 'shareLogTitle') + ':\n' + shareModal.logTail}</pre>
                )}
              </>
            ) : (
              <>
                <h3 className="rt-modal-title">{t(lang, 'shareLinkTitle')}</h3>
                {shareModal.name && <p className="rt-share-name">{shareModal.name}</p>}
                <p className="rt-modal-desc">{t(lang, 'shareDesc')}</p>
                <div className="rt-share-link">
                  <input readOnly value={shareModal.url} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.preventDefault()} />
                  <button className="rt-btn rt-btn-sm" onClick={copyShareLink}>
                    {copiedLink ? t(lang, 'shareCopied') : t(lang, 'copyLink')}
                  </button>
                </div>
                {shareModal.videoUrl && (
                  <a className="rt-share-open" href={shareModal.videoUrl} target="_blank" rel="noreferrer">
                    {t(lang, 'openShareLink')}
                  </a>
                )}
              </>
            )}
            <div className="rt-modal-actions">
              {shareModal.error && (
                <button className="rt-btn rt-btn-primary" onClick={() => doShare({ id: shareModal.id, kind: shareModal.kind })}>
                  {t(lang, 'retry')}
                </button>
              )}
              <button className="rt-btn rt-btn-ghost" onClick={() => setShareModal(null)}>
                {t(lang, 'close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameModal && (
        <div className="rt-modal-backdrop" onClick={() => { if (!renaming) setRenameModal(null) }}>
          <div className="rt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rt-modal-title">{t(lang, 'rename')}</div>
            <input
              className="rt-rename-input"
              type="text"
              maxLength={30}
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value.slice(0, 30))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !renaming) doRename(renameVal)
                if (e.key === 'Escape' && !renaming) setRenameModal(null)
              }}
              placeholder={t(lang, 'renameHint')}
            />
            <div className="rt-rename-count">{renameVal.length}/30</div>
            <div className="rt-modal-actions">
              <button className="rt-btn rt-btn-primary" disabled={renaming || !renameVal.trim()} onClick={() => doRename(renameVal)}>
                {t(lang, 'save')}
              </button>
              <button className="rt-btn rt-btn-ghost" disabled={renaming} onClick={() => setRenameModal(null)}>
                {t(lang, 'cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

