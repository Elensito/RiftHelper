import Img from './Img.jsx'
import { t } from '../i18n.js'

function Stat({ label, value }) {
  return (
    <div className="champ-stat">
      <div className="champ-stat-label">{label}</div>
      <div className="champ-stat-value">{value}</div>
    </div>
  )
}

export default function ChampionPage({ champ, lang, onOpenPlayer }) {
  if (!champ) return null
  const runes = champ.runes || {}
  const tough = champ.toughest_matchups || []

  return (
    <section className="champ-page">
      <div className="champ-head">
        <Img className="champ-splash" src={champ.image} alt={champ.name} />
        <div className="champ-head-meta">
          <h1 className="champ-name">{champ.name}</h1>
          <div className="champ-role">
            <span className="chip region">{t(lang, champ.role || 'filterAll')}</span>
            <span className="champ-tier tier-s">{t(lang, 'tier')}: {champ.tier}</span>
          </div>
          <div className="champ-stats">
            <Stat label={t(lang, 'wr')} value={`${champ.winrate}%`} />
            <Stat label={t(lang, 'pickRate')} value={`${champ.pick_rate}%`} />
            <Stat label={t(lang, 'banRate')} value={`${champ.ban_rate}%`} />
            <Stat label={t(lang, 'rank')} value={`${champ.rank} / 61`} />
            <Stat label={t(lang, 'matches')} value={champ.matches.toLocaleString()} />
          </div>
        </div>
      </div>

      <div className="champ-grid">
        <div className="champ-card">
          <h3>{t(lang, 'buildRunes')}</h3>
          <div className="champ-runes">
            <div className="champ-runes-row">
              <span className="chip region">{t(lang, 'keystone')}</span>
              <span className="champ-rune-name">{runes.keystone}</span>
            </div>
            <div className="champ-runes-row">
              <span className="chip">{t(lang, 'primaryTree')}</span>
              <span className="champ-rune-name">{(runes.primary || []).slice(1).join(' · ')}</span>
            </div>
            <div className="champ-runes-row">
              <span className="chip">{t(lang, 'secondaryTree')}</span>
              <span className="champ-rune-name">{(runes.secondary || []).join(' · ')}</span>
            </div>
            <div className="champ-runes-row">
              <span className="chip">{t(lang, 'shards')}</span>
              <span className="champ-rune-name">{(runes.shards || []).join(' · ')}</span>
            </div>
          </div>
          <div className="champ-sub">
            {champ.runes_winrate}% WR ({champ.runes_matches.toLocaleString()} {t(lang, 'matches')})
          </div>
        </div>

        <div className="champ-card">
          <h3>{t(lang, 'buildCoreItems')}</h3>
          <div className="champ-items">
            <div className="champ-items-row">
              <span className="chip">{t(lang, 'startingItems')}</span>
              <span className="champ-item-name">{(champ.starting_items || []).join(' · ')}</span>
            </div>
            <div className="champ-items-row">
              <span className="chip">{t(lang, 'coreItems')}</span>
              <span className="champ-item-name">{(champ.core_items || []).join(' · ')}</span>
            </div>
            <div className="champ-items-row">
              <span className="chip">{t(lang, 'summonerSpells')}</span>
              <span className="champ-item-name">{(champ.summoner_spells || []).join(' + ')}</span>
            </div>
          </div>
        </div>

        <div className="champ-card">
          <h3>{t(lang, 'skillPriority')}</h3>
          <div className="champ-items">
            <div className="champ-items-row">
              <span className="chip">{t(lang, 'priority')}</span>
              <span className="champ-item-name">{champ.skill_priority}</span>
            </div>
            <div className="champ-items-row">
              <span className="chip">{t(lang, 'skillPath')}</span>
              <span className="champ-item-name">{champ.skill_path}</span>
            </div>
          </div>
        </div>

        <div className="champ-card champ-tough">
          <h3>{t(lang, 'toughestMatchups')}</h3>
          <div className="champ-tough-list">
            {tough.map((m) => (
              <button
                key={m.key}
                className="champ-tough-item"
                onClick={() => onOpenPlayer && onOpenPlayer(m.name, '')}
              >
                <Img className="fav-icon" src={m.image} alt={m.name} />
                <span className="champ-tough-name">{m.name}</span>
                <span className="champ-tough-wr">{m.winrate}%</span>
                <span className="champ-tough-games">{m.matches.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="champ-test-note">{t(lang, 'testDataNote')}</p>
    </section>
  )
}
