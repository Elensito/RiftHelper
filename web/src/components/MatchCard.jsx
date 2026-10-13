import { lazy, Suspense, useState } from 'react'
import Img from './Img.jsx'
import { fmtNum, kdaRatio, sortPlayers, timeAgo } from '../utils.js'
import { accoladeColor, accoladeDescription, accoladeTitle, queueLabel, t } from '../i18n.js'
import PlayerRow from './PlayerRow.jsx'

const MatchMetrics = lazy(() => import('./MatchMetrics.jsx'))
const MatchBuild = lazy(() => import('./MatchBuild.jsx'))

const ARENA_QUEUES = [1700, 1710, 1740, 1750]

function fallbackAccolades(players) {
  if (!players?.length) return players

  const teamKills = new Map()
  const teamGold = new Map()
  for (const player of players) {
    teamKills.set(player.team, (teamKills.get(player.team) || 0) + (player.kills || 0))
    teamGold.set(player.team, (teamGold.get(player.team) || 0) + (player.gold || 0))
  }

  const metrics = players.map((player) => ({
    kda: ((player.kills || 0) + (player.assists || 0)) / Math.max(1, player.deaths || 0),
    gold_share: (player.gold || 0) / Math.max(1, teamGold.get(player.team) || 0),
    damage: player.damage || 0,
    vision: player.vision || 0,
    cs_min: player.cs_per_min || 0,
    gold: player.gold || 0,
    kills: player.kills || 0,
    assists: player.assists || 0,
    deaths: player.deaths || 0,
    kp: ((player.kills || 0) + (player.assists || 0)) / Math.max(1, teamKills.get(player.team) || 0),
  }))
  const rules = [
    ['kda_beast', 'kda', 'max', 'positive'], ['team_carry', 'gold_share', 'max', 'positive'],
    ['damage_dealer', 'damage', 'max', 'positive'], ['visionary', 'vision', 'max', 'positive'],
    ['cs_machine', 'cs_min', 'max', 'positive'], ['gold_hoarder', 'gold', 'max', 'positive'],
    ['kill_securer', 'kills', 'max', 'positive'], ['assist_king', 'assists', 'max', 'positive'],
    ['untouchable', 'deaths', 'min', 'positive'], ['teamfight_presence', 'kp', 'max', 'positive'],
    ['death_magnet', 'deaths', 'max', 'negative'], ['low_kda', 'kda', 'min', 'negative'],
    ['low_damage', 'damage', 'min', 'negative'], ['low_vision', 'vision', 'min', 'negative'],
    ['farm_behind', 'cs_min', 'min', 'negative'], ['low_participation', 'kp', 'min', 'negative'],
    ['gold_starved', 'gold_share', 'min', 'negative'],
  ]

  const accolades = players.map(() => [])
  for (const [key, metric, direction, polarity] of rules) {
    const values = metrics.map((entry) => entry[metric])
    if (Math.max(...values) <= 0) continue
    const extreme = direction === 'max' ? Math.max(...values) : Math.min(...values)
    players.forEach((_, index) => {
      if (values[index] !== extreme) return
      const rank = direction === 'max'
        ? 1 + values.filter((value) => value > extreme).length
        : 1 + values.filter((value) => value < extreme).length
      accolades[index].push({ key, metric, direction, value: Number(values[index].toFixed(2)), rank, polarity })
    })
  }
  return players.map((player, index) => ({
    ...player,
    accolades: player.accolades?.length ? player.accolades : accolades[index],
  }))
}

function playerAccolades(player, players) {
  const metrics = [
    ['kda', ((player.kills || 0) + (player.assists || 0)) / Math.max(1, player.deaths || 0)],
    ['damage', player.damage || 0],
    ['vision', player.vision || 0],
    ['cs_min', player.cs_per_min || 0],
  ]
  const source = player.accolades?.length ? player.accolades : []
  const awards = [...source]
  if (!awards.length) {
    for (const [metric, value] of metrics) {
      const values = players.map((entry) => {
        if (metric === 'kda') return ((entry.kills || 0) + (entry.assists || 0)) / Math.max(1, entry.deaths || 0)
        return entry[metric === 'cs_min' ? 'cs_per_min' : metric] || 0
      })
      const rank = 1 + values.filter((other) => other > value).length
      const key = metric === 'kda' ? 'kda_beast' : metric === 'damage' ? 'damage_dealer' : metric === 'vision' ? 'visionary' : 'cs_machine'
      awards.push({ key, metric, direction: 'max', value, rank, polarity: 'positive' })
    }
  }

  const unique = [...new Map(awards.map((award) => [award.key, award])).values()]
  return unique
    .sort((a, b) => a.rank - b.rank || Number(b.polarity === 'positive') - Number(a.polarity === 'positive'))
    .slice(0, 3)
}

function accoladeValue(award) {
  const value = Number(award.value)
  if (award.metric === 'teamfight_presence' || award.metric === 'gold_share') return `${(value * 100).toFixed(1)}%`
  if (award.metric === 'cs_min') return `${value.toFixed(1)} CS/min`
  return Number.isInteger(value) ? new Intl.NumberFormat().format(value) : value.toFixed(2)
}

