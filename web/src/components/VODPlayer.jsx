import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { t } from '../i18n.js'
import Img from './Img.jsx'
import { isTauri, readVodEvents, verifyVod, deleteVodFiles } from '../tauri.js'
import { fetchMatchEvents } from '../api.js'
import { retryPendingMatches, loadVodsRaw, saveVodsRaw } from '../match-resolver.js'

/* ── Event icons (neon line style) ─────────────────────────── */

const IconSword = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
    <path d="M13 19l6-6" />
    <path d="M16 16l4 4" />
    <path d="M19 21l2-2" />
  </svg>
)

const IconSkull = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a8 8 0 0 0-8 8c0 2.5 1.2 4.4 3 5.7V20h10v-4.3c1.8-1.3 3-3.2 3-5.7a8 8 0 0 0-8-8z" />
    <circle cx="9" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M10 20v-2M14 20v-2M12 20v-2.2" />
  </svg>
)

const IconTower = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 21h12" />
    <path d="M8 21V11h8v10" />
    <path d="M8 11V7h2v4M14 11V7h2v4" />
    <path d="M6 7h2V5h8v2h2" />
    <rect x="10.5" y="14" width="3" height="3" rx="0.5" />
  </svg>
)

const IconInhib = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
    <path d="M12 10l2.4 4h-4.8z" />
  </svg>
)

const IconBaron = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.5 3.5c2.2 4 2.2 9-.5 17" />
    <path d="M12.5 2.5c2.6 5 2.6 11-.5 19" />
    <path d="M17.5 4c2 4.5 1.8 9-1 15.5" />
  </svg>
)

const IconHand = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
)

const KIND_META = {
  'kill-me':   { cls: 'kill',   icon: IconSword },
  'death-me':  { cls: 'death',  icon: IconSkull },
  'assist-me': { cls: 'assist', icon: IconHand },
  'tower':     { cls: 'tower',  icon: IconTower },
  'inhib':     { cls: 'inhib',  icon: IconInhib },
  'baron':     { cls: 'baron',  icon: IconBaron },
}

function parseTimeToSec(ev) {
  const tm = typeof ev.time === 'string' ? ev.time.match(/(\d+)\s*:\s*(\d{1,2})/) : null
  if (tm) return Number(tm[1]) * 60 + Number(tm[2])
  const minute = Number(ev.minute)
  if (!Number.isNaN(minute)) return minute * 60
  return null
}

