import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchMatchEvents } from '../api.js'
import { t } from '../i18n.js'
import Img from './Img.jsx'

const FILTERS = ['all', 'kills', 'objectives', 'buildings']
const FILTER_TYPE = { all: null, kills: 'kill', objectives: 'objective', buildings: 'building' }

const OBJ_META = {
  DRAGON: { cls: 'dragon', label: 'evDragon', short: 'DRG' },
  BARON: { cls: 'baron', label: 'evBaron', short: 'BAR' },
  RIFTHERALD: { cls: 'herald', label: 'evHerald', short: 'HRD' },
  RIFT_HERALD: { cls: 'herald', label: 'evHerald', short: 'HRD' },
  HORDE: { cls: 'grubs', label: 'evGrubs', short: 'GRB' },
  VOIDGRUB: { cls: 'grubs', label: 'evGrubs', short: 'GRB' },
  ATKAHAN: { cls: 'atakhan', label: 'Atakhan', short: 'ATK' },
}

const TOWER_TYPES = {
  OUTER_TURRET: 'evTowerOuter',
  INNER_TURRET: 'evTowerInner',
  BASE_TURRET: 'evTowerBase',
  NEXUS_TURRET: 'evTowerNexus',
}

const LANE_LABELS = {
  TOP: 'evLaneTop',
  MID: 'evLaneMid',
  MIDDLE: 'evLaneMid',
  BOT: 'evLaneBot',
  BOTTOM: 'evLaneBot',
}

function fmtMss(ms) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

function PlayerChip({ ref, withName }) {
  if (!ref) return null
  return (
    <span className={`evt-player ${ref.is_player ? 'me' : ''}`}>
      <Img src={ref.champion_icon} className="evt-avatar" alt={ref.champion} title={ref.champion} />
      {withName && <span className="evt-pname">{ref.name || ref.champion}</span>}
    </span>
  )
}

