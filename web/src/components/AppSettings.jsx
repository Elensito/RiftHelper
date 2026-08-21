import { useState, useEffect } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import LangSwitcher from './LangSwitcher.jsx'
import DiscordButton from './DiscordButton.jsx'
import { t } from '../i18n.js'
import { isTauri, getCloseBehavior, setCloseBehavior, isAutostartEnabled, toggleAutostart } from '../tauri.js'

export default function AppSettings({ theme, onThemeChange, lang, onLangChange, onClose }) {
  const [closeBehavior, setCloseBehaviorState] = useState('tray')
  const [autostart, setAutostart] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    getCloseBehavior().then(setCloseBehaviorState)
    isAutostartEnabled().then(setAutostart)
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
    </div>
  )
}
