import { useState } from 'react'

export default function SearchBar({ onSearch, loading }) {
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
          placeholder="Nombre de invocador"
          autoFocus
          spellCheck="false"
        />
      </div>
      <div className="search-field tag-field">
        <span className="hash">#</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="tag"
          spellCheck="false"
        />
      </div>
      <button className="btn btn-search" type="submit" disabled={loading}>
        <span>⌕</span> Buscar
      </button>
    </form>
  )
}
