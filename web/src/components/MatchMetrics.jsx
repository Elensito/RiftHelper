import { useEffect, useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fetchMatchMetrics } from '../api.js'
import { t } from '../i18n.js'

const METRICS = ['gold', 'damage', 'xp', 'cs']
const BLUE_COLORS = ['#00e5ff', '#38bdf8', '#60a5fa', '#818cf8', '#22d3ee']
const RED_COLORS = ['#ff2d78', '#fb7185', '#f97316', '#f43f5e', '#e879f9']

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

function fmtTick(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return `${v}`
}

function teamColor(p, players) {
  const team = players.filter((x) => x.team === p.team)
  const i = team.findIndex((x) => x.participant_id === p.participant_id)
  const palette = p.team === 100 ? BLUE_COLORS : RED_COLORS
  return palette[i % palette.length]
}

function TeamIcons({ players, active, onToggle, data }) {
  return (
    <div className="team-icons">
      {players.map((p) => {
        const on = active.has(p.participant_id)
        return (
          <button
            key={p.participant_id}
            className={`champ-tile ${on ? 'active' : ''} ${p.is_player ? 'me' : ''}`}
            onClick={() => onToggle(p.participant_id)}
            style={on ? { '--tile': teamColor(p, data.players) } : null}
          >
            <img src={p.champion_icon} alt={p.champion} title={p.champion} draggable="false" />
            <span className="champ-tile-name">{p.champion}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function MatchMetrics({ matchId, puuid, lang }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [metric, setMetric] = useState('gold')
  const [active, setActive] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    setError('')
    setData(null)
    fetchMatchMetrics(matchId, puuid)
      .then((d) => {
        if (cancelled) return
        setData(d)
        const me = d.players.find((p) => p.is_player)
        setActive(new Set(me ? [me.participant_id] : []))
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [matchId, puuid])

  const toggle = (pid) => {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  const rows = useMemo(() => {
    if (!data) return []
    return data.buckets.map((minute, i) => {
      const row = { minute }
      for (const p of data.players) row[p.participant_id] = p[metric][i]
      return row
    })
  }, [data, metric])

  if (error) return <div className="metrics-error">{error}</div>
  if (!data)
    return (
      <div className="metrics-loading">
        <div className="spinner" />
      </div>
    )

  const blue = data.players.filter((p) => p.team === 100)
  const red = data.players.filter((p) => p.team === 200)
  const activePlayers = data.players.filter((p) => active.has(p.participant_id))
  const metricLabel = t(lang, `metric${cap(metric)}`)

  return (
    <div className="metrics-wrap">
      <div className="metric-pills">
        {METRICS.map((m) => (
          <button
            key={m}
            className={`pill ${metric === m ? 'active' : ''}`}
            onClick={() => setMetric(m)}
          >
            {t(lang, `metric${cap(m)}`)}
          </button>
        ))}
      </div>

      <div className="metrics-teams">
        <TeamIcons players={blue} active={active} onToggle={toggle} data={data} />
        <TeamIcons players={red} active={active} onToggle={toggle} data={data} />
      </div>

      <div className="chart-box">
        {activePlayers.length === 0 ? (
          <div className="chart-empty">{t(lang, 'metricHint')}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid stroke="rgba(0, 229, 255, 0.08)" vertical={false} />
              <XAxis
                dataKey="minute"
                tick={{ fill: '#8490b8', fontSize: 11 }}
                stroke="rgba(0, 229, 255, 0.2)"
                tickLine={false}
                axisLine={{ stroke: 'rgba(0, 229, 255, 0.2)' }}
                tickFormatter={(v) => `${v}${t(lang, 'minShort')}`}
              />
              <YAxis
                tick={{ fill: '#8490b8', fontSize: 11 }}
                stroke="rgba(0, 229, 255, 0.2)"
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={fmtTick}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(10, 12, 24, 0.95)',
                  border: '1px solid rgba(0, 229, 255, 0.3)',
                  borderRadius: 10,
                  boxShadow: '0 0 18px rgba(0, 229, 255, 0.25)',
                }}
                labelStyle={{ color: '#00e5ff', fontWeight: 700, marginBottom: 4 }}
                itemStyle={{ color: '#e8eeff' }}
                formatter={(value, name) => [`${fmtTick(value)}`, name]}
                labelFormatter={(minute) => `${metricLabel} @ ${minute}${t(lang, 'minShort')}`}
              />
              {activePlayers.map((p) => (
                <Line
                  key={p.participant_id}
                  dataKey={String(p.participant_id)}
                  name={p.champion}
                  stroke={teamColor(p, data.players)}
                  strokeWidth={2.4}
                  dot={false}
                  activeDot={{ r: 4 }}
                  animationDuration={500}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {activePlayers.length > 0 && (
        <div className="chart-legend">
          {activePlayers.map((p) => (
            <span key={p.participant_id} className="legend-item">
              <i style={{ background: teamColor(p, data.players) }} />
              {p.champion}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
