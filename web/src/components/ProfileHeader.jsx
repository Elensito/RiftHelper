import Img from './Img.jsx'
import { t } from '../i18n.js'

export default function ProfileHeader({ summoner, matches, lang }) {
  const wins = summoner.wins || 0
  const losses = summoner.losses || 0
  const total = wins + losses
  const wr = summoner.winrate || 0
  const recent = matches || []

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
        <Img className="profile-icon" src={summoner.profile_icon} alt="icon" />
        <div className="picon-ring" />
      </div>
    </section>
  )
}
