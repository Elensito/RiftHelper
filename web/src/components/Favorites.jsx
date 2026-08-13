import { useEffect, useState } from 'react'
import { getFavorites, removeFavorite } from '../storage.js'
import Img from './Img.jsx'
import { t } from '../i18n.js'

export default function Favorites({ onOpen, lang }) {
  const [favs, setFavs] = useState([])

  useEffect(() => {
    setFavs(getFavorites())
    const onStorage = (e) => {
      if (e.key && (e.key === 'rh:favorites' || e.key === null)) setFavs(getFavorites())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const del = (e, name, tag) => {
    e.stopPropagation()
    removeFavorite(name, tag)
    setFavs(getFavorites())
  }

  if (!favs || favs.length === 0) return null

  return (
    <div className="favorites">
      <h3>{t(lang, 'favorites')}</h3>
      <div className="fav-list">
        {favs.map((f) => (
          <button
            key={`${f.name}#${f.tag}`}
            className="fav-item"
            onClick={() => onOpen(f.name, f.tag)}
          >
            <Img className="fav-icon" src={f.profile_icon} alt="icon" />
            <div className="fav-meta">
              <div className="fav-name">
                {f.name}
                <span className="fav-tag">#{f.tag}</span>
              </div>
              <div className="fav-region">{f.region || ''}</div>
            </div>
            <span
              className="fav-del"
              title={t(lang, 'removeFavorite')}
              onClick={(e) => del(e, f.name, f.tag)}
            >
              ✕
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
