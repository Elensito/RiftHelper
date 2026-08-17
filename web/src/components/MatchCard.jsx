import { lazy, Suspense, useState } from 'react'
import Img from './Img.jsx'
import { fmtNum, kdaRatio, sortPlayers, timeAgo } from '../utils.js'
import { queueLabel, t } from '../i18n.js'
import PlayerRow from './PlayerRow.jsx'

const MatchMetrics = lazy(() => import('./MatchMetrics.jsx'))
const MatchBuild = lazy(() => import('./MatchBuild.jsx'))

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

export default function MatchCard({ match, lang, puuid, onOpenPlayer }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('general')
  const pl = match.player
  const win = match.win

  return (
    <article className={`match ${open ? 'open' : ''}`}>
      <div className="match-head" onClick={() => setOpen(!open)}>
        <div
          className={`badge ${match.remake ? 'remake' : win ? 'win' : 'loss'}`}
          title={match.remake ? t(lang, 'remake') : ''}
        >
          {match.remake ? 'R' : win ? t(lang, 'win') : t(lang, 'loss')}
        </div>

        <div className="m-meta">
          <span className="m-mode">{queueLabel(lang, match.queue)}</span>
          <span className="m-dur">{match.duration}</span>
          <span className="m-date">{match.date}{match.created ? ` · ${timeAgo(match.created, lang)}` : ''}</span>
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
