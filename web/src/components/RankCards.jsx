import Img from './Img.jsx'
import { t } from '../i18n.js'

function RankCard({ label, tier, division, lp, wins, losses, rankIcon, lang }) {
  const isUnranked = !tier || tier === 'UNRANKED'
  const total = wins + losses
  const wr = total > 0 ? Math.round((wins / total) * 100) : 0

  return (
    <div className={`rank-card ${isUnranked ? 'unranked' : ''}`}>
      <div className="rank-card-header">
        <span className="rank-card-label">{label}</span>
      </div>
      <div className="rank-card-body">
        {!isUnranked ? (
          <>
            <div className="rank-card-icon-wrap">
              <Img
                className="rank-card-icon"
                src={rankIcon || `/assets/ranks/${tier.toLowerCase()}.png`}
                alt={tier}
              />
            </div>
            <div className="rank-card-info">
              <div className="rank-card-tier">
                {tier} {division}
              </div>
              <div className="rank-card-lp">{lp} {t(lang, 'lp')}</div>
              <div className="rank-card-record">
                <span className="rank-card-wins">{wins}{t(lang, 'wins')}</span>
                <span className="rank-card-sep">/</span>
                <span className="rank-card-losses">{losses}{t(lang, 'losses')}</span>
                <span className="rank-card-wr">{wr}%</span>
              </div>
              <div className="rank-card-bar">
                <div
                  className="rank-card-bar-fill"
                  style={{ width: `${wr}%` }}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="rank-card-unranked">
            {t(lang, 'unranked')}
          </div>
        )}
      </div>
    </div>
  )
}

export default function RankCards({ summoner, lang }) {
  return (
    <div className="rank-cards">
      <RankCard
        label={t(lang, 'soloDuo')}
        tier={summoner.tier}
        division={summoner.division}
        lp={summoner.lp}
        wins={summoner.wins}
        losses={summoner.losses}
        rankIcon={summoner.rank_icon}
        lang={lang}
      />
      <RankCard
        label={t(lang, 'flex')}
        tier={summoner.flex_tier}
        division={summoner.flex_division}
        lp={summoner.flex_lp}
        wins={summoner.flex_wins}
        losses={summoner.flex_losses}
        lang={lang}
      />
    </div>
  )
}
