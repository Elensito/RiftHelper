import { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '../i18n.js'
import { isTauri, showInFolder, getAudioMode } from '../tauri.js'
import { deleteRecordingBlob } from '../video-recorder.js'

const VOD_STORAGE_KEY = 'rh-vods'
const VOD_SETTINGS_KEY = 'rh-vod-settings'

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

export { loadVods, saveVods, loadSettings, saveSettings, VOD_STORAGE_KEY, VOD_SETTINGS_KEY }

export default function RiftTimeline({ lang, onOpenVod, profile }) {
  const [vods, setVods] = useState(loadVods)
  const [contextMenu, setContextMenu] = useState(null)
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
    const filtered = vods.filter(v => v.id !== id)
    setVods(filtered)
    saveVods(filtered)
    window.dispatchEvent(new Event('rh-vods-changed'))
    deleteRecordingBlob(id).catch(() => {})
  }, [vods])

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
        await invoke('open_vod_folder', { path: settings.vodPath || '' })
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

      {vods.length === 0 ? (
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
                  <div className="rt-card-thumb-placeholder" />
                )}
                <span className="rt-card-duration">{formatDuration(vod.duration)}</span>
                {vod.pendingMatch && <span className="rt-card-badge pending">{t(lang, 'pendingBadge')}</span>}
                {vod.hasVideo && <span className="rt-card-badge video" title="Video recorded">â–¶</span>}
                {vod.result === 'win' && <span className="rt-card-badge win">W</span>}
                {vod.result === 'loss' && <span className="rt-card-badge loss">L</span>}
              </div>
              <div className="rt-card-info">
                <div className="rt-card-champ">
                  {vod.championIcon && <img className="rt-card-champ-icon" src={vod.championIcon} alt="" />}
                  <span className="rt-card-champ-name">{vod.champion || 'â€”'}</span>
                </div>
                <div className="rt-card-meta">
                  <span className="rt-card-kda">{vod.kda || 'â€”'}</span>
                  <span className="rt-card-date">{formatDate(vod.date)}</span>
                </div>
                <div className="rt-card-queue">{vod.queue || ''}</div>
              </div>
            </div>
          ))}
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
          <button className="rt-context-item rt-context-danger" onClick={() => { deleteVod(contextMenu.vod.id); setContextMenu(null) }}>
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

