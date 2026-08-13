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

function WrRow({ wr, matches }) {
  return (
    <span className="champ-wr-row">
      <span className="champ-wr-value">{wr}%</span>
      <span className="champ-wr-matches">({matches.toLocaleString()})</span>
    </span>
  )
}

export default function ChampionPage({ champ, lang, onOpenPlayer }) {
  if (!champ) return null

  if (!champ.available) {
    return (
      <section className="champ-page">
        <div className="champ-head">
          <Img className="champ-splash" src={champ.image} alt={champ.name} />
          <div className="champ-head-meta">
            <h1 className="champ-name">{champ.name}</h1>
            <div className="champ-role" />
          </div>
        </div>
        <div className="champ-empty-block">{t(lang, 'champNoData')}</div>
      </section>
    )
  }

  const isReal = true
  const matchups = champ.matchups || champ.toughest_matchups || []

  const runePages = isReal
    ? (champ.runes_pages || []).slice(0, 10)
    : [{ ...(champ.runes || {}), wr: champ.runes_winrate, matches: champ.runes_matches }]

  const builds = isReal ? (champ.builds || []).slice(0, 10) : []
  const finalBuilds = isReal ? (champ.final_builds || []).slice(0, 5) : []
  const startItems = isReal
    ? (champ.starting_items || []).slice(0, 5)
    : champ.starting_items
      ? [{ items: champ.starting_items }]
      : []

  const skills = isReal ? (champ.skills || []).slice(0, 5) : []
  const skillPaths = isReal ? (champ.skill_paths || []).slice(0, 5) : []
  const spells = isReal ? (champ.spells || []).slice(0, 5) : []

  const coreItems = isReal
    ? (finalBuilds[0]?.items || [])
    : champ.core_items || []

  return (
    <section className="champ-page">
      <div className="champ-head">
        <Img className="champ-splash" src={champ.image} alt={champ.name} />
        <div className="champ-head-meta">
          <h1 className="champ-name">{champ.name}</h1>
          <div className="champ-role">
            <span className="chip region">{t(lang, champ.role || 'other')}</span>
            <span className="champ-tier tier-s">{t(lang, 'tier')}: {champ.tier}</span>
            {champ.patch && <span className="chip">Patch {champ.patch}</span>}
          </div>
          <div className="champ-stats">
            <Stat label={t(lang, 'wr')} value={`${champ.winrate}%`} />
            <Stat label={t(lang, 'pickRate')} value={`${champ.pick_rate}%`} />
            <Stat label={t(lang, 'banRate')} value={`${champ.ban_rate}%`} />
            <Stat label={t(lang, 'rank')} value={champ.rank ? `${champ.rank} / 61` : '—'} />
            <Stat label={t(lang, 'matches')} value={champ.matches.toLocaleString()} />
          </div>
        </div>
      </div>

      <div className="champ-grid">
        <div className="champ-card">
          <h3>{t(lang, 'buildRunes')}</h3>
          {runePages.length === 0 && <div className="champ-empty">{t(lang, 'noData')}</div>}
          {runePages.map((rp, i) => (
            <div className="champ-runes" key={i}>
              <div className="champ-runes-row">
                <span className="chip region">{t(lang, 'keystone')}</span>
                <span className="champ-rune-name">{rp.keystone}</span>
                <WrRow wr={rp.wr} matches={rp.matches} />
              </div>
              <div className="champ-runes-row">
                <span className="chip">{t(lang, 'primaryTree')}</span>
                <span className="champ-rune-name">{(rp.primary || []).join(' · ')}</span>
              </div>
              <div className="champ-runes-row">
                <span className="chip">{t(lang, 'secondaryTree')}</span>
                <span className="champ-rune-name">{(rp.secondary || []).join(' · ')}</span>
              </div>
              <div className="champ-runes-row">
                <span className="chip">{t(lang, 'shards')}</span>
                <span className="champ-rune-name">{(rp.shards || []).join(' · ')}</span>
              </div>
              {i < runePages.length - 1 && <div className="champ-sep" />}
            </div>
          ))}
        </div>

        <div className="champ-card">
          <h3>{t(lang, 'buildCoreItems')}</h3>
          <div className="champ-items">
            {coreItems.length > 0 && (
              <div className="champ-items-row">
                <span className="chip">{t(lang, 'coreItems')}</span>
                <span className="champ-item-name">{coreItems.join(' · ')}</span>
              </div>
            )}
            {startItems.map((si, i) => (
              <div className="champ-items-row" key={i}>
                <span className="chip">{t(lang, 'startingItems')}</span>
                <span className="champ-item-name">{(si.items || []).join(' · ')}</span>
                {si.wr != null && <WrRow wr={si.wr} matches={si.matches} />}
              </div>
            ))}
          </div>
          {isReal && builds.length > 0 && (
            <>
              <h3 className="champ-subhead">{t(lang, 'buildOrder')}</h3>
              {builds.map((b, i) => (
                <div className="champ-items-row" key={i}>
                  <span className="chip">#{i + 1}</span>
                  <span className="champ-item-name">{(b.items || []).join(' · ')}</span>
                  <WrRow wr={b.wr} matches={b.matches} />
                </div>
              ))}
            </>
          )}
        </div>

        <div className="champ-card">
          <h3>{t(lang, 'skillPriority')}</h3>
          <div className="champ-items">
            {skills.map((s, i) => (
              <div className="champ-items-row" key={i}>
                <span className="chip">Max</span>
                <span className="champ-item-name">{s.max}</span>
                <WrRow wr={s.wr} matches={s.matches} />
              </div>
            ))}
            {skillPaths.map((s, i) => (
              <div className="champ-items-row" key={`p${i}`}>
                <span className="chip">{t(lang, 'skillPath')}</span>
                <span className="champ-item-name">{s.path}</span>
                <WrRow wr={s.wr} matches={s.matches} />
              </div>
            ))}
            {!isReal && champ.skill_priority && (
              <div className="champ-items-row">
                <span className="chip">{t(lang, 'priority')}</span>
                <span className="champ-item-name">{champ.skill_priority}</span>
              </div>
            )}
            {!isReal && champ.skill_path && (
              <div className="champ-items-row">
                <span className="chip">{t(lang, 'skillPath')}</span>
                <span className="champ-item-name">{champ.skill_path}</span>
              </div>
            )}
          </div>
          <h3 className="champ-subhead">{t(lang, 'buildSpells')}</h3>
          <div className="champ-items">
            {(spells.length
              ? spells
              : champ.summoner_spells
                ? [{ spells: champ.summoner_spells }]
                : []
            ).map((s, i) => (
              <div className="champ-items-row" key={i}>
                <span className="chip">{t(lang, 'summonerSpells')}</span>
                <span className="champ-item-name">{(s.spells || []).join(' + ')}</span>
                <WrRow wr={s.wr} matches={s.matches} />
              </div>
            ))}
          </div>
        </div>

        <div className="champ-card champ-tough">
          <h3>{t(lang, 'toughestMatchups')}</h3>
          <div className="champ-tough-list">
            {matchups.map((m) => (
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

      <p className="champ-test-note">
        {`${t(lang, 'realDataNote')} · ${t(lang, 'patch')} ${champ.patch} · ${champ.patch_total_matches?.toLocaleString()} ${t(lang, 'matches')}`}
      </p>
    </section>
  )
}
