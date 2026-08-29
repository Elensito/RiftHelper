import { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '../i18n.js'
import { isTauri, showInFolder, getAudioMode, vodThumbUrl, getDiskUsage, readVodEvents } from '../tauri.js'
import { deleteRecordingBlob } from '../video-recorder.js'
import { deleteVodFiles, exportHighlightCopy } from '../tauri.js'
import { computeHighlights, highlightId } from '../highlights.js'

const VOD_STORAGE_KEY = 'rh-vods'
const VOD_SETTINGS_KEY = 'rh-vod-settings'
const CLIPS_STORAGE_KEY = 'rh-clips'
const FAV_STORAGE_KEY = 'rh-vod-favorites'
const HL_FAV_KEY = 'rh-hl-favorites'
const HL_HIDDEN_KEY = 'rh-hl-hidden'
const HL_STORE_KEY = 'rh-hl-store'

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
function buildHlCards(store, vods, hlHidden) {
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
        hasVideo,
        vod: {
          id: hasClip ? `${e.vodId}::clip` : e.vodId,
          champion: e.champion,
          championIcon: e.championIcon,
          date: e.date,
          queue: e.queue,
          hasVideo,
          videoPath: vodPath,
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
  const [hlLoading, setHlLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
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
    window.addEventListener('rh-vods-changed', onCustom)
    window.addEventListener('rh-settings-changed', onSettingsCustom)
    window.addEventListener('rh-clips-changed', onClipsCustom)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('rh-vods-changed', onCustom)
      window.removeEventListener('rh-settings-changed', onSettingsCustom)
      window.removeEventListener('rh-clips-changed', onClipsCustom)
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
  }, [vods])

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

  /* Automatic highlights: load each recorded match's local LCD events, detect
     plays, and build cards (chronologically + favorites first). */
  useEffect(() => {
    if (subTab !== 'highlights') return
    if (!settings.autoHighlights) {
      setHlLoading(false)
      setHighlights([])
      return
    }
    let dead = false
    setHlLoading(true)
    setHighlights([])
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
          max: 3,
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
      setHighlights(buildHlCards(store, vods, hlHidden))
      setHlLoading(false)
    })
    return () => { dead = true }
  }, [subTab, vods, hlHidden, lang, settings.autoHighlights])

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

  const openHighlight = useCallback((vod, hl) => {
    if (onOpenHighlight) onOpenHighlight(vod, hl)
    else if (onOpenVod) onOpenVod(vod)
  }, [onOpenHighlight, onOpenVod])

  const handleContextMenu = useCallback((e, vod) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, vod })
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
          <span className="rt-subtitle">{totalGames} {t(lang, 'vodsRecorded')} Â· {formatDuration(totalDuration)}</span>
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

      {subTab === 'recordings' ? (
        vods.length === 0 ? (
          <div className="rt-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" />
            </svg>
            <p className="rt-empty-title">{t(lang, 'noVods')}</p>
            <p className="rt-empty-sub">{t(lang, 'noVodsHint')}</p>
          </div>
        ) : (
          <div className="rt-grid">
            {[...vods].sort((a, b) => {
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
                    <span className="rt-card-champ-name">{vod.champion || '—'}</span>
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
                <div key={clip.id} className="rt-card rt-card-clip">
                  <div className="rt-card-clip-header">
                    <div className="rt-card-champ">
                      {vod?.championIcon && <img className="rt-card-champ-icon" src={vod.championIcon} alt="" />}
                      <span className="rt-card-champ-name">{vod?.champion || '—'}</span>
                    </div>
                    <div className="rt-card-meta">
                      <span className="rt-card-date">{formatDate(clip.date)}</span>
                    </div>
                  </div>
                  {clip.thumb && (
                    <div className="rt-card-clip-thumb" onClick={() => {
                      if (clip.path) {
                        onOpenVod({ ...vod, videoPath: clip.path })
                      } else {
                        onOpenVod(vod)
                        if (onSeekTo) onSeekTo(clip.start)
                      }
                    }}>
                      <img src={clip.thumb} alt="" />
                      <span className="rt-card-clip-thumb-badge">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      </span>
                    </div>
                  )}
                  <div className="rt-card-clip-times">
                    <span className="rt-clip-time">{t(lang, 'clipFrom')} {formatDuration(clip.start)}</span>
                    <span className="rt-clip-time">{t(lang, 'clipTo')} {formatDuration(clip.end)}</span>
                    <span className="rt-clip-duration">{t(lang, 'clipDuration')}: {formatDuration(duration)}</span>
                  </div>
                  {vod?.queue && <div className="rt-card-queue">{vod.queue}</div>}
                  <div className="rt-card-clip-actions">
                    <button
                      className="rt-btn rt-btn-sm rt-btn-ghost"
                      onClick={() => {
                        if (clip.path) {
                          onOpenVod({ ...vod, videoPath: clip.path })
                        } else {
                          onOpenVod(vod)
                          if (onSeekTo) onSeekTo(clip.start)
                        }
                      }}
                    >
                      {clip.path ? t(lang, 'clipOpenClip') : t(lang, 'clipOpenVod')}
                    </button>
                    <button
                      className="rt-btn rt-btn-sm rt-btn-danger"
                      onClick={() => {
                        if (confirm(t(lang, 'confirmDeleteClip'))) deleteClip(clip.id)
                      }}
                    >
                      {t(lang, 'deleteVod')}
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

          {hlLoading ? (
            <div className="rt-empty">
              <div className="rt-hl-loading"><span className="rt-rec-dot active" /></div>
              <p className="rt-empty-sub">{t(lang, 'highlight')}</p>
            </div>
          ) : !settings.autoHighlights ? (
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
                      className={`rt-card rt-card-hl ${fav ? 'rt-card-hl-fav' : ''} ${hasVideo ? '' : 'rt-card-hl-novideo'}`}
                      onClick={() => { if (hasVideo) openHighlight(vod, h.hl) }}
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
                          {h.hl.died && <span className="rt-hl-die">†</span>}
                        </div>
                        <div className="rt-hl-meta">
                          <span className="rt-hl-champ">{vod.champion || vod.queue || ''}</span>
                          <span className="rt-hl-sep">•</span>
                          <span className="rt-hl-rel">{relTime(lang, vod.date)}</span>
                        </div>
                      </div>
                      <div className="rt-hl-actions">
                        <button
                          className="rt-btn rt-btn-sm rt-btn-hl-watch"
                          disabled={!hasVideo}
                          onClick={(e) => { e.stopPropagation(); if (hasVideo) openHighlight(vod, h.hl) }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                          {hasVideo ? t(lang, 'openHighlight') : t(lang, 'noVideo')}
                        </button>
                        <button
                          className={`rt-btn rt-btn-sm rt-btn-hl-ghost ${fav ? 'locked' : ''}`}
                          onClick={(e) => hideHighlight(h.id, e)}
                          disabled={fav}
                          title={fav ? t(lang, 'hlLocked') : t(lang, 'deleteVod')}
                        >
                          {fav ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {contextMenu && (
        <div
          className="rt-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
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
        </div>
      )}

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
                <span>{deleteModal.champion}{deleteModal.queue ? ` · ${deleteModal.queue}` : ''}</span>
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
    </div>
  )
}

