import { useMemo } from 'react'
import Img from './Img.jsx'
import { t } from '../i18n.js'

function MiniStreak({ matches }) {
  if (!matches || !matches.length) return null

  const w = 100
  const h = 20
  const pad = 2
  const jump = 4
  const step = (w - pad * 2) / Math.max(matches.length, 1)

  const midY = h / 2
  let pathD = `M${pad},${midY}`
  let y = midY

  if (matches.length === 1) {
    y += matches[0].win ? -jump : jump
    y = Math.max(pad + 2, Math.min(h - pad - 2, y))
    pathD += ` L${(w / 2).toFixed(1)},${y.toFixed(1)}`
    pathD += ` L${(w - pad).toFixed(1)},${y.toFixed(1)}`
  } else {
    for (let i = 0; i < matches.length; i++) {
      y += matches[i].win ? -jump : jump
      y = Math.max(pad + 2, Math.min(h - pad - 2, y))
      const x = pad + (i + 1) * step
      pathD += ` L${x.toFixed(1)},${y.toFixed(1)}`
    }
  }

  const wins = matches.filter((m) => m.win).length
  const positive = wins >= matches.length - wins
  const lastX = (pad + matches.length * step).toFixed(1)
  const lastY = y.toFixed(1)

  const gradId = `mcg-${Math.random().toString(36).slice(2, 6)}`

  return (
    <svg className="mini-streak" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={positive ? '#00e5ff' : '#ff1744'} stopOpacity="0.3" />
          <stop offset="100%" stopColor={positive ? '#00e5ff' : '#ff1744'} stopOpacity="1" />
        </linearGradient>
        <filter id={`mg-${gradId}`}>
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <line
        x1={pad} y1={h / 2}
        x2={w - pad} y2={h / 2}
        stroke={positive ? 'rgba(0,229,255,0.08)' : 'rgba(255,23,68,0.08)'}
        strokeWidth="0.5"
        strokeDasharray="2 2"
      />
      <path
        d={pathD}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="1.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
        filter={`url(#mg-${gradId})`}
      />
      <circle cx={lastX} cy={lastY} r="2" fill={positive ? '#00e5ff' : '#ff1744'} />
    </svg>
  )
}

export default function ChampionStats({ matches, lang }) {
  const championData = useMemo(() => {
    if (!matches || !matches.length) return []

    const map = {}
    for (const m of matches) {
      const champ = m.player?.champion
      if (!champ) continue
      if (!map[champ]) {
        map[champ] = {
          name: champ,
          icon: m.player.champion_icon,
          wins: 0,
          losses: 0,
          matches: [],
        }
      }
      if (m.win) map[champ].wins++
      else map[champ].losses++
      map[champ].matches.push({ win: m.win })
    }

    return Object.values(map)
      .map((c) => ({
        ...c,
        total: c.wins + c.losses,
        winrate: Math.round((c.wins / (c.wins + c.losses)) * 100),
      }))
      .sort((a, b) => b.winrate - a.winrate || b.total - a.total)
  }, [matches])

  if (!championData.length) return null

  return (
    <div className="champion-stats">
      <div className="champion-stats-header">
        <span className="champion-stats-title">{t(lang, 'championStats')}</span>
        <span className="champion-stats-count">{matches.length} {t(lang, 'gamesPlayed')}</span>
      </div>
      <div className="champion-stats-list">
        {championData.map((c) => (
          <div key={c.name} className="champion-stat-row">
            <div className="cs-icon-wrap">
              <Img className="cs-icon" src={c.icon} alt={c.name} />
            </div>
            <div className="cs-info">
              <div className="cs-name">{c.name}</div>
              <div className="cs-record">
                <span className="cs-wins">{c.wins}W</span>
                <span className="cs-sep">/</span>
                <span className="cs-losses">{c.losses}L</span>
              </div>
            </div>
            <div className="cs-chart">
              <MiniStreak matches={c.matches} />
            </div>
            <div className="cs-wr">
              <span className={`cs-wr-value ${c.winrate >= 50 ? 'positive' : 'negative'}`}>
                {c.winrate}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