function EventBadge({ ev, lang }) {
  if (ev.type === 'kill') {
    return (
      <span className="evt-badge kill">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
          <path
            d="M6 6l5 5-5 5m6-10h6"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  if (ev.type === 'objective') {
    const meta = OBJ_META[ev.monster] || { cls: 'objective', label: null, short: ev.monster }
    return <span className={`evt-badge obj ${meta.cls}`}>{meta.short}</span>
  }
  const building = ev.building === 'INHIBITOR' ? 'inhib' : 'tower'
  return (
    <span className={`evt-badge building ${building}`}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path
          d="M5 20h14M7 20V9l5-4 5 4v11M9.5 12h.01M14.5 12h.01"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export default function MatchEvents({ matchId, puuid, lang }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [myTeamOnly, setMyTeamOnly] = useState(false)
  const feedRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setError('')
    setData(null)
    fetchMatchEvents(matchId, puuid)
      .then((d) => {
        if (cancelled) return
        setData(d)
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [matchId, puuid])

  const counts = useMemo(() => {
    if (!data) return { all: 0, kills: 0, objectives: 0, buildings: 0 }
    const c = { all: data.events.length, kills: 0, objectives: 0, buildings: 0 }
    for (const e of data.events) c[e.type === 'kill' ? 'kills' : e.type]++
    return c
  }, [data])

  const myTeam = useMemo(() => {
    if (!data) return null
    const me = data.players.find((p) => p.is_player)
    return me ? me.team : null
  }, [data])

  const visible = useMemo(() => {
    if (!data) return []
    const want = FILTER_TYPE[filter]
    return data.events.filter((e) => {
      if (want && e.type !== want) return false
      if (myTeamOnly && myTeam != null && e.team !== myTeam) return false
      return true
    })
  }, [data, filter, myTeamOnly, myTeam])

  const jumpTo = (idx) => {
    const el = document.getElementById(`evt-${matchId}-${idx}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  if (error) return <div className="metrics-error">{error}</div>
  if (!data)
    return (
      <div className="metrics-loading">
        <div className="spinner" />
      </div>
    )

  const duration = Math.max(1, data.duration_min)

  return (
    <div className="events-wrap">
      <div className="events-filters">
        <div className="metric-pills">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {t(lang, `ev${f.charAt(0).toUpperCase() + f.slice(1)}`)}
              <span className="pill-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        {myTeam != null && (
          <button
            className={`evt-myteam ${myTeamOnly ? 'on' : ''}`}
            onClick={() => setMyTeamOnly(!myTeamOnly)}
          >
            {t(lang, 'evMyTeam')}
          </button>
        )}
      </div>

      <div className="events-ruler">
        {visible.map((e) => {
          const pct = Math.min(100, Math.max(0, (e.minute / duration) * 100))
          const cls = e.type === 'kill' ? (e.team === 200 ? 'red' : 'blue') : e.type === 'objective' ? 'obj' : 'building'
          return (
            <button
              key={data.events.indexOf(e)}
              className={`ruler-tick ${cls} ${e.team === 200 ? 'red' : ''}`}
              style={{ left: `${pct}%` }}
              onClick={() => jumpTo(data.events.indexOf(e))}
              title={`${e.minute}${t(lang, 'evMinute')} · ${e.type}`}
            />
          )
        })}
        <span className="ruler-track" />
        {Array.from({ length: Math.floor(duration / 5) + 1 }, (_, i) => {
          const m = i * 5
          return (
            <span key={m} className="ruler-mark" style={{ left: `${(m / duration) * 100}%` }}>
              {m}
            </span>
          )
        })}
      </div>

      <div className="events-feed" ref={feedRef}>
        {visible.length === 0 ? (
          <div className="events-empty">{t(lang, 'evEmpty')}</div>
        ) : (
          visible.map((ev, vi) => {
            const teamCls = ev.team === 200 ? 'red' : 'blue'
            const playerRef =
              ev.type === 'kill'
                ? ev.killer
                : ev.type === 'objective'
                  ? ev.killer
                  : ev.killer
            const baseIdx = data.events.indexOf(ev)
            return (
              <div
                id={`evt-${matchId}-${baseIdx}`}
                key={baseIdx}
                className={`evt ${ev.type} ${teamCls} ${ev.killer && ev.killer.is_player ? 'mine' : ''}`}
              >
                <div className="evt-time">{ev.time}</div>

                <div className="evt-main">
                  {ev.type === 'kill' ? (
                    <>
                      <PlayerChip ref={ev.killer} withName />
                      <span className="evt-action">{t(lang, 'evKillFmt')}</span>
                      <PlayerChip ref={ev.victim} withName />
                      {ev.assists > 0 && (
                        <span className="evt-assists">
                          {ev.assists} {t(lang, 'evAssists')}
                        </span>
                      )}
                      <span className="evt-flags">
                        {ev.first_blood && <span className="fb-tag">{t(lang, 'evFirstBlood')}</span>}
                        {ev.shutdown && <span className="sd-tag">{t(lang, 'evShutdown')}</span>}
                      </span>
                    </>
                  ) : (
                    <>
                      <EventBadge ev={ev} lang={lang} />
                      <span className="evt-desc">
                        {ev.type === 'objective' ? (
                          <>
                            {OBJ_META[ev.monster] ? t(lang, OBJ_META[ev.monster].label) : ev.monster}
                            <span className="evt-by">
                              {t(lang, 'evObjectiveTakenBy')} <PlayerChip ref={playerRef} withName />
                            </span>
                          </>
                        ) : (
                          <>
                            {ev.building === 'INHIBITOR' ? t(lang, 'evInhibitor') : t(lang, 'evTower')}
                            {ev.tower && TOWER_TYPES[ev.tower] ? (
                              <span className="evt-sub">· {t(lang, TOWER_TYPES[ev.tower])}</span>
                            ) : null}
                            {ev.lane && LANE_LABELS[ev.lane] ? (
                              <span className="evt-sub">· {t(lang, LANE_LABELS[ev.lane])}</span>
                            ) : null}
                            <span className="evt-by">
                              {t(lang, 'evBuildingDestroyed')} <PlayerChip ref={playerRef} withName />
                            </span>
                          </>
                        )}
                      </span>
                    </>
                  )}
                </div>

                <span className={`evt-team ${teamCls}`}>
                  {ev.team === 200 ? t(lang, 'evTeamRed') : t(lang, 'evTeamBlue')}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
