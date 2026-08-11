import Img from './Img.jsx'
import { fmtNum, kdaRatio, roleLabel } from '../utils.js'
import { t } from '../i18n.js'

function nameOf(entry, lang) {
  return entry ? entry[lang] || entry.en || '' : ''
}

function RuneStrip({ runes, lang }) {
  if (!runes || runes.length === 0) return null
  return (
    <div className="rune-strip">
      {runes.slice(0, 4).map((r, i) => (
        <Img key={`p${i}`} src={r && r.src} className="rune" title={nameOf(r, lang)} />
      ))}
      <span className="rune-sep" />
      {runes.slice(4, 6).map((r, i) => (
        <Img key={`s${i}`} src={r && r.src} className="rune" title={nameOf(r, lang)} />
      ))}
      <span className="rune-sep" />
      {runes.slice(6).map((r, i) => (
        <Img key={`t${i}`} src={r && r.src} className="rune shard" title={nameOf(r, lang)} />
      ))}
    </div>
  )
}

function Items({ p, lang }) {
  const items = [...(p.items || []), ...(p.boots ? [p.boots] : []), ...(p.trinket ? [p.trinket] : [])]
  return (
    <div className="items">
      {items.map((it, i) => (
        <Img key={i} src={it && it.src} className="item" title={nameOf(it, lang)} />
      ))}
    </div>
  )
}

export default function PlayerRow({ p, lang }) {
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
          <span className="p-stat-l">{p.cs_per_min}/m {t(lang, 'cs')}</span>
        </div>
        <div className="p-stat">
          <span className="p-stat-v">{fmtNum(p.gold)}</span>
          <span className="p-stat-l">{t(lang, 'goldShort')}</span>
        </div>
        <div className="p-stat">
          <span className="p-stat-v">{fmtNum(p.damage)}</span>
          <span className="p-stat-l">{t(lang, 'damageShort')}</span>
        </div>

        {p.is_player && <span className="me-badge">{t(lang, 'you')}</span>}
      </div>

      <div className="prow-build">
        <Items p={p} lang={lang} />
      </div>

      <div className="prow-sub">
        <RuneStrip runes={p.runes} lang={lang} />
      </div>
    </div>
  )
}
