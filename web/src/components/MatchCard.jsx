import { lazy, Suspense, useState } from 'react'
import Img from './Img.jsx'
import { fmtNum, kdaRatio, sortPlayers } from '../utils.js'
import { queueLabel, t } from '../i18n.js'
import PlayerRow from './PlayerRow.jsx'

const MatchMetrics = lazy(() => import('./MatchMetrics.jsx'))
const MatchBuild = lazy(() => import('./MatchBuild.jsx'))

function TeamColumn({ players, teamId, lang, onOpenPlayer }) {
  const team = sortPlayers(players.filter((p) => p.team === teamId))
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
    <div className={`team-col ${teamId === 100 ? 'blue' : 'red'}`}>
      <div className="team-header">
        <span className="team-dot" />
        {teamId === 100 ? t(lang, 'blueTeam') : t(lang, 'redTeam')}
        <span className="team-kda">
          {totals.kills} <i>/</i> {totals.deaths} <i>/</i> {totals.assists}
        </span>
      </div>
      {team.map((p, i) => (
        <PlayerRow key={i} p={p} lang={lang} onOpenPlayer={onOpenPlayer} />
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
        <div className={`badge ${win ? 'win' : 'loss'}`}>{win ? t(lang, 'win') : t(lang, 'loss')}</div>

        <div className="m-meta">
          <span className="m-mode">{queueLabel(lang, match.queue)}</span>
          <span className="m-dur">{match.duration}</span>
          <span className="m-date">{match.date}</span>
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
              <Img key={i} src={s && s.src} className="m-spell" title={s && s.name} />
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
            <TeamColumn players={match.players} teamId={100} lang={lang} onOpenPlayer={onOpenPlayer} />
            <TeamColumn players={match.players} teamId={200} lang={lang} onOpenPlayer={onOpenPlayer} />
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
