import { useState } from 'react'
import Img from './Img.jsx'
import { t } from '../i18n.js'
import { isFavorite, addFavorite, removeFavorite } from '../storage.js'
import StreakChart from './StreakChart.jsx'

export default function ProfileHeader({ summoner, matches, lang, inGame = false }) {
  const wins = summoner.wins || 0
  const losses = summoner.losses || 0
  const total = wins + losses
  const wr = summoner.winrate || 0
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
    <section className="profile">
      <div className="rank-side">
        <Img className="rank-icon" src={summoner.rank_icon} alt={summoner.tier} />
      </div>

      <div className="profile-mid">
        <div className="name-row">
          <h1 className="summoner-name">{summoner.name}</h1>
          <span className="summoner-tag">#{summoner.tag}</span>
          <span className="chip region">{summoner.region}</span>
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
          </button>
          {inGame && (
            <span className="in-game-chip" title={t(lang, 'liveNow')}>
              <span className="live-dot" />
              {t(lang, 'liveNow')}
            </span>
          )}
        </div>
        <div className="tier-row">
          <span className={`tier-name tier-${summoner.tier.toLowerCase()}`}>
            {summoner.tier} {summoner.division || ''}
          </span>
          <span className="chip lp">{summoner.lp} {t(lang, 'lp')}</span>
          <span className="chip level">{t(lang, 'level')} {summoner.level}</span>
        </div>
        <div className="record">
          <span className="rec-win">{wins}{t(lang, 'wins')}</span>
          <span className="rec-sep">/</span>
          <span className="rec-loss">{losses}{t(lang, 'losses')}</span>
          <div className="wr-bar">
            <div className="wr-fill" style={{ width: `${wr}%` }} />
          </div>
          <span className="wr-text">{wr}% {t(lang, 'wr')}</span>
          <span className="rec-sep">·</span>
          <span className="rec-recent">{recent.length} {t(lang, 'recentMatches')}</span>
        </div>
      </div>

      <div className="profile-side">
        <StreakChart matches={recent} />
        <div className="picon-wrap">
          <Img className="profile-icon" src={summoner.profile_icon} alt="icon" />
          <div className="picon-ring" />
        </div>
      </div>
    </section>
  )
}