function fmt(sec) {
  if (!sec && sec !== 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/* ── Neon match timeline ───────────────────────────────────── */

function NeonTimeline({ matchId, puuid, lang, duration, current, onSeek, localData, gameTimeOffset }) {
  /* v2 prefix: older caches were fetched without a puuid, so every event had
     is_player=false and personal kill/death markers never rendered */
  const CACHE_PREFIX = 'rh-vtl2-'
  const trackRef = useRef(null)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState(matchId ? 'loading' : 'empty')
  const [cursor, setCursor] = useState(null)
  const [filteredKinds, setFilteredKinds] = useState(() => new Set(['kill-me', 'death-me', 'assist-me', 'tower', 'inhib', 'baron']))

  useEffect(() => {
    /* Locally captured LCD events (instant timeline): use them as-is and
       skip the backend entirely. */
    if (localData) {
      setData(localData)
      setStatus('ok')
      return
    }
    if (!matchId) { setStatus('empty'); setData(null); return }
    let cancelled = false
    try {
      const cached = sessionStorage.getItem(CACHE_PREFIX + matchId)
      if (cached) {
        const parsed = JSON.parse(cached)
        /* only trust the cache when it was fetched for the same puuid —
           otherwise personal markers would be missing forever */
        if (parsed && parsed.puuid === (puuid || '')) {
          setData(parsed.data)
          setStatus('ok')
          return
        }
      }
    } catch {}
    setStatus('loading')
    fetchMatchEvents(matchId, puuid)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setStatus('ok')
        try { sessionStorage.setItem(CACHE_PREFIX + matchId, JSON.stringify({ puuid: puuid || '', data: d })) } catch {}
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => { cancelled = true }
  }, [matchId, puuid, localData])

  const tlDuration = Math.max(1, duration || (data ? (data.duration_min || 0) * 60 : 0))

  /* The track domain is VIDEO time, but event seconds are GAME-clock time.
     Recordings skip the loading screen via gameTimeOffset, so events need
     that offset subtracted before scaling. The victory/defeat screen still
     makes videos run longer than the match, so we scale by duration ratio. */
  const gameDur = data ? Math.max(0, (data.duration_min || 0) * 60) : 0
  const scale = useMemo(() => {
    if (!duration || gameDur < 300 || duration < 300) return 1
    const s = duration / gameDur
    return s >= 0.6 && s <= 1.5 ? s : 1
  }, [duration, gameDur])

  const events = useMemo(() => {
    if (!data || !data.events) return []
    // gameTimeOffset: gameTime at recording start (loading screen skip).
    // Events use game-clock seconds; video starts at 0s. Subtract offset so
    // events align with the correct video timestamp.
    const offset = gameTimeOffset || 0

    const out = []
    for (const ev of data.events) {
      const sec = parseTimeToSec(ev)
      if (sec == null) continue
      const adjSec = Math.max(0, sec - offset) // adjust for loading screen
      let kind = null
      if (ev.type === 'kill') {
        if (ev.killer?.is_player) kind = 'kill-me'
        else if (ev.victim?.is_player) kind = 'death-me'
        else if ((ev.assisters || []).some(a => a?.is_player)) kind = 'assist-me'
      } else if (ev.type === 'building') {
        kind = ev.building === 'INHIBITOR' ? 'inhib' : 'tower'
      } else if (ev.type === 'objective' && /BARON/i.test(ev.monster || '')) {
        kind = 'baron'
      }
      if (!kind) continue
      if (adjSec < 0) continue // skip events before recording started (loading screen)
      const vsec = adjSec * scale
      out.push({ kind, sec: adjSec, vsec, time: ev.time, team: ev.team === 200 ? 200 : 100, ally: ev.team === 100 })
    }

    // Team alignment relative to MY team
    const myTeam = (data.players || []).find(p => p.is_player)?.team ?? null
    if (myTeam != null) {
      for (const o of out) o.ally = o.team === myTeam
    }

    out.sort((a, b) => a.sec - b.sec)

    // Filter by active event kinds
    const visible = out.filter(o => filteredKinds.has(o.kind))

    // Cluster: merge same-kind events within 10s into a single marker
    const clustered = []
    for (const o of visible) {
      const last = clustered.length > 0 ? clustered[clustered.length - 1] : null
      if (last && last.kind === o.kind && last.ally === o.ally && Math.abs(o.sec - last.sec) <= 10) {
        last.count = (last.count || 1) + 1
        last.endSec = o.sec
      } else {
        clustered.push({ ...o, count: 1 })
      }
    }

    // Collision-free lanes: stack overlapping markers
    const minGap = Math.max(8, tlDuration * 0.022)
    const laneEnds = [-Infinity]
    for (const o of clustered) {
      let lane = laneEnds.findIndex(end => o.vsec - end >= minGap)
      if (lane === -1) lane = laneEnds.length < 4 ? laneEnds.length : 0
      laneEnds[lane] = o.vsec
      o.lane = lane
    }
    return clustered.slice(0, 120)
  }, [data, tlDuration, scale, gameTimeOffset, filteredKinds])

  const pct = (sec) => Math.min(100, Math.max(0, (sec / tlDuration) * 100))
  const stepMin = tlDuration <= 20 * 60 ? 2 : tlDuration <= 35 * 60 ? 5 : 10
  const ticks = useMemo(() => {
    const arr = []
    for (let m = 0; m * 60 <= tlDuration; m += stepMin) arr.push(m * 60)
    return arr
  }, [tlDuration, stepMin])

  const labelFor = useCallback((ev) => {
    const side = ev.kind === 'kill-me' || ev.kind === 'death-me' || ev.kind === 'assist-me'
      ? ''
      : ` · ${t(lang, ev.ally ? 'vtlAlly' : 'vtlEnemy')}`
    const base =
      ev.kind === 'kill-me' ? t(lang, 'vtlKills') :
      ev.kind === 'death-me' ? t(lang, 'vtlDeaths') :
      ev.kind === 'assist-me' ? t(lang, 'vtlAssists') :
      ev.kind === 'tower' ? t(lang, 'evTower') :
      ev.kind === 'inhib' ? t(lang, 'evInhibitor') :
      t(lang, 'evBaron')
    return `${ev.time} · ${base}${side}`
  }, [lang])

  const secAtClientX = useCallback((clientX, clientY) => {
    const el = trackRef.current
    if (!el || !tlDuration) return null
    const rect = el.getBoundingClientRect()
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    // time bubble only when hovering close to the rail (small hitbox),
    // while the whole track stays clickable for seeking
    const nearRail = clientY == null ||
      Math.abs(clientY - rect.top - rect.height / 2) <= rect.height * 0.22
    return { sec: p * tlDuration, x: clientX - rect.left, nearRail }
  }, [tlDuration])

  const progressPct = pct(current)

  const toggleKind = useCallback((kind) => {
    setFilteredKinds(prev => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  return (
    <section className="vtl" aria-label={t(lang, 'vtlTitle')}>
      <div className="vtl-head">
        <span className="vtl-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {t(lang, 'vtlTitle')}
        </span>
        <div className="vtl-legend">
          {Object.entries(KIND_META).map(([kind, meta]) => {
            const active = filteredKinds.has(kind)
            const label =
              kind === 'kill-me' ? t(lang, 'vtlKills') :
              kind === 'death-me' ? t(lang, 'vtlDeaths') :
              kind === 'assist-me' ? t(lang, 'vtlAssists') :
              kind === 'tower' ? t(lang, 'evTower') :
              kind === 'inhib' ? t(lang, 'evInhibitor') :
              t(lang, 'evBaron')
            return (
              <button
                key={kind}
                className={`vtl-filter ${active ? 'on' : 'off'} ${meta.cls}`}
                onClick={() => toggleKind(kind)}
                title={label}
              >
                <meta.icon />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div
        ref={trackRef}
        className={`vtl-track ${status}`}
        onMouseMove={(e) => setCursor(secAtClientX(e.clientX, e.clientY))}
        onMouseLeave={() => setCursor(null)}
        onClick={(e) => {
          const c = secAtClientX(e.clientX)
          if (c) onSeek(c.sec)
        }}
      >
        {/* hover cursor tooltip (only near the rail) */}
        {cursor && cursor.nearRail && (
          <div className="vtl-cursor-tip" style={{ left: `${cursor.x}px` }}>
            {fmt(cursor.sec)}
          </div>
        )}

        {/* progress */}
        <div className="vtl-progress" style={{ width: `${progressPct}%` }} />

        {/* ticks */}
        {ticks.map((sec, i) => (
          <span key={sec} className={`vtl-tick ${i % 2 === 0 ? 'major' : 'minor'}`} style={{ left: `${pct(sec)}%` }}>
            {i % 2 === 0 && <label>{Math.round(sec / 60)}:00</label>}
          </span>
        ))}

        {/* playhead */}
        <span className="vtl-playhead" style={{ left: `${progressPct}%` }} />

        {/* events */}
        {status === 'ok' && events.map((ev, i) => {
          const meta = KIND_META[ev.kind]
          const Icon = meta.icon
          return (
            <button
              key={i}
              className={`vtl-ev ${meta.cls} ${ev.ally ? 'ally' : 'enemy'} lane-${ev.lane % 4}`}
              style={{ left: `${pct(ev.vsec)}%` }}
              data-tip={labelFor(ev)}
              aria-label={labelFor(ev)}
              onMouseEnter={() => setCursor(null)}
              onClick={(e) => {
                e.stopPropagation()
                onSeek(Math.max(0, ev.vsec - 15))
              }}
            >
              <Icon />
              {ev.count > 1 && <span className="vtl-ev-badge">{ev.count}</span>}
            </button>
          )
        })}

        {status === 'loading' && <div className="vtl-shimmer" />}
        {(status === 'empty' || status === 'error') && (
          <div className="vtl-empty">{t(lang, 'evEmpty')}</div>
        )}
        {status === 'ok' && events.length === 0 && (
          <div className="vtl-empty">{t(lang, 'evEmpty')}</div>
        )}
      </div>
    </section>
  )
}

/* ── Teams panel ───────────────────────────────────────────── */

function PlayerTeamPanel({ team, teamLabel, isWinner, lang }) {
  return (
    <div className={`vod-team ${isWinner ? 'winner' : ''}`}>
      <div className="vod-team-header">
        <span className="vod-team-label">{teamLabel}</span>
        {isWinner && <span className="vod-team-win">{t(lang, 'victory')}</span>}
      </div>
      {team.map((p, i) => (
        <div key={i} className="vod-player-row">
          {p.championIcon && <Img className="vod-player-icon" src={p.championIcon} alt="" />}
          <div className="vod-player-info">
            <span className="vod-player-name">{p.name || '—'}</span>
            <span className="vod-player-kda">
              <span className="kda-k">{p.kills || 0}</span>/<span className="kda-d">{p.deaths || 0}</span>/<span className="kda-a">{p.assists || 0}</span>
              {p.cs !== undefined && <span className="vod-player-cs"> | {p.cs} CS</span>}
            </span>
          </div>
          <div className="vod-player-items">
            {(p.items || []).filter(Boolean).slice(0, 6).map((item, j) => (
              item ? <Img key={j} className="vod-player-item" src={item} alt="" /> : <span key={j} className="vod-player-item empty" />
            ))}
          </div>
          {p.gold !== undefined && <span className="vod-player-gold">{(p.gold / 1000).toFixed(1)}k</span>}
        </div>
      ))}
    </div>
  )
}

/* ── Player ────────────────────────────────────────────────── */

export default function VODPlayer({ vod, lang, onBack, puuid, summoner, showTeamsProp }) {
  /* personal events need the puuid the backend used to flag is_player;
     fall back to the puuid stored in the VOD when no profile is loaded */
  const evPuuid = puuid || vod.puuid || ''
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const seekRef = useRef(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrent] = useState(0)
  const [duration, setDuration] = useState(vod.duration || 0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSpeed, setShowSpeed] = useState(false)
  const [clipping, setClipping] = useState(false)
  const [clipStart, setClipStart] = useState(null)
  const [clipEnd, setClipEnd] = useState(null)
  const [showTeams, setShowTeams] = useState(showTeamsProp !== false)
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoError, setVideoError] = useState(false)
  const [videoRetry, setVideoRetry] = useState(0)
  const videoErrorTimerRef = useRef(null)

  const FAV_KEY = 'rh-vod-favorites'
  const [isFav, setIsFav] = useState(() => {
    try {
      const favs = JSON.parse(localStorage.getItem(FAV_KEY) || '[]')
      return favs.includes(vod.id)
    } catch { return false }
  })
  const toggleFav = useCallback(() => {
    setIsFav(prev => {
      try {
        const favs = JSON.parse(localStorage.getItem(FAV_KEY) || '[]')
        const idx = favs.indexOf(vod.id)
        if (idx >= 0) favs.splice(idx, 1)
        else favs.push(vod.id)
        localStorage.setItem(FAV_KEY, JSON.stringify(favs))
        return idx < 0
      } catch { return !prev }
    })
    window.dispatchEvent(new Event('rh-vods-changed'))
  }, [vod.id])

  /* Matches recorded before Riot finished indexing stay "pending": the
     timeline/teams unlock as soon as the resolver patches the VOD. */
  const [vodPatch, setVodPatch] = useState(null)
  const mv = useMemo(() => ({ ...vod, ...(vodPatch || {}) }), [vod, vodPatch])
  const pending = !!mv.pendingMatch

  /* Locally captured timeline events (Live Client Data API): available
     immediately after a recording ends, no Riot indexing required. */
  const [localEvents, setLocalEvents] = useState(null)
  useEffect(() => {
    let dead = false
    setLocalEvents(null)
    if (!vod.videoPath || !isTauri()) return
    readVodEvents(vod.videoPath)
      .then((raw) => {
        if (dead || !raw) return
        try {
          const parsed = JSON.parse(raw)
          if (parsed && Array.isArray(parsed.events) && parsed.events.length) {
            setLocalEvents(parsed)
            /* Unindexed games (practice/custom) never get a Riot duration:
               use the exact game length captured by the LCD API instead of
               the wall-clock recording time. */
            const gdur = Number(parsed.duration_min || 0)
            const cur = loadVodsRaw()
            const idx = cur.findIndex(x => x.id === vod.id)
            if (idx >= 0 && gdur > 0.2 && Math.abs((cur[idx].duration || 0) - gdur * 60) > 15) {
              cur[idx].duration = Math.round(gdur * 60)
              saveVodsRaw(cur)
            }
          }
        } catch {}
      })
      .catch(() => {})
    return () => { dead = true }
  }, [vod.id, vod.videoPath])

  useEffect(() => {
    if (!pending || !summoner) return
    let alive = true
    let timer = null
    const startedAt = mv.pendingAt || Date.now()
    /* Riot indexes match details fast most of the time: poll hard (5s)
       during the first minute after the game ended, 13s for the next
       couple of minutes, then back off to 45s to save API calls. */
    const nextDelay = () => {
      const age = Date.now() - startedAt
      if (age < 60 * 1000) return 5000
      if (age < 3 * 60 * 1000) return 13000
      return 45000
    }
    const tick = async () => {
      try {
        await retryPendingMatches(summoner)
      } catch {}
      if (!alive) return
      const fresh = loadVodsRaw().find(x => x.id === mv.id)
      if (fresh && !fresh.pendingMatch) {
        setVodPatch({ ...fresh })
      } else {
        timer = setTimeout(tick, nextDelay())
      }
    }
    timer = setTimeout(tick, 5000)
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [pending, summoner, mv.id])

  const lastVolRef = useRef(0.8)
  const videoUrlRef = useRef(null)
  videoUrlRef.current = videoUrl
  const hasVideoLive = !!videoUrl && !videoError
  const liveRef = useRef({})
  liveRef.current = { playing, currentTime }

  /* Deck always visible when a VOD is loaded; cursor hides during playback
     after 5s of mouse inactivity (YouTube-style) */
  const [uiActive, setUiActive] = useState(true)
  const uiTimerRef = useRef(null)
  const bumpUi = useCallback(() => {
    setUiActive(true)
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current)
    uiTimerRef.current = setTimeout(() => setUiActive(false), 5000)
  }, [])
  const hideUiNow = useCallback(() => {
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current)
    setUiActive(false)
  }, [])

  useEffect(() => {
    if (!hasVideoLive || !playing) {
      if (uiTimerRef.current) clearTimeout(uiTimerRef.current)
      setUiActive(true)
      return
    }
    bumpUi()
  }, [playing, hasVideoLive, bumpUi])

  useEffect(() => () => { if (uiTimerRef.current) clearTimeout(uiTimerRef.current) }, [])
  useEffect(() => () => { if (videoErrorTimerRef.current) clearTimeout(videoErrorTimerRef.current) }, [])

  const team1 = mv.team1 || []
  const team2 = mv.team2 || []

  useEffect(() => {
    if (videoUrl || !vod.hasVideo) return
    if (vod.videoPath && isTauri()) {
      import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
        const url = convertFileSrc(vod.videoPath)
        console.log('[VODPlayer] video URL:', url, 'path:', vod.videoPath)
        setVideoUrl(url)
      }).catch(e => {
        console.error('[VODPlayer] convertFileSrc failed:', e)
      })
    }
  }, [vod.id, vod.hasVideo, vod.videoPath, videoRetry])

  useEffect(() => {
    if (!videoError || !vod.videoPath || !isTauri()) return
    console.warn('[VODPlayer] video error, trying retry in 1s')
    const t = setTimeout(() => {
      setVideoError(false)
      setVideoUrl(null)
      setVideoRetry(r => r + 1)
    }, 1000)
    return () => clearTimeout(t)
  }, [videoError, vod.videoPath])

  useEffect(() => { setVideoError(false) }, [videoUrl])

  useEffect(() => {
    if (showTeamsProp === false) setShowTeams(false)
  }, [showTeamsProp])

  /* Sync volume / mute to the video element */
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    vid.volume = volume
    vid.muted = muted
  }, [volume, muted, videoUrl])

  /* Video element events */
  const didInitialSeekRef = useRef(false)
  useEffect(() => {
    didInitialSeekRef.current = false
    const vid = videoRef.current
    if (!vid) return
    const onTime = () => setCurrent(vid.currentTime)
    const onLoaded = () => {
      const dur = vid.duration || vod.duration || 0
      setDuration(dur)
      /* The recording starts after wait_for_game_start + a resync, so
         gameTimeOffset already reflects the actual first-frame game time.
         No auto-seek needed — video time 0 already corresponds to the
         correct game time.  Just reset to start on video change. */
      if (!didInitialSeekRef.current && dur > 0) {
        didInitialSeekRef.current = true
      }
    }
    const onEnd = () => setPlaying(false)
    vid.addEventListener('timeupdate', onTime)
    vid.addEventListener('loadedmetadata', onLoaded)
    vid.addEventListener('ended', onEnd)
    return () => {
      vid.removeEventListener('timeupdate', onTime)
      vid.removeEventListener('loadedmetadata', onLoaded)
      vid.removeEventListener('ended', onEnd)
    }
  }, [videoUrl])

  /* Canvas MPO bypass: draw video frames onto a <canvas> element which is
     never promoted to a hardware overlay plane.  The <video> is hidden
     off-screen but still drives playback, seeking, and volume. */
  useEffect(() => {
    const vid = videoRef.current
    const cvs = canvasRef.current
    if (!vid || !cvs) return
    const ctx = cvs.getContext('2d')
    let raf
    const draw = () => {
      if (vid.readyState >= 2 && vid.videoWidth > 0) {
        if (cvs.width !== vid.videoWidth || cvs.height !== vid.videoHeight) {
          cvs.width = vid.videoWidth
          cvs.height = vid.videoHeight
        }
        ctx.drawImage(vid, 0, 0, cvs.width, cvs.height)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [videoUrl])

  /* Auto-hide cursor over video while playing */
  const containerRef = useRef(null)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.cursor = playing && !uiActive ? 'none' : 'pointer'
    }
  }, [playing, uiActive])

  const hasVideo = hasVideoLive
  /* Always show the deck when a video is loaded.  During playback, auto-hide
     after 5s of mouse inactivity (YouTube-style).  When paused, always visible. */
  const showDeck = hasVideo && (!playing || uiActive)

  const togglePlay = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    if (vid.paused || vid.ended) vid.play().then(() => setPlaying(true)).catch(() => {})
    else { vid.pause(); setPlaying(false) }
  }, [])

  /* Keyboard shortcuts: Space = play/pause, ←/→ = ±10s */
  const seek = useCallback((time) => {
    const vid = videoRef.current
    if (!vid || !Number.isFinite(time)) return
    const max = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : time
    vid.currentTime = Math.max(0, Math.min(time, max))
    setCurrent(vid.currentTime)
  }, [])

  /* Keyboard shortcuts: Space = play/pause, ←/→ = ±10s */
  useEffect(() => {
    const onKey = (e) => {
      if (!videoUrlRef.current) return
      const tgt = e.target
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      if (e.code === 'Space' || e.key === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seek(Math.max(0, liveRef.current.currentTime - 10))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seek(liveRef.current.currentTime + 10)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seek])

  const seekFromEvent = (e) => {
    const el = seekRef.current
    if (!el || !duration) return
    const rect = el.getBoundingClientRect()
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(p * duration)
  }

  const setSpeed = (rate) => {
    setPlaybackRate(rate)
    if (videoRef.current) videoRef.current.playbackRate = rate
    setShowSpeed(false)
  }

  /* Clip helpers */
  const startClip = () => { setClipping(true); setClipStart(currentTime); setClipEnd(null) }
  const endClip = () => { setClipping(false); setClipEnd(currentTime) }
  const clearClip = () => { setClipping(false); setClipStart(null); setClipEnd(null) }

  const createClip = async () => {
    if (clipStart === null || clipEnd === null) return
    const clip = {
      id: `clip-${Date.now()}`,
      vodId: vod.id,
      start: Math.min(clipStart, clipEnd),
      end: Math.max(clipStart, clipEnd),
      date: Date.now(),
    }
    try {
      const stored = JSON.parse(localStorage.getItem('rh-clips') || '[]')
      stored.push(clip)
      localStorage.setItem('rh-clips', JSON.stringify(stored))
    } catch {}
    clearClip()
  }

  const downloadVod = () => {
    if (videoUrl) {
      const a = document.createElement('a')
      a.href = videoUrl
      a.download = vod.filename || 'vod.mp4'
      a.click()
    }
  }

  const toggleFullscreen = () => {
    const el = document.querySelector('.vod-player-view')
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else el.requestFullscreen().catch(() => {})
  }

  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

  const toggleMute = () => {
    if (muted || volume === 0) {
      const restore = lastVolRef.current > 0 ? lastVolRef.current : 0.8
      setVolume(restore)
      setMuted(false)
    } else {
      lastVolRef.current = volume
      setMuted(true)
    }
  }

  const VolIcon = muted || volume === 0 ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  ) : volume < 0.5 ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.6 5.4a9.5 9.5 0 0 1 0 13.2" />
    </svg>
  )

  return (
    <div className="vod-player-view">
      <div className="vod-topbar">
        <button className="rt-btn rt-btn-ghost" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          {t(lang, 'backToVods')}
        </button>
        <div className="vod-topbar-info">
          <span className="vod-topbar-champ">{mv.champion || ''}</span>
          <span className="vod-topbar-queue">{mv.queue || ''}</span>
          <span className="vod-topbar-date">{mv.date ? new Date(mv.date).toLocaleDateString() : ''}</span>
          {pending && (
            <span className="vod-pending-pill" title={t(lang, 'pendingMatchDesc')}>
              <span className="vod-pending-dot" />
              {t(lang, 'pendingMatchBadge')}
            </span>
          )}
        </div>
        <div className="vod-topbar-actions">
          <button className={`rt-btn rt-btn-ghost rt-btn-sm vod-fav-btn ${isFav ? 'active' : ''}`} onClick={toggleFav} title={isFav ? t(lang, 'removeFavorite') : t(lang, 'addFavorite')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button className="rt-btn rt-btn-ghost rt-btn-sm" onClick={downloadVod} title={t(lang, 'downloadVod')} disabled={!hasVideo}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          {showTeamsProp !== false && !showTeams && (
            <button className="rt-btn rt-btn-ghost rt-btn-sm" onClick={() => setShowTeams(true)} title={t(lang, 'toggleTeams')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="vod-main">
        <div className="vod-video-area"
          onMouseEnter={() => bumpUi() }
          onMouseMove={() => { if (playing) bumpUi() }}
          onMouseLeave={() => { if (playing) hideUiNow() }}
        >
          <div ref={containerRef} className="vod-video-container" onClick={(e) => { if (hasVideo) togglePlay(e) }}>
            {hasVideo ? (
              <>
              <video ref={videoRef} className="vod-video-hidden" src={videoUrl} preload="metadata" onError={(e) => {
                console.error('[VODPlayer] video load error:', e.target?.error, 'src:', videoUrl)
                if (!videoErrorTimerRef.current) {
                  videoErrorTimerRef.current = setTimeout(() => {
                    videoErrorTimerRef.current = null
                    setVideoError(true)
                  }, 1500)
                }
              }} onLoadedData={() => {
                if (videoErrorTimerRef.current) {
                  clearTimeout(videoErrorTimerRef.current)
                  videoErrorTimerRef.current = null
                }
                setVideoError(false)
              }} />
              <canvas ref={canvasRef} className="vod-video" />
              {/* Hover capture layer — guarantees mouse events reach JS
                  even when canvas pointer-events:none doesn't forward them */}
              <div className="vod-hover-layer"
                onMouseEnter={() => bumpUi()}
                onMouseMove={() => { if (playing) bumpUi() }}
                onMouseLeave={() => { if (playing) hideUiNow() }}
                onClick={(e) => { e.stopPropagation(); togglePlay() }}
              />
              </>
            ) : (
              <div className="vod-video-placeholder vod-match-summary">
                {vod.championIcon && <img className="vod-summary-champ" src={vod.championIcon} alt={vod.champion || ''} />}
                <div className="vod-summary-info">
                  <span className="vod-summary-champ-name">{vod.champion || '—'}</span>
                  <span className="vod-summary-queue">{vod.queue || ''}</span>
                  {vod.kda && <span className="vod-summary-kda">{vod.kda}</span>}
                  {vod.result && (
                    <span className={`vod-summary-result ${vod.result}`}>
                      {vod.result === 'win' ? t(lang, 'victory') : t(lang, 'defeat')}
                    </span>
                  )}
                  <span className="vod-summary-duration">{fmt(vod.duration)}</span>
                  <span className="vod-summary-date">{vod.date ? new Date(vod.date).toLocaleDateString() : ''}</span>
                </div>
                <span className="vod-summary-note">{t(lang, 'videoRecordingUnavailable')}</span>
              </div>
            )}

            {hasVideo && !playing && (
              <div className="vod-play-overlay" onClick={(e) => { e.stopPropagation(); togglePlay() }}>
                <span className="vod-play-btn-big">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 3 21 12 6 21 6 3" />
                  </svg>
                </span>
              </div>
            )}

            {hasVideo && (
              <div
                className="vod-deck"
                style={{
                  opacity: showDeck ? 1 : 0,
                  pointerEvents: showDeck ? 'auto' : 'none',
                  transform: showDeck ? 'translateY(0)' : 'translateY(10px)',
                  transition: 'opacity 0.22s ease, transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
                  zIndex: 30,
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => bumpUi()}
              >
                <div className="vod-deck-row">
                  <button className="vod-ctrl-btn vod-playpause" onClick={(e) => { e.stopPropagation(); togglePlay() }} title={playing ? 'Pause' : 'Play'}>
                    {playing ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="6 3 21 12 6 21 6 3" />
                      </svg>
                    )}
                  </button>

                  <span className="vod-time now">{fmt(currentTime)}</span>
                  <span className="vod-time-sep">/</span>
                  <span className="vod-time total">{fmt(duration)}</span>

                  <div className="vod-deck-spacer" />

                  <div
                    className="vod-volume-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="vod-ctrl-btn vod-mute-btn"
                      onClick={(e) => { e.stopPropagation(); toggleMute() }}
                      title={muted ? t(lang, 'volUnmute') : t(lang, 'volMute')}
                    >
                      {VolIcon}
                    </button>
                    <div className="vod-volume-slider">
                      <input
                        type="range"
                        className="vod-volume"
                        min="0" max="1" step="0.05"
                        value={muted ? 0 : volume}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          setVolume(v)
                          if (v > 0) { lastVolRef.current = v; setMuted(false) }
                        }}
                        aria-label={t(lang, 'volMute')}
                      />
                    </div>
                  </div>

                  <div className="vod-speed-wrap">
                    <button className="vod-ctrl-btn vod-speed-btn" onClick={() => setShowSpeed(!showSpeed)}>
                      {playbackRate}x
                    </button>
                    {showSpeed && (
                      <div className="vod-speed-menu">
                        {speeds.map(s => (
                          <button key={s} className={`vod-speed-opt ${s === playbackRate ? 'active' : ''}`} onClick={() => setSpeed(s)}>
                            {s}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {clipping ? (
                    <button className="vod-ctrl-btn vod-clip-active" onClick={endClip} title={t(lang, 'setClipEnd')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" strokeWidth="2">
                        <circle cx="6" cy="6" r="3" />
                        <circle cx="6" cy="18" r="3" />
                        <line x1="20" y1="4" x2="8.12" y2="15.88" />
                        <line x1="14.47" y1="14.48" x2="20" y2="20" />
                        <line x1="8.12" y1="8.12" x2="12" y2="12" />
                      </svg>
                      {clipEnd === null && <span className="clip-pulse" />}
                    </button>
                  ) : (
                    <button className="vod-ctrl-btn" onClick={startClip} title={t(lang, 'createClip')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6" cy="6" r="3" />
                        <circle cx="6" cy="18" r="3" />
                        <line x1="20" y1="4" x2="8.12" y2="15.88" />
                        <line x1="14.47" y1="14.48" x2="20" y2="20" />
                        <line x1="8.12" y1="8.12" x2="12" y2="12" />
                      </svg>
                    </button>
                  )}

                  {clipStart !== null && clipEnd !== null && (
                    <button className="vod-ctrl-btn vod-clip-save" onClick={createClip} title={t(lang, 'saveClip')}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                    </button>
                  )}

                  {(clipStart !== null || clipEnd !== null) && (
                    <button className="vod-ctrl-btn" onClick={clearClip} title={t(lang, 'clearClip')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}

                  <button className="vod-ctrl-btn" onClick={(e) => { e.stopPropagation(); toggleFullscreen() }} title={t(lang, 'fullscreen')}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {showTeamsProp !== false && showTeams && (
          <div className="vod-sidebar-right">
            <div className="vod-sidebar-header">
              <span className="vod-sidebar-title">{t(lang, 'teams')}</span>
              <button className="vod-sidebar-toggle" onClick={() => setShowTeams(false)} title={t(lang, 'toggleTeams')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="vod-sidebar-scroll">
              {pending && team1.length === 0 && team2.length === 0 ? (
                <div className="vod-pending-notice">
                  <span className="vod-pending-dot big" />
                  <p className="vod-pending-title">{t(lang, 'pendingMatchTitle')}</p>
                  <p className="vod-pending-desc">{t(lang, 'pendingMatchDesc')}</p>
                </div>
              ) : (
                <>
                  {team1.length > 0 && (
                    <PlayerTeamPanel team={team1} teamLabel={t(lang, 'blueTeam')} isWinner={mv.winner === 1} lang={lang} />
                  )}
                  {team2.length > 0 && (
                    <PlayerTeamPanel team={team2} teamLabel={t(lang, 'redTeam')} isWinner={mv.winner === 2} lang={lang} />
                  )}
                  {team1.length === 0 && team2.length === 0 && (
                    <div className="vod-no-teams">
                      <p>{t(lang, 'noTeamData')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <NeonTimeline
        matchId={pending ? '' : mv.matchId}
        puuid={evPuuid}
        lang={lang}
        duration={duration}
        current={currentTime}
        onSeek={seek}
        localData={localEvents}
        gameTimeOffset={mv.gameTimeOffset || 0}
      />
    </div>
  )
}
