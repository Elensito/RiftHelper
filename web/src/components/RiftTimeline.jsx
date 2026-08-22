import { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '../i18n.js'
import { isTauri, showInFolder } from '../tauri.js'
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
  const [showSettings, setShowSettings] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [settings, setSettings] = useState(() => {
    const s = loadSettings()
    return {
      autoRecord: s.autoRecord ?? true,
      closeToTray: s.closeToTray ?? true,
      autoStart: s.autoStart ?? false,
      vodPath: s.vodPath ?? '',
      ...s,
    }
  })

  useEffect(() => { saveSettings(settings) }, [settings])

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
          <span className="rt-subtitle">{totalGames} {t(lang, 'vodsRecorded')} · {formatDuration(totalDuration)}</span>
        </div>
        <div className="rt-header-actions">
          <button className="rt-btn rt-btn-ghost" onClick={openFolder} title={t(lang, 'openVodFolder')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {t(lang, 'openFolder')}
          </button>
          <button className="rt-btn rt-btn-primary" onClick={() => setShowSettings(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t(lang, 'settings')}
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
                  <div className="rt-card-thumb-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                )}
                <span className="rt-card-duration">{formatDuration(vod.duration)}</span>
                {vod.hasVideo && <span className="rt-card-badge video" title="Video recorded">▶</span>}
                {vod.result === 'win' && <span className="rt-card-badge win">W</span>}
                {vod.result === 'loss' && <span className="rt-card-badge loss">L</span>}
              </div>
              <div className="rt-card-info">
                <div className="rt-card-champ">
                  {vod.championIcon && <img className="rt-card-champ-icon" src={vod.championIcon} alt="" />}
                  <span className="rt-card-champ-name">{vod.champion || '—'}</span>
                </div>
                <div className="rt-card-meta">
                  <span className="rt-card-kda">{vod.kda || '—'}</span>
                  <span className="rt-card-date">{formatDate(vod.date)}</span>
                </div>
                <div className="rt-card-queue">{vod.queue || ''}</div>
              </div>
              <button
                className="rt-card-delete"
                onClick={(e) => { e.stopPropagation(); deleteVod(vod.id) }}
                title={t(lang, 'deleteVod')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {showSettings && (
        <RiftSettings
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          lang={lang}
        />
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
          {contextMenu.vod.videoPath && (
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

function HotkeyInput({ value, onChange, lang }) {
  const [capturing, setCapturing] = useState(false)
  const [display, setDisplay] = useState(value)
  const keysRef = useRef(new Set())
  const mainKeyRef = useRef(null)
  const MAX_KEYS = 3

  const MOD_MAP = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' }

  const getMainKey = (e) => {
    const k = e.key
    if (MOD_MAP[k]) return null
    if (k === 'Escape') return null
    return k.length === 1 ? k.toUpperCase() : k
  }

  const getModifiers = (e) => {
    const mods = []
    if (e.ctrlKey) mods.push('Ctrl')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    if (e.metaKey) mods.push('Meta')
    return mods
  }

  const buildDisplay = (mods, main) => {
    const parts = [...mods]
    if (main) parts.push(main)
    return parts.join('+')
  }

  const onKey = (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      endCapture(false)
      return
    }

    if (e.type === 'keydown') {
      const mod = MOD_MAP[e.key]
      if (mod) {
        keysRef.current.add(mod)
      } else {
        const main = getMainKey(e)
        if (main) {
          mainKeyRef.current = main
          keysRef.current.add(main)
        }
      }
    } else if (e.type === 'keyup') {
      const mod = MOD_MAP[e.key]
      if (mod) {
        keysRef.current.delete(mod)
      } else {
        const main = getMainKey(e)
        if (main && mainKeyRef.current === main) {
          keysRef.current.delete(main)
          mainKeyRef.current = null
        }
      }
    }

    const mods = [...keysRef.current].filter(k => k in MOD_MAP)
    const main = mainKeyRef.current
    setDisplay(buildDisplay(mods, main))
  }

  const endCapture = (save) => {
    setCapturing(false)
    if (save && keysRef.current.size > 0) {
      const mods = [...keysRef.current].filter(k => k in MOD_MAP)
      const main = mainKeyRef.current
      if (mods.length > 0 || main) {
        onChange(buildDisplay(mods, main))
      }
    }
    keysRef.current.clear()
    mainKeyRef.current = null
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
  }

  const startCapture = () => {
    keysRef.current.clear()
    mainKeyRef.current = null
    setCapturing(true)
    setDisplay('')
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
  }

  useEffect(() => {
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  const placeholder = lang === 'es'
    ? 'Pulsa las teclas...'
    : lang === 'pt'
    ? 'Pressione as teclas...'
    : lang === 'fr'
    ? 'Appuyez sur les touches...'
    : lang === 'ko'
    ? '키를 누르세요...'
    : 'Press keys...'

  return (
    <div
      className={`rt-hotkey-wrap ${capturing ? 'capturing' : ''}`}
      onClick={() => { if (!capturing) startCapture() }}
      onBlur={() => endCapture(true)}
      tabIndex={0}
    >
      {capturing ? (
        <span className="rt-hotkey-placeholder">{placeholder}</span>
      ) : (
        <span className="rt-hotkey-value">{display || value}</span>
      )}
      {capturing && <span className="rt-hotkey-pulse" />}
    </div>
  )
}

function RiftSettings({ settings, onChange, onClose, lang }) {
  const [local, setLocal] = useState({ ...settings })

  const apply = async () => {
    if (isTauri() && local.autoStart !== undefined) {
      try {
        const { toggleAutostart } = await import('../tauri.js')
        await toggleAutostart(local.autoStart)
      } catch {}
    }
    onChange(local)
    onClose()
  }

  const pickFolder = async () => {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const path = await invoke('select_vod_folder')
        if (path) setLocal(s => ({ ...s, vodPath: path }))
      } catch {}
    }
  }

  return (
    <div className="rt-settings-overlay" onClick={onClose}>
      <div className="rt-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rt-settings-header">
          <h3>{t(lang, 'riftTimelineSettings')}</h3>
          <button className="rt-settings-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="rt-settings-body">
          <div className="rt-setting-group">
            <label className="rt-setting-label">{t(lang, 'autoRecord')}</label>
            <div className="rt-toggle-row">
              <button
                className={`rt-toggle ${local.autoRecord ? 'on' : ''}`}
                onClick={() => setLocal(s => ({ ...s, autoRecord: !s.autoRecord }))}
              >
                <span className="rt-toggle-knob" />
              </button>
              <span className="rt-setting-desc">{t(lang, 'autoRecordDesc')}</span>
            </div>
          </div>

          {isTauri() && (
            <>
              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'closeToTray')}</label>
                <div className="rt-toggle-row">
                  <button
                    className={`rt-toggle ${local.closeToTray ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, closeToTray: !s.closeToTray }))}
                  >
                    <span className="rt-toggle-knob" />
                  </button>
                  <span className="rt-setting-desc">{t(lang, 'closeToTrayDesc')}</span>
                </div>
              </div>

              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'autoStart')}</label>
                <div className="rt-toggle-row">
                  <button
                    className={`rt-toggle ${local.autoStart ? 'on' : ''}`}
                    onClick={() => setLocal(s => ({ ...s, autoStart: !s.autoStart }))}
                  >
                    <span className="rt-toggle-knob" />
                  </button>
                  <span className="rt-setting-desc">{t(lang, 'autoStartDesc')}</span>
                </div>
              </div>
            </>
          )}

          <div className="rt-setting-group">
            <label className="rt-setting-label">{t(lang, 'vodSavePath')}</label>
            <div className="rt-path-row">
              <input
                className="rt-input rt-input-grow"
                type="text"
                value={local.vodPath}
                onChange={(e) => setLocal(s => ({ ...s, vodPath: e.target.value }))}
                placeholder={t(lang, 'vodPathPlaceholder')}
              />
              {isTauri() && (
                <button className="rt-btn rt-btn-ghost rt-btn-sm" onClick={pickFolder}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  {t(lang, 'browse')}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="rt-settings-footer">
          <button className="rt-btn rt-btn-ghost" onClick={onClose}>{t(lang, 'cancel')}</button>
          <button className="rt-btn rt-btn-primary" onClick={apply}>{t(lang, 'save')}</button>
        </div>
      </div>
    </div>
  )
}
