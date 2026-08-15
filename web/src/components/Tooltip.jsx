import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { showTooltip, hideTooltip, subscribe } from '../tooltipStore.js'
import { fetchTooltip } from '../api.js'
import { t } from '../i18n.js'

const _cache = new Map()

export default function Tooltip() {
  const [state, setState] = useState(null)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('idle')
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const ref = useRef(null)

  useEffect(() => {
    return subscribe((s) => {
      if (!s) {
        setState(null)
        setData(null)
        setStatus('idle')
        return
      }
      setState(s)
      setPos({ x: s.x, y: s.y })
      if (!s.id) {
        setData(null)
        setStatus('done')
        return
      }
      const key = `${s.kind}:${s.id}:${s.lang}:${s.champ || ''}`
      if (_cache.has(key)) {
        setData(_cache.get(key) || null)
        setStatus('done')
      } else {
        setData(null)
        setStatus('loading')
        fetchTooltip(s.kind, s.id, s.lang, s.champ)
          .then((d) => {
            _cache.set(key, d)
            setData(d)
            setStatus('done')
          })
          .catch(() => {
            _cache.set(key, null)
            setData(null)
            setStatus('error')
          })
      }
    })
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !state) return
    let x = pos.x + 18
    let y = pos.y + 18
    const rect = el.getBoundingClientRect()
    if (x + rect.width > window.innerWidth - 10) x = pos.x - rect.width - 18
    if (y + rect.height > window.innerHeight - 10) y = pos.y - rect.height - 18
    el.style.left = `${Math.max(10, x)}px`
    el.style.top = `${Math.max(10, y)}px`
  }, [pos, status, state])

  if (!state) return null

  const d = data
  const name = (d && d.name) || state.name || ''
  const src = (d && d.image) || state.src
  const gold = d && d.gold
  const sell = d && d.sell
  const showGold = gold != null && (gold > 0 || (sell != null && sell > 0))
  const lore = d && d.lore
  const showDesc = d && d.description && d.description !== lore

  return (
    <div className="tt" ref={ref}>
      <div className="tt-head">
        {src ? (
          <img className="tt-icon" src={src} alt="" />
        ) : (
          <span className="tt-icon tt-icon-empty" />
        )}
        <div className="tt-titles">
          <span className="tt-name">{name}</span>
          {showGold && (
            <span className="tt-gold">
              {gold} {t(state.lang, 'gold')}
              {sell != null && sell > 0 ? ` · ${t(state.lang, 'ttSell')} ${sell}` : ''}
            </span>
          )}
        </div>
      </div>
      <div className="tt-body">
        {status === 'loading' && <div className="tt-loading">{t(state.lang, 'tooltipLoading')}</div>}
        {status === 'error' && <div className="tt-loading">{t(state.lang, 'tooltipError')}</div>}
        {d && d.stats && d.stats.length > 0 && (
          <div className="tt-stats">
            {d.stats.map((s, i) => (
              <span className="tt-stat" key={i}>
                <b className="tt-stat-v">{s.value}</b>
                <span className="tt-stat-l">{s.label}</span>
              </span>
            ))}
          </div>
        )}
        {showDesc ? (
          <div className="tt-desc" dangerouslySetInnerHTML={{ __html: d.description }} />
        ) : null}
        {lore ? (
          <div className="tt-lore">
            <span className="tt-lore-label">{t(state.lang, 'ttLore')}</span>
            <span className="tt-lore-text" dangerouslySetInnerHTML={{ __html: lore }} />
          </div>
        ) : null}
        {d && (d.cooldown || (d.cost && d.cost !== '0') || d.range || d.maxrank) ? (
          <div className="tt-meta">
            {d.cooldown ? (
              <span className="tt-meta-i">
                <b>{d.cooldown}s</b> {t(state.lang, 'ttCooldown')}
              </span>
            ) : null}
            {d.cost && d.cost !== '0' ? (
              <span className="tt-meta-i">
                <b>
                  {d.cost}
                  {d.cost_label ? ` ${d.cost_label}` : ''}
                </b>{' '}
                {t(state.lang, 'ttCost')}
              </span>
            ) : null}
            {d.range ? (
              <span className="tt-meta-i">
                <b>{d.range}</b> {t(state.lang, 'ttRange')}
              </span>
            ) : null}
            {d.maxrank ? (
              <span className="tt-meta-i">
                <b>{d.maxrank}</b> {t(state.lang, 'ttMaxRank')}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function TooltipTarget({ kind, id, lang, src, name, className, children, champ, as: Tag = 'span' }) {
  const show = (e) => showTooltip({ kind, id, lang, src, name, x: e.clientX, y: e.clientY, champ })
  return (
    <Tag
      className={`tt-target ${className || ''}`}
      onMouseEnter={show}
      onMouseMove={show}
      onMouseLeave={hideTooltip}
    >
      {children}
    </Tag>
  )
}
