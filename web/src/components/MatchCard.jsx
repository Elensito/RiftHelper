import { useState } from 'react'
import Img from './Img.jsx'
import { fmtNum, kdaRatio, queueLabel, sortPlayers } from '../utils.js'
import PlayerRow from './PlayerRow.jsx'

function TeamColumn({ players, teamId }) {
  const team = sortPlayers(players.filter((p) => p.team === teamId))
  return (
    <div className={`team-col ${teamId === 100 ? 'blue' : 'red'}`}>
      <div className="team-header">
        <span className="team-dot" />
        {teamId === 100 ? 'EQUIPO AZUL' : 'EQUIPO ROJO'}
      </div>
      {team.map((p, i) => (
        <PlayerRow key={i} p={p} />
      ))}
    </div>
  )
}

export default function MatchCard({ match }) {
  const [open, setOpen] = useState(false)
  const pl = match.player
  const win = match.win

  return (
    <article className={`match ${open ? 'open' : ''}`}>
      <div className="match-head" onClick={() => setOpen(!open)}>
        <div className={`badge ${win ? 'win' : 'loss'}`}>{win ? 'V' : 'D'}</div>

        <div className="m-meta">
          <span className="m-mode">{queueLabel(match.queue)}</span>
          <span className="m-dur">{match.duration}</span>
          <span className="m-date">{match.date}</span>
        </div>

        <div className="m-champ">
          <Img src={pl.champion_icon} className="m-champ-icon" />
          <Img src={pl.keystone_icon} className="m-keystone" />
        </div>

        <div className="m-kda">
          <span className="m-kda-line">
            {pl.kills} <i>/</i> {pl.deaths} <i>/</i> {pl.assists}
          </span>
          <span className="m-kda-ratio">{kdaRatio(pl.kills, pl.deaths, pl.assists)} KDA</span>
        </div>

        <div className="m-stats">
          <div className="m-stat">
            <b>{pl.cs}</b>
            <span>{pl.cs_per_min}/m CS</span>
          </div>
          <div className="m-stat">
            <b>{fmtNum(pl.gold)}</b>
            <span>Oro</span>
          </div>
          <div className="m-stat">
            <b>{fmtNum(pl.damage)}</b>
            <span>Daño</span>
          </div>
          <div className="m-stat">
            <b>{pl.kp}%</b>
            <span>KP</span>
          </div>
        </div>

        <button
          className={`chevron ${open ? 'open' : ''}`}
          aria-label={open ? 'Ocultar detalle' : 'Ver detalle'}
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
        <div className="teams">
          <TeamColumn players={match.players} teamId={100} />
          <TeamColumn players={match.players} teamId={200} />
        </div>
      </div>
    </article>
  )
}
