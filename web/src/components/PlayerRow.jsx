import Img from './Img.jsx'
import { TooltipTarget } from './Tooltip.jsx'
import { fmtNum, kdaRatio } from '../utils.js'
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

function ItemCell({ it, lang, className = 'g-item' }) {
  return (
    <TooltipTarget kind="item" id={iconId(it)} lang={lang} src={it && it.src} name={nameOf(it, lang)}>
      <Img src={it && it.src} className={className} />
    </TooltipTarget>
  )
}

function SpellCell({ s, lang }) {
  return (
    <TooltipTarget
      kind="spell"
      id={s && s.id}
      lang={lang}
      src={s && s.src}
      name={s && nameOf(s.name, lang)}
    >
      <Img src={s && s.src} className="g-spell" />
    </TooltipTarget>
  )
}

export default function PlayerRow({ p, lang, maxDamage = 0, onOpenPlayer = () => {} }) {
  const dmgPct = maxDamage > 0 ? Math.min(100, Math.round((p.damage / maxDamage) * 100)) : 0
  return (
    <div className={`grow ${p.is_player ? 'me' : ''}`}>
      <div className="g-champ">
        <div className="g-champ-wrap">
          <Img src={p.champion_icon} className="g-champ-icon" title={p.champion} />
          {p.level ? <span className="g-champ-level">{p.level}</span> : null}
        </div>
      </div>

      <div className="g-spells">
        {(p.spells || []).map((s, i) => (
          <SpellCell key={i} s={s} lang={lang} />
        ))}
      </div>

      <div className="g-runes">
        {p.keystone ? (
          <TooltipTarget
            kind="rune"
            id={p.keystone.id}
            lang={lang}
            src={p.keystone.src}
            name={nameOf(p.keystone, lang)}
          >
            <Img src={p.keystone.src} className="g-rune" />
          </TooltipTarget>
        ) : null}
        {p.secondary_tree ? (
          <Img
            src={p.secondary_tree.src}
            className="g-rune g-tree"
            title={nameOf(p.secondary_tree, lang)}
          />
        ) : null}
      </div>

        <div className="g-name">
          {p.player_name ? (
            <button
              className="g-pname"
              title={`${p.player_name}#${p.player_tag}`}
              onClick={() => onOpenPlayer(p.player_name, p.player_tag)}
            >
              {p.player_name}
            </button>
          ) : (
            <span className="g-pname">{p.champion}</span>
          )}
        </div>

      <div className="g-carry">
        {p.carry_score != null && (
          <span
            className={`carry-score ${p.carry_score >= 90 ? 'legendary' : p.carry_score >= 80 ? 'epic' : p.carry_score >= 40 ? 'mid' : ''}`}
            title={t(lang, 'carryScore')}
          >
            {p.carry_score}
          </span>
        )}
        {p.mvp && (
          <span className="mvp-badge" title={t(lang, 'mvp')}>
            {t(lang, 'mvp')}
          </span>
        )}
      </div>

      <div className="g-kda">
        <span className="g-kda-line">
          <i className="k">{p.kills}</i>
          <i className="sep">/</i>
          <i className="d">{p.deaths}</i>
          <i className="sep">/</i>
          <i className="a">{p.assists}</i>
        </span>
        <span className="g-kda-ratio">
          {kdaRatio(p.kills, p.deaths, p.assists)} {t(lang, 'kda')}
        </span>
      </div>

      <div className="g-dmg">
        <span className="g-dmg-val">{fmtNum(p.damage)}</span>
        <div className="g-dmg-bar">
          <div className="g-dmg-fill" style={{ width: `${dmgPct}%` }} />
        </div>
      </div>

      <div className="g-stat">
        <span className="g-stat-v">{fmtNum(p.gold)}</span>
        <span className="g-stat-l">{t(lang, 'goldShort')}</span>
      </div>
      <div className="g-stat">
        <span className="g-stat-v">{p.cs}</span>
        <span className="g-stat-l">{t(lang, 'cs')}</span>
      </div>
      <div className="g-stat">
        <span className="g-stat-v">{p.vision}</span>
        <span className="g-stat-l">{t(lang, 'visionShort')}</span>
      </div>

      <div className="g-items">
        {p.role_item ? (
          <TooltipTarget
            kind="item"
            id={p.role_item.id}
            lang={lang}
            src={p.role_item.src}
            name={nameOf(p.role_item, lang)}
          >
            <Img
              src={p.role_item.src}
              className="g-item mission"
              title={`${t(lang, 'mission')} · ${nameOf(p.role_item, lang)}`}
            />
          </TooltipTarget>
        ) : null}
        {(p.items || []).map((it, i) => (
          <ItemCell key={i} it={it} lang={lang} />
        ))}
        {p.trinket ? <ItemCell it={p.trinket} lang={lang} /> : null}
      </div>
    </div>
  )
}
