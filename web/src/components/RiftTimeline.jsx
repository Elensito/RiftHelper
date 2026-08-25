import { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '../i18n.js'
import { isTauri, showInFolder, getAudioMode, vodThumbUrl, getDiskUsage } from '../tauri.js'
import { deleteRecordingBlob } from '../video-recorder.js'
import { deleteVodFiles } from '../tauri.js'

const VOD_STORAGE_KEY = 'rh-vods'
const VOD_SETTINGS_KEY = 'rh-vod-settings'
const CLIPS_STORAGE_KEY = 'rh-clips'

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

export default function RiftTimeline({ lang, onOpenVod, profile, subTab, onSubTabChange, onDelete, onSeekTo }) {
  const [vods, setVods] = useState(loadVods)
  const [clips, setClips] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) || '[]') } catch { return [] }
  })
  const [contextMenu, setContextMenu] = useState(null)
  const [diskUsage, setDiskUsage] = useState(null)
  const [settings, setSettings] = useState(() => {
    const s = loadSettings()
    return {
      autoRecord: s.autoRecord ?? true,
      closeToTray: s.closeToTray ?? true,
      autoStart: s.autoStart ?? false,
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
    const onStorage = (e) => {
      if (e.key === VOD_STORAGE_KEY) setVods(loadVods())
      if (e.key === CLIPS_STORAGE_KEY) {
        try { setClips(JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) || '[]')) } catch { setClips([]) }
      }
    }
    window.addEventListener('storage', onStorage)
    const onCustom = () => setVods(loadVods())
    window.addEventListener('rh-vods-changed', onCustom)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('rh-vods-changed', onCustom)
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

  const deleteClip = useCallback((clipId) => {
    const filtered = clips.filter(c => c.id !== clipId)
    setClips(filtered)
    try { localStorage.setItem(CLIPS_STORAGE_KEY, JSON.stringify(filtered)) } catch {}
  }, [clips])

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
            {vods.map((vod) => (
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
      ) : clips.length === 0 ? (
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
                      onOpenVod(vod)
                      if (onSeekTo) onSeekTo(clip.start)
                    }}
                  >
                    {t(lang, 'clipOpenVod')}
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
          <button className="rt-context-item rt-context-danger" onClick={() => {
            if (confirm(t(lang, 'confirmDeleteVod'))) {
              deleteVod(contextMenu.vod.id)
            }
            setContextMenu(null)
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            {t(lang, 'deleteVod')}
          </button>
        </div>
      )}
    </div>
  )
}

