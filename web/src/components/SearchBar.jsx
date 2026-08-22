import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n.js'
import { getRecent, addRecent, clearRecent } from '../storage.js'

function parseQuery(raw) {
  const idx = raw.indexOf('#')
  if (idx === -1) return null
  const name = raw.slice(0, idx).trim()
  const tag = raw.slice(idx + 1).trim().replace(/^#/, '')
  if (!name || !tag) return null
  return { name, tag }
}

export default function SearchBar({ onSearch, loading, lang, searchText, onSearchTextChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  const value = searchText != null ? searchText : query

  const recents = getRecent()

  const update = (v) => {
    if (onSearchTextChange) onSearchTextChange(v)
    else setQuery(v)
  }

  const submit = (e) => {
    e.preventDefault()
    const p = parseQuery(value)
    if (!p) return
    onSearch(p.name, p.tag)
    addRecent(p.name, p.tag)
  }

  const pickRecent = (r) => {
    update(`${r.name}#${r.tag}`)
    setOpen(false)
    onSearch(r.name, r.tag)
  }

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const hasHash = value.includes('#')
  const showHint = open && value.length > 0 && !hasHash
  const showRecent = open && !loading && recents.length > 0
  const showDrop = showRecent || showHint

  return (
    <form className="search" onSubmit={submit}>
      <div className="search-field suggest-field" ref={boxRef}>
        <input
          value={value}
          onChange={(e) => update(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={t(lang, 'placeholder')}
          spellCheck="false"
          autoComplete="off"
        />
        {showDrop && (
          <div className="suggest">
            {showHint && (
              <div className="suggest-hint">
                {t(lang, 'searchHint')}
              </div>
            )}
            {showRecent && (
              <>
                <div className="suggest-head">
                  <span>{t(lang, 'recentSearches')}</span>
                  <button
                    type="button"
                    className="suggest-clear"
                    onClick={() => {
                      clearRecent()
                      setOpen(false)
                    }}
                  >
                    {t(lang, 'clearRecent')}
                  </button>
                </div>
                {recents.map((r, i) => (
                  <button
                    type="button"
                    key={`${r.name}#${r.tag}-${i}`}
                    className="suggest-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickRecent(r)}
                  >
                    <span className="suggest-icon">⌕</span>
                    <span className="suggest-name">{r.name}</span>
                    <span className="suggest-tag">#{r.tag}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <button className="btn btn-search" type="submit" disabled={loading}>
        <span>⌕</span> {t(lang, 'search')}
      </button>
    </form>
  )
}
