import { useState } from 'react'
import Img from './Img.jsx'
import { fmtNum } from '../utils.js'
import { t } from '../i18n.js'

const PAGE_SIZE = 12

function fmtAgo(ts, lang) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return t(lang, 'masteryJustNow')
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}${t(lang, 'masteryMin')}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}${t(lang, 'masteryHour')}`
  const days = Math.floor(hours / 24)
  return `${days}${t(lang, 'masteryDay')}`
}

function SummaryStat({ label, value }) {
  return (
    <div className="mastery-stat">
      <label>{label}</label>
      <b>{value}</b>
    </div>
  )
}

function MasteryItem({ m, index, lang }) {
  const lv = m.level || 0
  const maxed = !m.points_until_next
  const nextPct =
    maxed ? 100 : Math.min(100, Math.round((m.points_since_last_level / m.points_until_next) * 100))
  const points = m.points || 0

  return (
    <div className={`mastery-item lvl-${Math.min(7, Math.max(1, lv))}`}>
      <span className="mastery-rank">{index + 1}</span>
      <div className="mastery-ico-wrap">
        <Img className="mastery-ico" src={m.icon} alt={m.name} title={m.name} />
        <span className="mastery-lv">{lv}</span>
        {m.chest_granted && (
          <span className="mastery-chest" title={t(lang, 'masteryChest')}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none">
              <path d="M4 10h16v10H4z" fill="currentColor" opacity="0.85" />
              <path
                d="M6 10a6 6 0 0 1 12 0h-2a4 4 0 0 0-8 0H6z"
                fill="currentColor"
                stroke="var(--bg)"
                strokeWidth="1"
              />
              <circle cx="12" cy="15" r="1.4" fill="var(--bg)" />
            </svg>
          </span>
        )}
      </div>
      <div className="mastery-info">
        <div className="mastery-name-row">
          <span className="mastery-name">{m.name}</span>
          <span className="mastery-points">{fmtNum(points)} {t(lang, 'masteryPts')}</span>
        </div>
        <div className="mastery-bar">
          <div className="mastery-bar-fill" style={{ width: `${nextPct}%` }} />
        </div>
        <div className="mastery-sub">
          <span className="mastery-last">{fmtAgo(m.last_played, lang)}</span>
          {!maxed && m.points_until_next ? (
            <span className="mastery-next">
              {fmtNum(m.points_until_next)} {t(lang, 'masteryNext')}
            </span>
          ) : (
            <span className="mastery-max">MAX</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Mastery({ data, lang }) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const s = data.summary || {}
  const total = data.mastery.length
  const hasMore = visible < total
  return (
    <section className="mastery">
      <div className="mastery-head">
        <div className="mastery-head-title">
          <h2>{t(lang, 'masteryTitle')}</h2>
        </div>
        <div className="mastery-stats">
          <SummaryStat label={t(lang, 'masteryChampions')} value={s.champion_count || 0} />
        </div>
      </div>

      <div className="mastery-grid">
        {data.mastery.slice(0, visible).map((m, i) => (
          <MasteryItem key={m.champion_id || i} m={m} index={i} lang={lang} />
        ))}
      </div>

      {hasMore && (
        <button
          className="btn btn-search mastery-more"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
        >
          {t(lang, 'loadMore')}
        </button>
      )}
    </section>
  )
}
