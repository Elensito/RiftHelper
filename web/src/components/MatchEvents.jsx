import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchMatchEvents } from '../api.js'
import { t } from '../i18n.js'
import Img from './Img.jsx'

const OBJ_META = {
  DRAGON: { cls: 'dragon', label: 'evDragon' },
  BARON: { cls: 'baron', label: 'evBaron' },
  RIFTHERALD: { cls: 'herald', label: 'evHerald' },
  RIFT_HERALD: { cls: 'herald', label: 'evHerald' },
  HORDE: { cls: 'grubs', label: 'evGrubs' },
  VOIDGRUB: { cls: 'grubs', label: 'evGrubs' },
  ATKAHAN: { cls: 'atakhan', label: 'Atakhan' },
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

function PlayerChip({ player, withName }) {
  if (!player) return null
  return (
    <span className={`evt-player ${player.is_player ? 'me' : ''}`}>
      <Img src={player.champion_icon} className="evt-avatar" alt={player.champion} title={player.champion} />
      {withName && <span className="evt-pname">{player.name || player.champion}</span>}
    </span>
  )
}

function EventBadge({ ev }) {
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
    const meta = OBJ_META[ev.monster] || { cls: 'objective' }
    return <span className={`evt-badge obj ${meta.cls}`} />
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

  const myTeam = useMemo(() => {
    if (!data) return null
    const me = data.players.find((p) => p.is_player)
    return me ? me.team : null
  }, [data])

  const visible = useMemo(() => {
    if (!data) return []
    if (!myTeamOnly || myTeam == null) return data.events
    return data.events.filter((e) => e.team === myTeam)
  }, [data, myTeamOnly, myTeam])

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
      <div className="events-toolbar">
        <span className="events-count">
          {data.events.length} {t(lang, 'evCount')}
        </span>
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
          const cls =
            e.type === 'kill'
              ? e.team === 200
                ? 'red'
                : 'blue'
              : e.type === 'objective'
                ? 'obj'
                : 'building'
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
          visible.map((ev) => {
            const teamCls = ev.team === 200 ? 'red' : 'blue'
            const playerRef = ev.killer
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
                      <PlayerChip player={ev.killer} withName />
                      {ev.assisters && ev.assisters.length > 0 && (
                        <span className="evt-assist-icons">
                          {ev.assisters.map((a, i) => (
                            <Img
                              key={i}
                              src={a.champion_icon}
                              className="evt-assist-avatar"
                              alt={a.champion}
                              title={a.name || a.champion}
                            />
                          ))}
                        </span>
                      )}
                      <span className="evt-action">{t(lang, 'evKillFmt')}</span>
                      <PlayerChip player={ev.victim} withName />
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
                      <EventBadge ev={ev} />
                      <span className="evt-desc">
                        {ev.type === 'objective' ? (
                          <>
                            {OBJ_META[ev.monster] ? t(lang, OBJ_META[ev.monster].label) : ev.monster}
                            <span className="evt-by">
                              {t(lang, 'evObjectiveTakenBy')} <PlayerChip player={playerRef} withName />
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
                              {t(lang, 'evBuildingDestroyed')} <PlayerChip player={playerRef} withName />
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
