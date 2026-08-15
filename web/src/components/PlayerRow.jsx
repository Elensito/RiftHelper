import Img from './Img.jsx'
import { TooltipTarget } from './Tooltip.jsx'
import { fmtNum, roleLabel } from '../utils.js'
import { t } from '../i18n.js'

function nameOf(entry, lang) {
  if (!entry) return ''
  if (typeof entry === 'string') return entry
  return entry[lang] || entry.en || ''
}

function iconId(entry) {
  if (!entry) return 0
  if (entry.id) return entry.id
  if (entry.src) {
    const m = String(entry.src).match(/\d+/)
    return m ? parseInt(m[0], 10) : 0
  }
  return 0
}

function RuneStrip({ runes, lang }) {
  if (!runes || runes.length === 0) return null
  return (
    <div className="rune-strip">
      {runes.slice(0, 4).map((r, i) => (
        <TooltipTarget key={`p${i}`} kind="rune" id={iconId(r)} lang={lang} src={r && r.src} name={nameOf(r, lang)}>
          <Img src={r && r.src} className="rune" />
        </TooltipTarget>
      ))}
      <span className="rune-sep" />
      {runes.slice(4, 6).map((r, i) => (
        <TooltipTarget key={`s${i}`} kind="rune" id={iconId(r)} lang={lang} src={r && r.src} name={nameOf(r, lang)}>
          <Img src={r && r.src} className="rune" />
        </TooltipTarget>
      ))}
      <span className="rune-sep" />
      {runes.slice(6).map((r, i) => (
        <TooltipTarget key={`t${i}`} kind="rune" id={iconId(r)} lang={lang} src={r && r.src} name={nameOf(r, lang)}>
          <Img src={r && r.src} className="rune shard" />
        </TooltipTarget>
      ))}
    </div>
  )
}

function Items({ p, lang }) {
  const items = [...(p.items || []), ...(p.boots ? [p.boots] : []), ...(p.trinket ? [p.trinket] : [])]
  return (
    <div className="items">
      {items.map((it, i) => (
        <TooltipTarget key={i} kind="item" id={iconId(it)} lang={lang} src={it && it.src} name={nameOf(it, lang)}>
          <Img src={it && it.src} className="item" />
        </TooltipTarget>
      ))}
    </div>
  )
}

function CarryBadges({ p, lang }) {
  return (
    <div className="prow-badges">
      <span className="prow-kda" title={t(lang, 'kda')}>
        <i className="k">{p.kills}</i>
        <span className="sep">/</span>
        <i className="d">{p.deaths}</i>
        <span className="sep">/</span>
        <i className="a">{p.assists}</i>
      </span>
      {p.carry_score != null && (
        <span
          className={`carry-score ${p.carry_score >= 70 ? 'high' : p.carry_score >= 40 ? 'mid' : ''}`}
          title={t(lang, 'carryScore')}
        >
          {p.carry_score}
        </span>
      )}
      {p.mvp && <span className="mvp-badge" title={t(lang, 'mvp')}>{t(lang, 'mvp')}</span>}
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
              <TooltipTarget
                key={i}
                kind="spell"
                id={s && s.id}
                lang={lang}
                src={s && s.src}
                name={s && nameOf(s.name, lang)}
              >
                <Img src={s && s.src} className="p-spell" />
              </TooltipTarget>
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
        <CarryBadges p={p} lang={lang} />
      </div>
    </div>
  )
}
