import { useEffect, useRef, useState } from 'react'
import { LANGS } from '../i18n.js'

export default function LangSwitcher({ lang, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const current = LANGS.find((l) => l.code === lang) || LANGS[0]

  return (
    <div className="lang-switcher" ref={ref}>
      <button
        className={`btn lang-current ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="lang-flag">{current.flag}</span>
        <span className="lang-code">{current.code.toUpperCase()}</span>
        <span className={`lang-caret ${open ? 'open' : ''}`}>▾</span>
      </button>

      {open && (
        <ul className="lang-menu" role="listbox">
          {LANGS.map((l) => (
            <li key={l.code}>
              <button
                className={`lang-option ${l.code === lang ? 'active' : ''}`}
                onClick={() => {
                  onChange(l.code)
                  setOpen(false)
                }}
              >
                <span className="lang-flag">{l.flag}</span>
                <span className="lang-name">{l.label}</span>
                {l.code === lang && <span className="lang-check">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
