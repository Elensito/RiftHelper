import { useState } from 'react'
import Img from './Img.jsx'
import { t } from '../i18n.js'
import { isFavorite, addFavorite, removeFavorite } from '../storage.js'
import StreakChart from './StreakChart.jsx'

export default function ProfileHeader({ summoner, matches, lang, inGame = false }) {
  const recent = matches || []
  const [fav, setFav] = useState(() => isFavorite(summoner.name, summoner.tag))
  const [copied, setCopied] = useState(false)

  const share = async () => {
    const url = `${location.origin}${location.pathname}?name=${encodeURIComponent(summoner.name)}&tag=${encodeURIComponent(summoner.tag)}`
    try {
      await navigator.clipboard.writeText(url)
    } catch (e) {
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleFav = () => {
    if (fav) {
      removeFavorite(summoner.name, summoner.tag)
      setFav(false)
    } else {
      addFavorite({
        name: summoner.name,
        tag: summoner.tag,
        region: summoner.region,
        profile_icon: summoner.profile_icon,
      })
      setFav(true)
    }
  }

  return (
    <section className="profile-header">
      <div className="profile-header-inner">
        <StreakChart matches={recent} />

        <div className="profile-header-center">
          <div className="picon-wrap">
            <Img className="profile-icon" src={summoner.profile_icon} alt="icon" />
            <div className="picon-ring" />
          </div>
          <div className="profile-identity">
            <div className="profile-name-row">
              <h1 className="summoner-name">{summoner.name}</h1>
              <span className="summoner-tag">#{summoner.tag}</span>
              <span className="chip region">{summoner.region}</span>
              {inGame && (
                <span className="in-game-chip" title={t(lang, 'liveNow')}>
                  <span className="live-dot" />
                  {t(lang, 'liveNow')}
                </span>
              )}
            </div>
            <div className="profile-actions-row">
              <button
                className={`fav-btn ${fav ? 'active' : ''}`}
                onClick={toggleFav}
                title={fav ? t(lang, 'removeFavorite') : t(lang, 'addFavorite')}
              >
                {fav ? '★' : '☆'}
              </button>
              <button
                className={`share-btn ${copied ? 'active' : ''}`}
                onClick={share}
                title={copied ? t(lang, 'shareCopied') : t(lang, 'share')}
              >
                {copied ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                )}
              </button>
              <span className="chip level">{t(lang, 'level')} {summoner.level}</span>
            </div>
          </div>
        </div>

        <div className="profile-header-filler" />
      </div>
    </section>
  )
}
