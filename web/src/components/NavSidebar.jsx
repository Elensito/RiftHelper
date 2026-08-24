import { useState, useRef, useCallback, useEffect } from 'react'
import { t } from '../i18n.js'
import { isTauri } from '../tauri.js'

const ICONS = {
  profile: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  timeline: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
}

const NAV_ITEMS = [
  { id: 'profile', icon: 'profile', label: 'Profile', labelEs: 'Perfil' },
  { id: 'rift-timeline', icon: 'timeline', label: 'Rift Timeline', labelEs: 'Rift Timeline' },
]

export default function NavSidebar({ view, onNavigate, lang, onSettingsOpen, riftSubTab, onSubTabChange }) {
  const [hovered, setHovered] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [hoveredNav, setHoveredNav] = useState(null)
  const sidebarRef = useRef(null)
  const triggerRef = useRef(null)
  const hoverTimerRef = useRef(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 920)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const expand = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHovered(true)
  }, [])

  const collapse = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setHovered(false), 180)
  }, [])

  useEffect(() => {
    return () => clearTimeout(hoverTimerRef.current)
  }, [])

  useEffect(() => {
    if (!isMobile) {
      document.body.classList.toggle('sidebar-expanded', hovered)
      return () => document.body.classList.remove('sidebar-expanded')
    }
  }, [hovered, isMobile])

  useEffect(() => {
    document.body.classList.toggle('sidebar-expanded', isMobile && mobileOpen)
    return () => document.body.classList.remove('sidebar-expanded')
  }, [mobileOpen, isMobile])

  const handleNav = useCallback((id) => {
    onNavigate(id)
    if (isMobile) setMobileOpen(false)
  }, [onNavigate, isMobile])

  const handleSettings = useCallback(() => {
    onSettingsOpen()
    if (isMobile) setMobileOpen(false)
  }, [onSettingsOpen, isMobile])

  const expanded = isMobile ? mobileOpen : hovered

  return (
    <>
      {isMobile && (
        <button
          className={`nav-hamburger ${mobileOpen ? 'nav-hamburger-open' : ''}`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Navigation"
        >
          <span />
          <span />
          <span />
        </button>
      )}

      <div
        className={`nav-backdrop ${isMobile && mobileOpen ? 'visible' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      <div
        ref={triggerRef}
        className="nav-hover-trigger"
        onMouseEnter={expand}
      />

      <nav
        ref={sidebarRef}
        className={`nav-sidebar ${expanded ? 'expanded' : ''}`}
        onMouseEnter={expand}
        onMouseLeave={collapse}
      >
        <div className="nav-sidebar-header">
          <img
            src="/rifthelper-avatar.png"
            alt="RiftHelper"
            className="nav-logo-img"
            draggable="false"
          />
          <span className="nav-brand-text">RiftHelper</span>
        </div>

        <div className="nav-items">
          {NAV_ITEMS.filter(item => item.id !== 'rift-timeline' || isTauri()).map((item) => (
            <div
              key={item.id}
              className="nav-item-wrap"
              onMouseEnter={() => item.id === 'rift-timeline' && setHoveredNav('rift-timeline')}
              onMouseLeave={() => item.id === 'rift-timeline' && setHoveredNav(null)}
            >
              <button
                className={`nav-item ${view === item.id ? 'active' : ''}`}
                onClick={() => {
                  if (item.id === 'rift-timeline') {
                    onNavigate(item.id)
                    onSubTabChange('recordings')
                  } else {
                    handleNav(item.id)
                  }
                }}
                title={!expanded ? (lang === 'es' ? item.labelEs : item.label) : undefined}
              >
                <span className="nav-item-icon">{ICONS[item.icon]}</span>
                <span className="nav-item-label">{lang === 'es' ? item.labelEs : item.label}</span>
                {view === item.id && <span className="nav-item-indicator" />}
              </button>
              {item.id === 'rift-timeline' && hoveredNav === 'rift-timeline' && expanded && (
                <div className="nav-submenu">
                  <button
                    className={`nav-subitem ${view === 'rift-timeline' && riftSubTab === 'recordings' ? 'active' : ''}`}
                    onClick={() => {
                      onNavigate('rift-timeline')
                      onSubTabChange('recordings')
                    }}
                  >
                    {t(lang, 'navRecordings')}
                  </button>
                  <button
                    className={`nav-subitem ${view === 'rift-timeline' && riftSubTab === 'clips' ? 'active' : ''}`}
                    onClick={() => {
                      onNavigate('rift-timeline')
                      onSubTabChange('clips')
                    }}
                  >
                    {t(lang, 'navClips')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="nav-sidebar-footer">
          <button className="nav-item nav-settings-btn" onClick={handleSettings}>
            <span className="nav-item-icon">{ICONS.settings}</span>
            <span className="nav-item-label">{t(lang, 'settings')}</span>
          </button>
        </div>
      </nav>
    </>
  )
}
