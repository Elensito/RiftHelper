import { useState, useRef, useEffect, useCallback } from 'react'
import { t } from '../i18n.js'
import Img from './Img.jsx'
import { isTauri } from '../tauri.js'

const EVENT_COLORS = {
  kill: 'var(--cyan)',
  death: 'var(--red)',
  assist: 'var(--green)',
  tower: 'var(--neon-purple)',
  dragon: '#ff9800',
  baron: '#ffd54f',
  herald: '#ab47bc',
  inhibitor: '#ff5722',
  firstBlood: 'var(--pink)',
  shutdown: '#ff9800',
}

function formatTime(sec) {
  if (!sec && sec !== 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

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

export default function VODPlayer({ vod, lang, onBack }) {
  const videoRef = useRef(null)
  const timelineRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrent] = useState(0)
  const [duration, setDuration] = useState(vod.duration || 0)
  const [volume, setVolume] = useState(0.8)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSpeed, setShowSpeed] = useState(false)
  const [clipping, setClipping] = useState(false)
  const [clipStart, setClipStart] = useState(null)
  const [clipEnd, setClipEnd] = useState(null)
  const [showTeams, setShowTeams] = useState(true)
  const [eventFilter, setEventFilter] = useState('all')
  const [videoUrl, setVideoUrl] = useState(null)

  const events = vod.events || []
  const team1 = vod.team1 || []
  const team2 = vod.team2 || []

  useEffect(() => {
    if (videoUrl || !vod.hasVideo) return
    if (vod.videoPath && isTauri()) {
      import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
        const url = convertFileSrc(vod.videoPath)
        setVideoUrl(url)
      }).catch(() => {})
    }
  }, [vod.id, vod.hasVideo, vod.videoPath])

  const filteredEvents = eventFilter === 'all'
    ? events
    : events.filter(e => e.type === eventFilter)

  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    const onTime = () => setCurrent(vid.currentTime)
    const onLoaded = () => setDuration(vid.duration)
    const onEnd = () => setPlaying(false)
    vid.addEventListener('timeupdate', onTime)
    vid.addEventListener('loadedmetadata', onLoaded)
    vid.addEventListener('ended', onEnd)
    return () => {
      vid.removeEventListener('timeupdate', onTime)
      vid.removeEventListener('loadedmetadata', onLoaded)
      vid.removeEventListener('ended', onEnd)
    }
  }, [])

  const togglePlay = () => {
    const vid = videoRef.current
    if (!vid) return
    if (playing) vid.pause()
    else vid.play()
    setPlaying(!playing)
  }

  const seek = (time) => {
    const vid = videoRef.current
    if (vid) vid.currentTime = time
  }

  const seekTimeline = (e) => {
    if (!timelineRef.current || !duration) return
    const rect = timelineRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(pct * duration)
  }

  const toggleSpeed = () => setShowSpeed(!showSpeed)
  const setSpeed = (rate) => {
    setPlaybackRate(rate)
    if (videoRef.current) videoRef.current.playbackRate = rate
    setShowSpeed(false)
  }

  const startClip = () => {
    setClipping(true)
    setClipStart(currentTime)
    setClipEnd(null)
  }
  const endClip = () => {
    setClipping(false)
    setClipEnd(currentTime)
  }
  const clearClip = () => {
    setClipping(false)
    setClipStart(null)
    setClipEnd(null)
  }

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
      a.download = vod.filename || 'vod.webm'
      a.click()
    }
  }

  const toggleFullscreen = () => {
    const el = document.querySelector('.vod-player-view')
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      el.requestFullscreen().catch(() => {})
    }
  }

  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

  const eventTypes = ['all', 'kill', 'death', 'tower', 'dragon', 'baron', 'inhibitor']
  const EVENT_LABELS = {
    all: t(lang, 'allEvents'),
    kill: 'Kill',
    death: 'Death',
    tower: t(lang, 'evTower'),
    dragon: t(lang, 'evDragon'),
    baron: t(lang, 'evBaron'),
    inhibitor: t(lang, 'evInhibitor'),
  }

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
          <span className="vod-topbar-champ">{vod.champion || ''}</span>
          <span className="vod-topbar-queue">{vod.queue || ''}</span>
          <span className="vod-topbar-date">{vod.date ? new Date(vod.date).toLocaleDateString() : ''}</span>
        </div>
        <div className="vod-topbar-actions">
          <button className="rt-btn rt-btn-ghost rt-btn-sm" onClick={downloadVod} title={t(lang, 'downloadVod')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="vod-main">
        <div className="vod-video-area">
          {!showTeams && (
            <button className="vod-show-teams-btn" onClick={() => setShowTeams(true)} title={t(lang, 'toggleTeams')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </button>
          )}
          <div className="vod-video-container" onClick={togglePlay}>
            {videoUrl ? (
              <video ref={videoRef} className="vod-video" src={videoUrl} preload="metadata" />
            ) : (
              <div className="vod-video-placeholder vod-match-summary">
                {vod.championIcon && (
                  <img className="vod-summary-champ" src={vod.championIcon} alt={vod.champion || ''} />
                )}
                <div className="vod-summary-info">
                  <span className="vod-summary-champ-name">{vod.champion || '—'}</span>
                  <span className="vod-summary-queue">{vod.queue || ''}</span>
                  {vod.kda && <span className="vod-summary-kda">{vod.kda}</span>}
                  {vod.result && (
                    <span className={`vod-summary-result ${vod.result}`}>
                      {vod.result === 'win' ? t(lang, 'victory') : t(lang, 'defeat')}
                    </span>
                  )}
                  <span className="vod-summary-duration">{formatTime(vod.duration)}</span>
                  <span className="vod-summary-date">{vod.date ? new Date(vod.date).toLocaleDateString() : ''}</span>
                </div>
                <span className="vod-summary-note">{t(lang, 'videoRecordingUnavailable')}</span>
              </div>
            )}
            {!playing && videoUrl && (
              <div className="vod-play-overlay">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="white" opacity="0.8">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
            )}
            {videoUrl && (
              <button className="vod-fullscreen-btn" onClick={(e) => { e.stopPropagation(); toggleFullscreen() }} title={t(lang, 'fullscreen')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              </button>
            )}
          </div>

          <div className="vod-controls">
            <button className="vod-ctrl-btn" onClick={togglePlay}>
              {playing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>

            <span className="vod-time">{formatTime(currentTime)}</span>

            <div className="vod-timeline-wrap" ref={timelineRef} onClick={seekTimeline}>
              <div className="vod-timeline-track">
                <div className="vod-timeline-progress" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
                {clipStart !== null && (
                  <div className="vod-clip-region" style={{
                    left: `${(Math.min(clipStart, clipEnd || currentTime) / duration) * 100}%`,
                    width: `${((Math.abs((clipEnd || currentTime) - clipStart)) / duration) * 100}%`
                  }} />
                )}
                {events.map((ev, i) => (
                  <div
                    key={i}
                    className="vod-event-marker"
                    style={{
                      left: `${duration ? (ev.time / duration) * 100 : 0}%`,
                      backgroundColor: EVENT_COLORS[ev.type] || 'var(--muted)',
                    }}
                    title={`${ev.label || ev.type} ${formatTime(ev.time)}`}
                    onClick={(e) => { e.stopPropagation(); seek(ev.time) }}
                  />
                ))}
              </div>
            </div>

            <span className="vod-time">{formatTime(duration)}</span>

            <div className="vod-speed-wrap">
              <button className="vod-ctrl-btn vod-speed-btn" onClick={toggleSpeed}>
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

            <input
              type="range"
              className="vod-volume"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setVolume(v)
                if (videoRef.current) videoRef.current.volume = v
              }}
            />

            {clipping ? (
              <button className="vod-ctrl-btn vod-clip-active" onClick={endClip} title={t(lang, 'setClipEnd')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" strokeWidth="2">
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          </div>
        </div>

        {showTeams && (
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
              {team1.length > 0 && (
                <PlayerTeamPanel team={team1} teamLabel={t(lang, 'blueTeam')} isWinner={vod.winner === 1} lang={lang} />
              )}
              {team2.length > 0 && (
                <PlayerTeamPanel team={team2} teamLabel={t(lang, 'redTeam')} isWinner={vod.winner === 2} lang={lang} />
              )}
              {team1.length === 0 && team2.length === 0 && (
                <div className="vod-no-teams">
                  <p>{t(lang, 'noTeamData')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="vod-events-bar">
        <div className="vod-events-filters">
          {eventTypes.map(ev => (
            <button
              key={ev}
              className={`vod-event-filter ${eventFilter === ev ? 'active' : ''}`}
              onClick={() => setEventFilter(ev)}
              style={ev !== 'all' ? { borderColor: EVENT_COLORS[ev] } : undefined}
            >
              {EVENT_LABELS[ev] || ev}
            </button>
          ))}
        </div>
        <div className="vod-events-list">
          {filteredEvents.length === 0 && (
            <span className="vod-events-empty">{t(lang, 'evEmpty')}</span>
          )}
          {filteredEvents.map((ev, i) => (
            <button
              key={i}
              className="vod-event-chip"
              style={{ borderColor: EVENT_COLORS[ev.type] || 'var(--muted)' }}
              onClick={() => seek(ev.time)}
            >
              <span className="vod-event-dot" style={{ backgroundColor: EVENT_COLORS[ev.type] || 'var(--muted)' }} />
              <span className="vod-event-time">{formatTime(ev.time)}</span>
              <span className="vod-event-label">{ev.label || ev.type}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
