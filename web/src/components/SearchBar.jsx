import { useState } from 'react'
import { t } from '../i18n.js'

export default function SearchBar({ onSearch, loading, lang }) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const n = name.trim()
    const t = tag.trim().replace(/^#/, '')
    if (n && t) onSearch(n, t)
  }

  return (
    <form className="search" onSubmit={submit}>
      <div className="search-field">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, 'placeholder')}
          autoFocus
          spellCheck="false"
        />
      </div>
      <div className="search-field tag-field">
        <span className="hash">#</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder={t(lang, 'tag')}
          spellCheck="false"
        />
      </div>
      <button className="btn btn-search" type="submit" disabled={loading}>
        <span>⌕</span> {t(lang, 'search')}
      </button>
    </form>
  )
}