function AccoladePanel({ players, lang }) {
  const matchPlayers = fallbackAccolades(players).map((player, _, allPlayers) => ({
    ...player,
    accolades: playerAccolades(player, allPlayers),
  }))
  const decorated = matchPlayers.filter((p) => p.accolades?.length)
  return (
    <section className="accolades-panel">
      <div className="accolades-heading">
        <div>
          <h3>{t(lang, 'matchAccolades')}</h3>
          <p>{t(lang, 'matchAccoladesDesc')}</p>
        </div>
        <span className="accolades-count">{decorated.length}/{matchPlayers.length}</span>
      </div>
      {decorated.length ? (
        <div className="accolades-grid">
          {decorated.map((p) => (
            <article className="accolade-player" key={p.participant_id}>
              <div className="accolade-player-head">
                <Img src={p.champion_icon} className="accolade-champion" />
                <div className="accolade-player-name">
                  <strong>{p.player_name || p.champion}</strong>
                  <span>{p.champion} · {p.kills}/{p.deaths}/{p.assists}</span>
                </div>
              </div>
              <div className="accolade-badges">
                {p.accolades.map((award) => (
                  <span
                    key={award.key}
                    className={`accolade-badge ${award.polarity}`}
                    style={{ '--accolade-color': accoladeColor(award.key) }}
                    tabIndex={0}
                    aria-describedby={`accolade-tip-${p.participant_id}-${award.key}`}
                  >
                    <span>{accoladeTitle(lang, award.key)}</span>
                    <span className="accolade-tooltip" id={`accolade-tip-${p.participant_id}-${award.key}`} role="tooltip">
                      <strong>{accoladeTitle(lang, award.key)}</strong>
                      <span>{accoladeDescription(lang, award)}</span>
                      <b>{accoladeValue(award)}</b>
                      <small>{t(lang, 'accoladePlace')}: #{award.rank}/{matchPlayers.length}</small>
                    </span>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="accolades-empty">{t(lang, 'matchAccoladesEmpty')}</p>
      )}
    </section>
  )
}

function nameOf(entry, lang) {
  if (!entry) return ''
  if (typeof entry === 'string') return entry
  return entry[lang] || entry.en || ''
}

function TeamPanel({ players, teamId, allMaxDamage, lang, onOpenPlayer }) {
  const team = sortPlayers(players.filter((p) => p.team === teamId))
  const won = team.some((p) => p.win)
  const totals = team.reduce(
    (acc, p) => {
      acc.kills += p.kills || 0
      acc.deaths += p.deaths || 0
      acc.assists += p.assists || 0
      return acc
    },
    { kills: 0, deaths: 0, assists: 0 }
  )
  return (
    <div className={`team-panel ${teamId === 100 ? 'blue' : 'red'}`}>
      <div className="team-panel-head">
        <span className="team-dot" />
        <span className="team-name">{teamId === 100 ? t(lang, 'blueTeam') : t(lang, 'redTeam')}</span>
        <span className={`team-result ${won ? 'win' : 'loss'}`}>
          {won ? t(lang, 'victory') : t(lang, 'defeat')}
        </span>
        <span className="team-kda">
          {totals.kills} <i>/</i> {totals.deaths} <i>/</i> {totals.assists}
        </span>
      </div>
      <div className="ghead">
        <span />
        <span />
        <span />
        <span />
        <span className="ghead-label">{t(lang, 'carry')}</span>
        <span className="ghead-label">{t(lang, 'kda')}</span>
        <span className="ghead-label">{t(lang, 'damage')}</span>
        <span className="ghead-label">{t(lang, 'gold')}</span>
        <span className="ghead-label">{t(lang, 'cs')}</span>
        <span className="ghead-label">{t(lang, 'visionShort')}</span>
        <span className="ghead-label ghead-build">{t(lang, 'build')}</span>
      </div>
      {team.map((p, i) => (
        <PlayerRow key={i} p={p} lang={lang} maxDamage={allMaxDamage} onOpenPlayer={onOpenPlayer} />
      ))}
    </div>
  )
}

function ArenaPanel({ players, lang, onOpenPlayer, allMaxDamage }) {
  const sorted = sortPlayers(players)
  return (
    <div className="team-panel arena-panel">
      <div className="team-panel-head">
        <span className="team-dot" />
        <span className="team-name">{t(lang, 'arenaPlayers')}</span>
      </div>
      <div className="ghead">
        <span />
        <span />
        <span />
        <span />
        <span className="ghead-label">{t(lang, 'carry')}</span>
        <span className="ghead-label">{t(lang, 'kda')}</span>
        <span className="ghead-label">{t(lang, 'damage')}</span>
        <span className="ghead-label">{t(lang, 'gold')}</span>
        <span className="ghead-label">{t(lang, 'cs')}</span>
        <span className="ghead-label">{t(lang, 'visionShort')}</span>
        <span className="ghead-label ghead-build">{t(lang, 'build')}</span>
      </div>
      {sorted.map((p, i) => (
        <PlayerRow key={i} p={p} lang={lang} maxDamage={allMaxDamage} onOpenPlayer={onOpenPlayer} />
      ))}
    </div>
  )
}

export default function MatchCard({ match, lang, puuid, onOpenPlayer }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('general')
  const pl = match.player
  const win = match.win
  const endedAt = match.created && match.duration_sec ? match.created + match.duration_sec * 1000 : match.created
  const ago = timeAgo(endedAt, lang)

  const isArena = ARENA_QUEUES.includes(match.queue)
  const teamId = pl.team

  return (
    <article className={`match ${open ? 'open' : ''}`}>
      <div className="match-head" onClick={() => setOpen(!open)}>
        <div className="m-result-group">
          <div
            className={`badge ${match.remake ? 'remake' : win ? 'win' : 'loss'}`}
            title={match.remake ? t(lang, 'remake') : ''}
          >
            {match.remake ? 'R' : win ? t(lang, 'win') : t(lang, 'loss')}
          </div>

        </div>

        <div className="m-meta">
          <span className="m-mode">{queueLabel(lang, match.queue)}</span>
          <span className="m-dur">{match.duration}</span>
          <span className="m-date">{match.date}</span>
          {ago && <span className="m-ago">{ago}</span>}
        </div>

        <div className="m-champ">
          <Img src={pl.champion_icon} className="m-champ-icon" />
          <Img
            src={pl.keystone && pl.keystone.src}
            className="m-keystone"
            title={pl.keystone && (pl.keystone[lang] || pl.keystone.en)}
          />
          <div className="m-spells">
            {(pl.spells || []).map((s, i) => (
              <Img key={i} src={s && s.src} className="m-spell" title={s && nameOf(s.name, lang)} />
            ))}
          </div>
        </div>

        <div className="m-kda">
          <span className="m-kda-line">
            {pl.kills} <i>/</i> {pl.deaths} <i>/</i> {pl.assists}
          </span>
          <span className="m-kda-ratio">{kdaRatio(pl.kills, pl.deaths, pl.assists)} {t(lang, 'kda')}</span>
        </div>

        <div className="m-stats">
          <div className="m-stat">
            <b>{pl.cs}</b>
            <span>{pl.cs_per_min}/m {t(lang, 'cs')}</span>
          </div>
          <div className="m-stat">
            <b>{fmtNum(pl.gold)}</b>
            <span>{t(lang, 'gold')}</span>
          </div>
          <div className="m-stat">
            <b>{fmtNum(pl.damage)}</b>
            <span>{t(lang, 'damage')}</span>
          </div>
          <div className="m-stat">
            <b>{pl.kp}%</b>
            <span>{t(lang, 'kp')}</span>
          </div>
        </div>

        <button
          className={`chevron ${open ? 'open' : ''}`}
          aria-label={open ? t(lang, 'hideDetails') : t(lang, 'showDetails')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="match-body">
        <div className="match-tabs">
          <button
            className={`tab ${tab === 'general' ? 'active' : ''}`}
            onClick={() => setTab('general')}
          >
            {t(lang, 'tabGeneral')}
          </button>
          <button
            className={`tab ${tab === 'metrics' ? 'active' : ''}`}
            onClick={() => setTab('metrics')}
          >
            {t(lang, 'tabMetrics')}
          </button>
          <button
            className={`tab ${tab === 'build' ? 'active' : ''}`}
            onClick={() => setTab('build')}
          >
            {t(lang, 'tabBuild')}
          </button>
        </div>

        {tab === 'general' ? (
          <div className="teams">
            {isArena ? (
              <ArenaPanel
                players={match.players}
                lang={lang}
                onOpenPlayer={onOpenPlayer}
                allMaxDamage={Math.max(...match.players.map((p) => p.damage || 0))}
              />
            ) : (
              <>
                <TeamPanel
                  players={match.players}
                  teamId={100}
                  lang={lang}
                  onOpenPlayer={onOpenPlayer}
                  allMaxDamage={Math.max(...match.players.map((p) => p.damage || 0))}
                />
                <TeamPanel
                  players={match.players}
                  teamId={200}
                  lang={lang}
                  onOpenPlayer={onOpenPlayer}
                  allMaxDamage={Math.max(...match.players.map((p) => p.damage || 0))}
                />
              </>
            )}
            <AccoladePanel players={match.players} lang={lang} />
          </div>
        ) : tab === 'metrics' ? (
          <Suspense
            fallback={
              <div className="metrics-loading">
                <div className="spinner" />
              </div>
            }
          >
            <MatchMetrics matchId={match.match_id} puuid={puuid} lang={lang} />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="metrics-loading">
                <div className="spinner" />
              </div>
            }
          >
            <MatchBuild
              matchId={match.match_id}
              puuid={puuid}
              lang={lang}
              players={match.players}
            />
          </Suspense>
        )}
      </div>
    </article>
  )
}
