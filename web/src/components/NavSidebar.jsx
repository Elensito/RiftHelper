import { t } from '../i18n.js'

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

export default function NavSidebar({ open, onToggle, view, onNavigate, lang, onSettingsOpen }) {
  return (
    <>
      <button
        className={`nav-hamburger ${open ? 'nav-hamburger-open' : ''}`}
        onClick={onToggle}
        aria-label="Navigation"
      >
        <span />
        <span />
        <span />
      </button>

      <div className={`nav-backdrop ${open ? 'visible' : ''}`} onClick={onToggle} />

      <nav className={`nav-sidebar ${open ? 'open' : ''}`}>
        <div className="nav-sidebar-header">
          <div className="nav-logo-mark">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14 2L2 8v12l12 6 12-6V8L14 2z" stroke="var(--cyan)" strokeWidth="1.5" fill="none" />
              <path d="M14 2v24M2 8l12 6 12-6" stroke="var(--cyan)" strokeWidth="1" opacity="0.4" />
            </svg>
          </div>
          <span className="nav-brand-text">RiftHelper</span>
        </div>

        <div className="nav-items">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => { onNavigate(item.id); if (open) onToggle() }}
            >
              <span className="nav-item-icon">{ICONS[item.icon]}</span>
              <span className="nav-item-label">{lang === 'es' ? item.labelEs : item.label}</span>
              {view === item.id && <span className="nav-item-indicator" />}
            </button>
          ))}
        </div>

        <div className="nav-sidebar-footer">
          <button className="nav-item nav-settings-btn" onClick={() => { onSettingsOpen(); if (open) onToggle() }}>
            <span className="nav-item-icon">{ICONS.settings}</span>
            <span className="nav-item-label">{t(lang, 'settings')}</span>
          </button>
        </div>
      </nav>
    </>
  )
}
