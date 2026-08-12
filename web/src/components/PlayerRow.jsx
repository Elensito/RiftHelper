import Img from './Img.jsx'
import { fmtNum, kdaRatio, roleLabel } from '../utils.js'
import { t } from '../i18n.js'

function nameOf(entry, lang) {
  if (!entry) return ''
  if (typeof entry === 'string') return entry
  return entry[lang] || entry.en || ''
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

export default function PlayerRow({ p, lang, onOpenPlayer = () => {} }) {
  return (
    <div className={`prow ${p.is_player ? 'me' : ''}`}>
      <div className="prow-main">
        <div className="p-champ">
          <div className="p-champ-icon-wrap">
            <Img src={p.champion_icon} className="p-champ-icon" title={p.champion} />
            {p.level ? <span className="p-champ-level">{p.level}</span> : null}
          </div>
          <div className="p-spells">
            {(p.spells || []).map((s, i) => (
              <Img key={i} src={s && s.src} className="p-spell" title={s && nameOf(s.name, lang)} />
            ))}
          </div>
          <div className="p-champ-name">
            {p.player_name ? (
              <button
                className="p-name"
                title={`${p.player_name}#${p.player_tag}`}
                onClick={() => onOpenPlayer(p.player_name, p.player_tag)}
              >
                {p.player_name}
                {p.player_tag ? <span className="p-tag">#{p.player_tag}</span> : null}
              </button>
            ) : (
              <span className="p-name">{p.champion}</span>
            )}
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
        <div className="p-stat">
          <span className="p-stat-v">{p.vision}</span>
          <span className="p-stat-l">{t(lang, 'visionShort')}</span>
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
