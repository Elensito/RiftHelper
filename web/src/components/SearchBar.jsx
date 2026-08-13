import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n.js'
import { getRecent, addRecent, clearRecent } from '../storage.js'
import Img from './Img.jsx'

export default function SearchBar({ onSearch, onOpenChampion, loading, lang, champions = [] }) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  const recents = getRecent()

  const submit = (e) => {
    e.preventDefault()
    const n = name.trim()
    const tg = tag.trim().replace(/^#/, '')
    if (n && tg) {
      onSearch(n, tg)
      addRecent(n, tg)
    }
  }

  const pickRecent = (r) => {
    setName(r.name)
    setTag(r.tag)
    setOpen(false)
    onSearch(r.name, r.tag)
  }

  const champHits = (() => {
    const q = name.trim().toLowerCase()
    if (!q) return []
    return champions
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 5)
  })()

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const showRecent = open && !loading && recents.length > 0
  const showChamps = open && champHits.length > 0
  const showDrop = showRecent || showChamps

  return (
    <form className="search" onSubmit={submit}>
      <div className="search-field suggest-field" ref={boxRef}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={t(lang, 'placeholder')}
          autoFocus
          spellCheck="false"
          autoComplete="off"
        />
        {showDrop && (
          <div className="suggest">
            {showChamps && (
              <>
                <div className="suggest-head">
                  <span>{t(lang, 'champions')}</span>
                </div>
                {champHits.map((c) => (
                  <button
                    type="button"
                    key={c.key}
                    className="suggest-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(false)
                      onOpenChampion(c)
                    }}
                  >
                    <Img className="suggest-champ" src={c.image} alt={c.name} />
                    <span className="suggest-name">{c.name}</span>
                  </button>
                ))}
              </>
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
      <div className="search-field tag-field">
        <span className="hash">#</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder={t(lang, 'tag')}
          spellCheck="false"
          autoComplete="off"
        />
      </div>
      <button className="btn btn-search" type="submit" disabled={loading}>
        <span>⌕</span> {t(lang, 'search')}
      </button>
    </form>
  )
}
