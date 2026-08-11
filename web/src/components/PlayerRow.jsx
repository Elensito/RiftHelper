import Img from './Img.jsx'
import { fmtNum, kdaRatio, roleLabel } from '../utils.js'

function RuneStrip({ runes }) {
  if (!runes || runes.length === 0) return null
  return (
    <div className="rune-strip">
      {runes.slice(0, 4).map((r, i) => (
        <Img key={`p${i}`} src={r} className="rune" title="Runa primaria" />
      ))}
      <span className="rune-sep" />
      {runes.slice(4, 6).map((r, i) => (
        <Img key={`s${i}`} src={r} className="rune" title="Runa secundaria" />
      ))}
      <span className="rune-sep" />
      {runes.slice(6).map((r, i) => (
        <Img key={`t${i}`} src={r} className="rune shard" title="Runas de atributo" />
      ))}
    </div>
  )
}

function Items({ p }) {
  const items = [...(p.items || []), ...(p.boots ? [p.boots] : []), ...(p.trinket ? [p.trinket] : [])]
  return (
    <div className="items">
      {items.map((it, i) => (
        <Img key={i} src={it} className="item" />
      ))}
    </div>
  )
}

export default function PlayerRow({ p }) {
  return (
    <div className={`prow ${p.is_player ? 'me' : ''}`}>
      <div className="prow-main">
        <div className="p-champ">
          <Img src={p.champion_icon} className="p-champ-icon" />
          <div className="p-champ-name">
            <span className="p-name">{p.champion}</span>
            <span className="p-role">{roleLabel(p.role)}</span>
          </div>
        </div>

        <div className="p-kda">
          <span className="p-kills">{p.kills}</span>
          <span className="p-deaths">{p.deaths}</span>
          <span className="p-assists">{p.assists}</span>
          <span className="p-kda-ratio">{kdaRatio(p.kills, p.deaths, p.assists)}</span>
        </div>

        <div className="p-stat">
          <span className="p-stat-v">{p.cs}</span>
          <span className="p-stat-l">{p.cs_per_min}/m</span>
        </div>
        <div className="p-stat">
          <span className="p-stat-v">{fmtNum(p.gold)}</span>
          <span className="p-stat-l">Oro</span>
        </div>
        <div className="p-stat">
          <span className="p-stat-v">{fmtNum(p.damage)}</span>
          <span className="p-stat-l">Daño</span>
        </div>

        <Img src={p.keystone_icon} className="p-keystone" />
        <Items p={p} />
        {p.is_player && <span className="me-badge">TÚ</span>}
      </div>

      <div className="prow-sub">
        <RuneStrip runes={p.runes} />
      </div>
    </div>
  )
}
