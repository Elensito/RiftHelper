import { useState, useEffect, useRef } from 'react'
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
  getAudioMode, setAudioMode,
  getMuteMic, setMuteMic,
  listAudioOutputs, getAudioOutputDevice, setAudioOutputDevice,
  getRecordingFps, setRecordingFps,
  getRecordingQuality, setRecordingQuality,
  downloadFfmpeg, onFfmpegProgress,
} from '../tauri.js'

const SECTION_ICONS = {
  appearance: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a7 7 0 0 0 0 14" />
      <path d="M12 2v20" />
    </svg>
  ),
  recording: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  ),
  audio: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  system: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  storage: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
}

function Section({ icon, title, children }) {
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <span className="settings-section-icon">{SECTION_ICONS[icon]}</span>
        <h4 className="settings-section-title">{title}</h4>
        <span className="settings-section-line" />
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

function Row({ label, desc, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {desc && <span className="settings-row-desc">{desc}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export default function AppSettings({ theme, onThemeChange, lang, onLangChange, onClose }) {
  const [closeBehavior, setCloseBehaviorState] = useState('tray')
  const [autostart, setAutostart] = useState(false)
  const [ffmpegPath, setFfmpegPathState] = useState('')
  const [recordingsFolder, setRecordingsFolderState] = useState('')
  const [autoRecord, setAutoRecordState] = useState(false)
  const [audioMode, setAudioModeState] = useState('game')
  const [muteMic, setMuteMicState] = useState(false)
  const [audioOutputs, setAudioOutputs] = useState([])
  const [audioOutputDevice, setAudioOutputDeviceState] = useState('')
  const [recordingFps, setRecordingFpsState] = useState('30')
  const [recordingQuality, setRecordingQualityState] = useState('720p')
  const [ffmpegTest, setFfmpegTest] = useState(null)
  const [confirmPopup, setConfirmPopup] = useState(false)
  const [downloadState, setDownloadState] = useState('confirm')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [downloadedMB, setDownloadedMB] = useState(0)
  const [totalMB, setTotalMB] = useState(0)
  const [appVersion, setAppVersion] = useState('')
  const unlistenRef = useRef(null)

  useEffect(() => {
    if (!isTauri()) return
    import('@tauri-apps/api/app').then(({ getVersion }) => {
      getVersion().then(setAppVersion).catch(() => {})
    }).catch(() => {})
    getCloseBehavior().then(setCloseBehaviorState)
    isAutostartEnabled().then(setAutostart)
    getFfmpegPath().then(setFfmpegPathState)
    getRecordingsFolder().then(setRecordingsFolderState)
    getAutoRecord().then(setAutoRecordState)
    getAudioMode().then(setAudioModeState)
    getMuteMic().then(setMuteMicState)
    getAudioOutputDevice().then(setAudioOutputDeviceState)
    getRecordingFps().then(setRecordingFpsState)
    getRecordingQuality().then(setRecordingQualityState)
    listAudioOutputs().then(setAudioOutputs)
  }, [])

  useEffect(() => {
    return () => {
      if (unlistenRef.current) unlistenRef.current()
    }
  }, [])

  const refreshAudioOutputs = async () => {
    const devices = await listAudioOutputs()
    setAudioOutputs(devices)
  }

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

  const handleAudioMode = async (mode) => {
    setAudioModeState(mode)
    await setAudioMode(mode)
    if (mode === 'system') refreshAudioOutputs()
  }

  const handleMuteMic = async () => {
    const next = !muteMic
    setMuteMicState(next)
    await setMuteMic(next)
  }

  const handleAudioOutputDevice = async (id) => {
    setAudioOutputDeviceState(id)
    await setAudioOutputDevice(id)
  }

  const handleRecordingFps = async (fps) => {
    setRecordingFpsState(fps)
    await setRecordingFps(fps)
  }

  const handleRecordingQuality = async (quality) => {
    setRecordingQualityState(quality)
    await setRecordingQuality(quality)
  }

  const handleConfirmAutoRecord = async () => {
    setDownloadState('downloading')
    setDownloadPercent(0)
    setDownloadedMB(0)
    setTotalMB(0)

    const unlisten = await onFfmpegProgress((payload) => {
      setDownloadPercent(Math.round(payload.percent))
      setDownloadedMB(Math.round((payload.downloaded / (1024 * 1024)) * 10) / 10)
      setTotalMB(Math.round((payload.total / (1024 * 1024)) * 10) / 10)
      if (payload.stage === 'extracting') setDownloadState('extracting')
      if (payload.stage === 'done') {
        setDownloadState('done')
        if (unlistenRef.current) unlistenRef.current()
        setTimeout(() => {
          setConfirmPopup(false)
          setDownloadState('confirm')
          setAutoRecordState(true)
          setAutoRecord(true)
          getFfmpegPath().then(setFfmpegPathState)
          setFfmpegTest(true)
        }, 1200)
      }
    })
    unlistenRef.current = unlisten

    try {
      const result = await downloadFfmpeg()
      if (!result) {
        setDownloadState('error')
        if (unlisten) unlisten()
      }
    } catch {
      setDownloadState('error')
      if (unlisten) unlisten()
    }
  }

  const selectedModeDesc =
    audioMode === 'system' ? t(lang, 'audioModeSystemDesc')
      : audioMode === 'game_discord' ? t(lang, 'audioModeDiscordDesc')
        : t(lang, 'audioModeGameDesc')

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

        <div className="app-settings-scroll">
          <Section icon="appearance" title={t(lang, 'settingsAppearance')}>
            <Row label={t(lang, 'theme')}>
              <ThemeToggle theme={theme} onChange={onThemeChange} />
            </Row>
            <Row label={t(lang, 'language')}>
              <LangSwitcher lang={lang} onChange={onLangChange} />
            </Row>
          </Section>

          {isTauri() ? (
            <>
              <Section icon="recording" title={t(lang, 'settingsRecording')}>
                <Row label={t(lang, 'autoRecord')} desc={t(lang, 'autoRecordDesc')}>
                  <button
                    className={`rt-toggle ${autoRecord ? 'on' : ''}`}
                    onClick={handleAutoRecordToggle}
                  >
                    <span className="rt-toggle-knob" />
                  </button>
                </Row>
                <div className="settings-row settings-row-block">
                  <span className="settings-row-label">{t(lang, 'ffmpegPath')}</span>
                  <span className="settings-row-desc">{t(lang, 'ffmpegPathDesc')}</span>
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
              </Section>

              <Section icon="audio" title={t(lang, 'settingsAudio')}>
                <div className="settings-row settings-row-block">
                  <span className="settings-row-label">{t(lang, 'audioMode')}</span>
                  <div className="settings-segmented">
                    {[
                      ['game', t(lang, 'audioModeGame')],
                      ['game_discord', t(lang, 'audioModeDiscord')],
                      ['system', t(lang, 'audioModeSystem')],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={`settings-segment ${audioMode === value ? 'active' : ''}`}
                        onClick={() => handleAudioMode(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="settings-row-desc">{selectedModeDesc}</span>
                </div>

                <Row label={t(lang, 'muteMic')} desc={t(lang, 'muteMicDesc')}>
                  <button
                    className={`rt-toggle ${muteMic ? 'on' : ''}`}
                    onClick={handleMuteMic}
                  >
                    <span className="rt-toggle-knob" />
                  </button>
                </Row>

                <Row label={t(lang, 'recordingQuality')} desc={t(lang, 'recordingQualityDesc')}>
                  <select
                    className="settings-recording-select"
                    value={recordingQuality}
                    onChange={(e) => handleRecordingQuality(e.target.value)}
                  >
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="1440p">1440p — Native</option>
                    <option value="4k">4K</option>
                  </select>
                </Row>

                <Row label={t(lang, 'recordingFps')} desc={t(lang, 'recordingFpsDesc')}>
                  <select
                    className="settings-recording-select"
                    value={recordingFps}
                    onChange={(e) => handleRecordingFps(e.target.value)}
                  >
                    <option value="30">30 FPS</option>
                    <option value="60">60 FPS</option>
                    <option value="120">120 FPS</option>
                  </select>
                </Row>

                {audioMode === 'system' && (
                  <>
                    <Row label={t(lang, 'audioOutput')}>
                      <div className="settings-device-row">
                        <select
                          className="rt-setting-select"
                          value={audioOutputDevice}
                          onChange={(e) => handleAudioOutputDevice(e.target.value)}
                        >
                          <option value="">{t(lang, 'audioOutputAuto')}</option>
                          {audioOutputs.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}{d.isDefault ? ' ★' : ''}</option>
                          ))}
                        </select>
                        <button
                          className="rt-btn rt-btn-ghost rt-btn-sm"
                          onClick={refreshAudioOutputs}
                          title={t(lang, 'refreshDevices')}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                        </button>
                      </div>
                    </Row>
                    <span className="settings-row-hint">{t(lang, 'audioOutputHint')}</span>
                  </>
                )}
              </Section>

              <Section icon="system" title={t(lang, 'settingsSystem')}>
                <Row label={t(lang, 'closeToTray')} desc={t(lang, 'closeToTrayDesc')}>
                  <select
                    className="rt-setting-select"
                    value={closeBehavior}
                    onChange={(e) => handleCloseBehavior(e.target.value)}
                  >
                    <option value="tray">{t(lang, 'closeBehaviorTray')}</option>
                    <option value="close">{t(lang, 'closeBehaviorClose')}</option>
                  </select>
                </Row>
                <Row label={t(lang, 'autoStart')} desc={t(lang, 'autoStartDesc')}>
                  <button
                    className={`rt-toggle ${autostart ? 'on' : ''}`}
                    onClick={handleAutostart}
                  >
                    <span className="rt-toggle-knob" />
                  </button>
                </Row>
              </Section>

              <Section icon="storage" title={t(lang, 'settingsStorage')}>
                <div className="settings-row settings-row-block">
                  <span className="settings-row-label">{t(lang, 'recordingsFolder')}</span>
                  <span className="settings-row-desc">{t(lang, 'recordingsFolderDesc')}</span>
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
              </Section>
            </>
          ) : (
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
          <span className="settings-version">RiftHelper{appVersion ? ` v${appVersion}` : ''}</span>
          <button className="rt-btn rt-btn-primary" onClick={onClose}>{t(lang, 'close')}</button>
        </div>
      </div>

      {confirmPopup && (
        <div className="neon-confirm-overlay" onClick={() => { if (downloadState === 'confirm' || downloadState === 'error') setConfirmPopup(false) }}>
          <div className="neon-confirm-card" onClick={(e) => e.stopPropagation()}>
            {downloadState === 'confirm' && (
              <>
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
              </>
            )}

            {(downloadState === 'downloading' || downloadState === 'extracting') && (
              <>
                <div className="neon-confirm-icon neon-spin">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                </div>
                <h4 className="neon-confirm-title">
                  {downloadState === 'downloading' ? t(lang, 'downloadingFfmpeg') : t(lang, 'extractingFfmpeg')}
                </h4>
                <div className="neon-progress-wrap">
                  <div className="neon-progress-bar">
                    <div className="neon-progress-fill" style={{ width: `${downloadPercent}%` }} />
                  </div>
                  <span className="neon-progress-text">
                    {downloadState === 'downloading'
                      ? `${downloadedMB} MB / ${totalMB} MB`
                      : t(lang, 'installingFfmpeg')
                    }
                  </span>
                  <span className="neon-progress-percent">{downloadPercent}%</span>
                </div>
              </>
            )}

            {downloadState === 'done' && (
              <>
                <div className="neon-confirm-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="9 12 11.5 14.5 15.5 9.5" />
                  </svg>
                </div>
                <h4 className="neon-confirm-title neon-title-success">{t(lang, 'setupComplete')}</h4>
              </>
            )}

            {downloadState === 'error' && (
              <>
                <div className="neon-confirm-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <h4 className="neon-confirm-title neon-title-error">{t(lang, 'downloadError')}</h4>
                <p className="neon-confirm-text">{t(lang, 'downloadErrorDesc')}</p>
                <div className="neon-confirm-actions">
                  <button className="neon-confirm-btn neon-confirm-btn-yes" onClick={handleConfirmAutoRecord}>
                    {t(lang, 'retry')}
                  </button>
                  <button className="neon-confirm-btn neon-confirm-btn-no" onClick={() => { setConfirmPopup(false); setDownloadState('confirm') }}>
                    {t(lang, 'cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
