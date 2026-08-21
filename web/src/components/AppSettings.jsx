import { useState, useEffect } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import LangSwitcher from './LangSwitcher.jsx'
import DiscordButton from './DiscordButton.jsx'
import { t } from '../i18n.js'
import {
  isTauri, getCloseBehavior, setCloseBehavior,
  isAutostartEnabled, toggleAutostart,
  getFfmpegPath, setFfmpegPath, testFfmpeg,
  getRecordingsFolder, setRecordingsFolder, selectRecordingsFolder, selectFfmpegFile,
  getAutoRecord, setAutoRecord, openVodFolder,
} from '../tauri.js'

export default function AppSettings({ theme, onThemeChange, lang, onLangChange, onClose }) {
  const [closeBehavior, setCloseBehaviorState] = useState('tray')
  const [autostart, setAutostart] = useState(false)
  const [ffmpegPath, setFfmpegPathState] = useState('')
  const [recordingsFolder, setRecordingsFolderState] = useState('')
  const [autoRecord, setAutoRecordState] = useState(false)
  const [ffmpegTest, setFfmpegTest] = useState(null)
  const [confirmPopup, setConfirmPopup] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    getCloseBehavior().then(setCloseBehaviorState)
    isAutostartEnabled().then(setAutostart)
    getFfmpegPath().then(setFfmpegPathState)
    getRecordingsFolder().then(setRecordingsFolderState)
    getAutoRecord().then(setAutoRecordState)
  }, [])

  const handleCloseBehavior = async (val) => {
    setCloseBehaviorState(val)
    await setCloseBehavior(val)
  }

  const handleAutostart = async () => {
    const next = !autostart
    setAutostart(next)
    await toggleAutostart(next)
  }

  const handleBrowseFfmpeg = async () => {
    const selected = await selectFfmpegFile()
    if (selected) {
      setFfmpegPathState(selected)
      await setFfmpegPath(selected)
      setFfmpegTest(null)
    }
  }

  const handleTestFfmpeg = async () => {
    if (!ffmpegPath) return
    setFfmpegTest(null)
    const ok = await testFfmpeg(ffmpegPath)
    setFfmpegTest(ok)
  }

  const handleBrowseRecordings = async () => {
    const folder = await selectRecordingsFolder()
    if (folder) {
      setRecordingsFolderState(folder)
      await setRecordingsFolder(folder)
    }
  }

  const handleAutoRecordToggle = () => {
    if (autoRecord) {
      setAutoRecordState(false)
      setAutoRecord(false)
    } else {
      setConfirmPopup(true)
    }
  }

  const handleConfirmAutoRecord = async () => {
    setAutoRecordState(true)
    await setAutoRecord(true)
    setConfirmPopup(false)
  }

  return (
    <div className="rt-settings-overlay" onClick={onClose}>
      <div className="rt-settings-panel app-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rt-settings-header">
          <h3>{t(lang, 'settings')}</h3>
          <div className="rt-settings-header-actions">
            <DiscordButton lang={lang} />
            <button className="rt-settings-close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="rt-settings-body">
          <div className="rt-setting-group">
            <label className="rt-setting-label">{t(lang, 'theme')}</label>
            <div className="rt-toggle-row">
              <ThemeToggle theme={theme} onChange={onThemeChange} />
              <span className="rt-setting-desc">
                {theme === 'light' ? t(lang, 'themeLight') : t(lang, 'themeDark')}
              </span>
            </div>
          </div>

          <div className="rt-setting-group">
            <label className="rt-setting-label">{t(lang, 'language')}</label>
            <LangSwitcher lang={lang} onChange={onLangChange} />
          </div>

          {isTauri() && (
            <>
              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'closeBehavior')}</label>
                <select
                  className="rt-setting-select"
                  value={closeBehavior}
                  onChange={(e) => handleCloseBehavior(e.target.value)}
                >
                  <option value="tray">{t(lang, 'closeBehaviorTray')}</option>
                  <option value="close">{t(lang, 'closeBehaviorClose')}</option>
                </select>
              </div>

              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'autostart')}</label>
                <div className="rt-toggle-row">
                  <button
                    className={`rt-toggle ${autostart ? 'on' : ''}`}
                    onClick={handleAutostart}
                  >
                    <span className="rt-toggle-knob" />
                  </button>
                  <span className="rt-setting-desc">{t(lang, 'autostartDesc')}</span>
                </div>
              </div>

              <div className="rt-setting-divider" />

              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'recording')}</label>
              </div>

              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'autoRecord')}</label>
                <div className="rt-toggle-row">
                  <button
                    className={`rt-toggle ${autoRecord ? 'on' : ''}`}
                    onClick={handleAutoRecordToggle}
                  >
                    <span className="rt-toggle-knob" />
                  </button>
                  <span className="rt-setting-desc">{t(lang, 'autoRecordDesc')}</span>
                </div>
              </div>

              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'ffmpegPath')}</label>
                <span className="rt-setting-desc">{t(lang, 'ffmpegPathDesc')}</span>
                <div className="rt-input-row">
                  <input
                    className="rt-setting-input"
                    type="text"
                    value={ffmpegPath}
                    onChange={(e) => { setFfmpegPathState(e.target.value); setFfmpegPath(e.target.value); setFfmpegTest(null) }}
                    placeholder="C:\ffmpeg\bin\ffmpeg.exe"
                  />
                  <button className="rt-btn rt-btn-ghost rt-btn-sm" onClick={handleBrowseFfmpeg}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  <button
                    className={`rt-btn rt-btn-ghost rt-btn-sm ${ffmpegTest === true ? 'rt-btn-success' : ffmpegTest === false ? 'rt-btn-danger' : ''}`}
                    onClick={handleTestFfmpeg}
                    title={t(lang, 'testFfmpeg')}
                  >
                    {ffmpegTest === true ? '✓' : ffmpegTest === false ? '✗' : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                </div>
                {ffmpegTest === true && <span className="rt-setting-hint ok">{t(lang, 'ffmpegFound')}</span>}
                {ffmpegTest === false && <span className="rt-setting-hint err">{t(lang, 'ffmpegNotFound')}</span>}
              </div>

              <div className="rt-setting-group">
                <label className="rt-setting-label">{t(lang, 'recordingsFolder')}</label>
                <span className="rt-setting-desc">{t(lang, 'recordingsFolderDesc')}</span>
                <div className="rt-input-row">
                  <input
                    className="rt-setting-input"
                    type="text"
                    value={recordingsFolder}
                    readOnly
                  />
                  <button className="rt-btn rt-btn-ghost rt-btn-sm" onClick={handleBrowseRecordings}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  <button className="rt-btn rt-btn-ghost rt-btn-sm" onClick={() => openVodFolder(recordingsFolder)} title={t(lang, 'openFolder')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          )}

          {!isTauri() && (
            <div className="rt-setting-group">
              <div className="rt-web-notice">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>{t(lang, 'desktopOnlyFeatures')}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rt-settings-footer">
          <button className="rt-btn rt-btn-primary" onClick={onClose}>{t(lang, 'close')}</button>
        </div>
      </div>

      {confirmPopup && (
        <div className="neon-confirm-overlay" onClick={() => setConfirmPopup(false)}>
          <div className="neon-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="neon-confirm-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
            </div>
            <h4 className="neon-confirm-title">{t(lang, 'confirmAutoRecord')}</h4>
            <p className="neon-confirm-text">{t(lang, 'confirmAutoRecordDesc')}</p>
            <div className="neon-confirm-actions">
              <button className="neon-confirm-btn neon-confirm-btn-yes" onClick={handleConfirmAutoRecord}>
                {t(lang, 'yes')}
              </button>
              <button className="neon-confirm-btn neon-confirm-btn-no" onClick={() => setConfirmPopup(false)}>
                {t(lang, 'no')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
