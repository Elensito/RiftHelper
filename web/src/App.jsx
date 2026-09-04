import { useEffect, useRef, useState, useCallback } from 'react'
import SearchBar from './components/SearchBar.jsx'
import RankCards from './components/RankCards.jsx'
import ProfileHeader from './components/ProfileHeader.jsx'
import ChampionStats from './components/ChampionStats.jsx'
import MatchCard from './components/MatchCard.jsx'
import LiveGame from './components/LiveGame.jsx'
import QueueFilter from './components/QueueFilter.jsx'
import DownloadButton from './components/DownloadButton.jsx'
import RiotClientWidget from './components/RiotClientWidget.jsx'
import Favorites from './components/Favorites.jsx'
import ChampionPage from './components/ChampionPage.jsx'
import Mastery from './components/Mastery.jsx'
import AICoach from './components/AICoach.jsx'
import Tooltip from './components/Tooltip.jsx'
import NavSidebar from './components/NavSidebar.jsx'
import RiftTimeline from './components/RiftTimeline.jsx'
import VODPlayer from './components/VODPlayer.jsx'
import AppSettings from './components/AppSettings.jsx'
import { fetchSummoner, fetchLatestMatch, fetchLiveGame, fetchMastery, fetchChampions, fetchChampion } from './api.js'
import { retryPendingMatches, loadVodsRaw, saveVodsRaw } from './match-resolver.js'
import { isTauri, getRiotClientSession, notifyGameEnded, startRecordingTauri, stopRecordingTauri, getAutoRecord, isLolWindowOpen, getLastGameMode, deleteVodFiles, getFocusAfterGame, focusWindow, localFileSrc } from './tauri.js'
import { matchGroup, t } from './i18n.js'

const PAGE_SIZE = 20

const QUEUE_NAMES = {
  0: 'Custom',
  2: '5v5 Blind Pick',
  4: '5v5 Draft Pick',
  310: 'Custom game',
  3100: 'Custom game',
  400: '5v5 Draft Pick',
  420: '5v5 Ranked Solo/Duo',
  430: '5v5 Blind Pick',
  440: '5v5 Ranked Flex',
  450: 'ARAM',
  2400: 'ARAM: MAYHEM',
  900: 'URF',
  1020: 'One for All',
  1300: 'Nexus Blitz',
  1700: 'Arena',
}

function queueName(id) {
  const n = QUEUE_NAMES[Number(id)]
  return n || (id ? `Queue ${id}` : '')
}

export default function App() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lang, setLang] = useState(() => localStorage.getItem('rh-lang') || 'en')
  const [theme, setTheme] = useState(() => localStorage.getItem('rh-theme') || 'dark')
  const [tab, setTab] = useState('matches')
  const [queueFilter, setQueueFilter] = useState('all')
  const [live, setLive] = useState(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const [fetched, setFetched] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [champions, setChampions] = useState([])
  const [searchText, setSearchText] = useState('')
  const [champion, setChampion] = useState(null)
  const [champLoading, setChampLoading] = useState(false)
  const [mastery, setMastery] = useState(null)
  const [masteryLoading, setMasteryLoading] = useState(false)
  const [view, setView] = useState('profile')
  const [ownProfile, setOwnProfile] = useState(false)

  const [activeVod, setActiveVod] = useState(null)
  const [activeHighlight, setActiveHighlight] = useState(null)
  const [riftSubTab, setRiftSubTab] = useState('recordings')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingExiting, setRecordingExiting] = useState(false)
  const recordingStartRef = useRef(null)
  const recordingGameDataRef = useRef(null)
  const recordingActiveRef = useRef(false)
  const autoRecordRef = useRef(null)
  const wasInGameRef = useRef(null)
  const finalizedAtRef = useRef(0)
  /* Latest match id known BEFORE the current game started — used to reject
     stale /check results that still point at the previous game */
  const preGameMatchIdRef = useRef('')
  const gameTimeOffsetRef = useRef(0) // gameTime at recording start (for timeline alignment)
  const sentinelRef = useRef(null)
  const latestMatchRef = useRef(null)
  const busyRef = useRef(false)
  const loadRef = useRef(null)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest('.rt-card')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [])

  useEffect(() => {
    fetchChampions().then(setChampions).catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('rh-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('rh-lang', lang)
    document.documentElement.lang = lang
  }, [lang])

  const load = async (name, tag, silent = false) => {
    setError('')
    setChampion(null)
    busyRef.current = true
    if (silent) setRefreshing(true)
    else setLoading(true)
    setFetched(0)
    setHasMore(true)
    setMoreLoading(false)
    try {
      const data = await fetchSummoner(name, tag, PAGE_SIZE, 0, true)
      setProfile(data)
      latestMatchRef.current = (data.matches[0] && data.matches[0].match_id) || null
      setFetched(PAGE_SIZE)
      setHasMore(!!data.has_more)
      setTab('matches')
      setQueueFilter('all')
      setLive(null)
      setMastery(null)
      setError('')
      document.title = `RiftHelper · ${data.summoner.name}#${data.summoner.tag}`
      fetchLiveGame(name, tag)
        .then((d) => setLive(d))
        .catch(() => {})
    } catch (e) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }

  const loadMore = async () => {
    if (!profile || moreLoading || !hasMore) return
    setMoreLoading(true)
    setError('')
    try {
      const data = await fetchSummoner(
        profile.summoner.name,
        profile.summoner.tag,
        PAGE_SIZE,
        fetched
      )
      setProfile((prev) => {
        const seen = new Set(prev.matches.map((m) => m.match_id))
        const fresh = data.matches.filter((m) => !seen.has(m.match_id))
        return { ...prev, matches: [...prev.matches, ...fresh] }
      })
      setFetched((f) => f + PAGE_SIZE)
      setHasMore(!!data.has_more)
    } catch (e) {
      setError(e.message)
    } finally {
      setMoreLoading(false)
    }
  }

  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  useEffect(() => {
    if (tab !== 'matches' || !sentinelRef.current) return
    const el = sentinelRef.current
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current()
      },
      { rootMargin: '250px 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [tab, profile])

  const openLive = async () => {
    if (!profile) return
    setTab('live')
    if (live) return
    setLiveLoading(true)
    setError('')
    try {
      const data = await fetchLiveGame(profile.summoner.name, profile.summoner.tag)
      setLive(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLiveLoading(false)
    }
  }

  useEffect(() => {
    if (!profile) return
    let wasInGameLocal = null
    let consecutiveNotInGame = 0

    /* Shared end-of-game flow: stop recording, save the VOD entry, backfill stats */
    const finalizeRecording = async () => {
      consecutiveNotInGame = 0
      wasInGameRef.current = false
      finalizedAtRef.current = Date.now()
      if (!recordingStartRef.current) return
      const duration = Math.floor((Date.now() - recordingStartRef.current) / 1000)
      recordingStartRef.current = null
      setRecordingExiting(true)
      setTimeout(() => {
        setIsRecording(false)
        setRecordingExiting(false)
      }, 600)
      let videoPath = null
      let realDuration = 0
      let realizedClips = []
      if (recordingActiveRef.current) {
        /* Backend returns { path, duration, clips } — duration is the exact
           file length probed with ffprobe, immune to start/stop wall-clock
           drift; clips are the hotkey-triggered highlight cuts. */
        try {
          const r = await stopRecordingTauri()
          if (r && typeof r === 'object') {
            videoPath = r.path || null
            realDuration = Math.round(r.duration || 0)
            realizedClips = Array.isArray(r.clips) ? r.clips : []
          } else if (typeof r === 'string') {
            videoPath = r
          }
        } catch {}
        recordingActiveRef.current = false
      }
      /* Nothing was actually captured (backend never started): don't save
         a ghost pending entry for an aborted attempt */
      if (!videoPath) return
      /* Discard very short recordings (< 10s): these are ghost VODs caused by
         the recording starting and immediately being finalized (e.g. window
         detection race or audio setup delay). */
      if ((realDuration || duration) < 10) return
      const gd = recordingGameDataRef.current || {}
      const preGameId = preGameMatchIdRef.current || ''

      /* Practice tool and custom games never appear in Riot's Match-V5
         index: creating them as "pending" would poll forever and risk
         binding some unrelated future match. Detect the mode from the
         LCD capture AND from the live-game queue ID (belt + suspenders)
         and mark those VODs as final from the start. */
      let gameModeRaw = ''
      try { gameModeRaw = (await getLastGameMode()) || '' } catch {}
      const queue = gd.queue || ''
      const queueNum = Number(queue)
      const unindexed = /practice|custom/i.test(gameModeRaw)
        || /practice|custom/i.test(String(gd.game?.mode || gd.game?.gameMode || ''))
        || queueNum === 3100
      /* Champion snapshot from the live-game data captured at record time */
      let champion = ''
      let championIcon = ''
      let role = ''
      {
        const lt = (gd.teams || []).find(t => (t.players || []).some(p => p.is_player))
        const lp = lt ? lt.players.find(p => p.is_player) : null
        if (lp) {
          champion = lp.champion || ''
          championIcon = lp.champion_icon || ''
          role = (lp.position || lp.role || '').toUpperCase()
          if (role === 'MIDDLE') role = 'MID'
          if (role === 'UTILITY') role = 'SUPPORT'
          if (role === 'BOT') role = 'BOTTOM'
        }
      }

      /* Riot takes 1–5 min to index a finished match, so the latest-match
         endpoint still returns the PREVIOUS game right after the end. The VOD
         is saved immediately as "pending" and patched with real data by
         retryPendingMatches() as soon as Riot indexes it. */
      const vods = loadVodsRaw()
      const vodId = `vod-${Date.now()}`
      vods.unshift({
        id: vodId,
        date: Date.now(),
        duration: realDuration || duration,
        champion,
        championIcon,
        role,
        result: '',
        kda: '',
        queue: queueName(queue),
        matchId: '',
        puuid: profile.summoner.puuid || '',
        thumbnail: '',
        events: [],
        team1: [],
        team2: [],
        winner: 0,
        hasVideo: !!videoPath,
        videoPath: videoPath || '',
        pendingMatch: !unindexed,
        pendingChampion: champion,
        pendingAt: Date.now(),
        gameTimeOffset: gameTimeOffsetRef.current || 0, // gameTime at recording start for timeline alignment
      })
      saveVodsRaw(vods)

      /* Hotkey-triggered clips cut by the backend during this session: append
         them to the clips library so they show up in the Clips tab. */
      if (realizedClips.length) {
        try {
          const existing = JSON.parse(localStorage.getItem('rh-clips') || '[]')
          const now = Date.now()
          const newClips = []
          for (let i = 0; i < realizedClips.length; i++) {
            const c = realizedClips[i]
            newClips.push({
              id: `${vodId}::clip-${now}-${i}`,
              vodId,
              start: c.start_abs || 0,
              end: c.end_abs || 0,
              date: now - i,
              path: c.path || '',
              thumb: (await localFileSrc(c.thumb)) || '',
            })
          }
          localStorage.setItem('rh-clips', JSON.stringify([...newClips, ...existing]))
          window.dispatchEvent(new Event('rh-clips-changed'))
        } catch {}
      }

      /* "Focus after game": bring the app to the foreground on match end. */
      if (isTauri()) {
        try {
          if (await getFocusAfterGame()) focusWindow()
        } catch {}
      }

      /* Immediate attempt (sometimes Riot indexes fast), then background
         retries for ~5 min. preGameId rejects stale results pointing at the
         game BEFORE this one. */
      retryPendingMatches(profile.summoner, [preGameId]).catch(() => {})
      let attempts = 0
      const tick = async () => {
        attempts += 1
        try {
          const left = await retryPendingMatches(profile.summoner, [preGameId])
          if (left === 0) return
        } catch {}
        if (attempts < 15) setTimeout(tick, 20000)
      }
      setTimeout(tick, 20000)

      recordingGameDataRef.current = null
      gameTimeOffsetRef.current = 0
    }

    const poll = async () => {
      try {
        const data = await fetchLiveGame(profile.summoner.name, profile.summoner.tag)
        setLive(data)
        const inGame = !!data.in_game
        if (tab === 'live') {
          if (wasInGameLocal === true && !inGame) {
            notifyGameEnded(profile.summoner, lang)
          }
          if (!inGame) setTab('matches')
        }
        if (inGame && wasInGameRef.current !== true && Date.now() - finalizedAtRef.current > 30000) {
          wasInGameRef.current = true
          if (isTauri()) {
            recordingGameDataRef.current = {
              game: data.game || null,
              teams: data.teams || [],
              queue: data.game?.queue || '',
            }
            const tryRecord = () => {
              if (autoRecordRef.current === null) {
                getAutoRecord().then(v => {
                  autoRecordRef.current = v
                  if (v) doRecord()
                }).catch(() => { autoRecordRef.current = false })
              } else if (autoRecordRef.current) {
                doRecord()
              }
            }
            const doRecord = () => {
              if (recordingActiveRef.current || recordingStartRef.current) return
              preGameMatchIdRef.current = latestMatchRef.current || ''
              recordingStartRef.current = Date.now()
              setIsRecording(true)
              recordingActiveRef.current = true
              /* On failure every ref must be cleared, otherwise the next poll
                 finalizes this aborted attempt as a zero-length ghost VOD */
              const abort = () => {
                recordingActiveRef.current = false
                recordingStartRef.current = null
                gameTimeOffsetRef.current = 0
                setIsRecording(false)
              }
              startRecordingTauri().then(result => {
                if (!result || !result.path) { abort(); return }
                // Store gameTime for timeline alignment with video
                gameTimeOffsetRef.current = result.gameTime || 0
              }).catch(abort)
            }
            tryRecord()
          }
        }
        if (!inGame && wasInGameRef.current === true) {
          consecutiveNotInGame += 1
          /* 3 misses = 45s: a spurious live-game hiccup must never cut a
             recording mid-match; real game ends stay false for good */
          if (consecutiveNotInGame >= 3) {
            await finalizeRecording()
          }
        } else if (inGame) {
          consecutiveNotInGame = 0
        }
        wasInGameLocal = inGame
      } catch (e) {}
    }
    poll()
    const id = setInterval(poll, 15000)

    /* Fast watchdog while recording: the backend reports whether the game
       window still EXISTS (minimized/occluded counts as open — v1.5.84).
       Require ~15s of continuous absence so a focus steal or minimize can
       never finalize the recording; a real game end destroys the window
       immediately, so detection stays fast. */
    let wdMisses = 0
    const wd = setInterval(async () => {
      if (!recordingActiveRef.current || !recordingStartRef.current || !wasInGameRef.current) {
        wdMisses = 0
        return
      }
      try {
        const open = await isLolWindowOpen()
        if (open) { wdMisses = 0; return }
        wdMisses += 1
        if (wdMisses >= 10) {
          wdMisses = 0
          await finalizeRecording()
        }
      } catch {}
    }, 1500)

    return () => { clearInterval(id); clearInterval(wd) }
  }, [profile, tab, lang])

  useEffect(() => {
    if (!profile) return
    /* Resume pending VODs (app may have been closed before Riot indexed the
       match): patch them with real data every 25s while any remain pending. */
    const id = setInterval(() => {
      if (!loadVodsRaw().some(v => v.pendingMatch)) return
      retryPendingMatches(profile.summoner).catch(() => {})
    }, 25000)
    return () => clearInterval(id)
  }, [profile])

  useEffect(() => {
    if (!profile) return
    let stopped = false
    const check = async () => {
      if (busyRef.current) return
      try {
        const res = await fetchLatestMatch(profile.summoner.name, profile.summoner.tag)
        if (stopped || !res.latest_match_id) return
        if (res.latest_match_id !== latestMatchRef.current) {
          latestMatchRef.current = res.latest_match_id
          loadRef.current(profile.summoner.name, profile.summoner.tag, true)
        }
      } catch (e) {}
    }
    const id = setInterval(check, 30000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [profile])

  const openPlayer = (name, tag) => {
    if (!name) return
    setSearchText(`${name}#${tag}`)
    setOwnProfile(false)
    window.history.pushState(null, '', `/?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`)
    load(name, tag)
  }

  const openChampion = async (c) => {
    setChampion(null)
    setChampLoading(true)
    setError('')
    try {
      const data = await fetchChampion(c.key)
      setChampion(data)
      document.title = `RiftHelper · ${data.name}`
    } catch (e) {
      setError(e.message)
    } finally {
      setChampLoading(false)
    }
  }

  const goHome = () => {
    setChampion(null)
    setProfile(null)
    setLive(null)
    document.title = 'RiftHelper · Statistics & analysis'
    window.history.pushState(null, '', '/')
  }

  const openMastery = async () => {
    if (!profile) return
    setTab('mastery')
    if (mastery) return
    setMasteryLoading(true)
    setError('')
    try {
      const data = await fetchMastery(profile.summoner.name, profile.summoner.tag)
      setMastery(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setMasteryLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const name = params.get('name')
    const tag = params.get('tag')
    if (name && tag) {
      setSearchText(`${name}#${tag}`)
      load(name, tag)
      return
    }

    if (isTauri()) {
      getRiotClientSession().then((result) => {
        if (result && result.ok && result.session) {
          const s = result.session
          const sName = s.game_name
          const sTag = s.game_tag || 'EUW'
          setSearchText(`${sName}#${sTag}`)
          setOwnProfile(true)
          load(sName, sTag)
        }
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!settingsOpen && isTauri()) {
      getAutoRecord().then(v => { autoRecordRef.current = v }).catch(() => {})
    }
  }, [settingsOpen])

  return (
    <div className={`app ${view === 'rift-timeline' && activeVod ? 'app-full' : ''}`}>
      <Tooltip />
      <NavSidebar
        view={view}
        onNavigate={(v) => { if (v !== 'rift-timeline' || isTauri()) setView(v); setActiveVod(null); setActiveHighlight(null); setChampion(null) }}
        lang={lang}
        onSettingsOpen={() => setSettingsOpen(true)}
        riftSubTab={riftSubTab}
        onSubTabChange={setRiftSubTab}
      />

      {view === 'rift-timeline' && activeVod ? (
        (() => {
          const isCompetitiveQueue = /solo|flex/i.test(activeVod.queue || '')
          return <VODPlayer vod={activeVod} lang={lang} puuid={profile?.summoner?.puuid} summoner={profile?.summoner} onBack={() => { setActiveVod(null); setActiveHighlight(null) }} showTeamsProp={isCompetitiveQueue} highlight={activeHighlight} />
        })()
      ) : view === 'rift-timeline' ? (
        <>
          <header className="topbar topbar-icon-rail">
            <div className="topbar-right">
              {isTauri() && <RiotClientWidget lang={lang} onOpen={openPlayer} />}
              {!isTauri() && profile && (
                <span className="topbar-summoner-pill">
                  <img
                    className="topbar-summoner-avatar"
                    src={`https://ddragon.leagueoflegends.com/cdn/14.10.1/img/profileicon/${profile.summoner.icon || 0}.png`}
                    alt=""
                  />
                  <span>{profile.summoner.name}#{profile.summoner.tag}</span>
                </span>
              )}
            </div>
          </header>
          <main className="content">
            <RiftTimeline
              lang={lang}
              onOpenVod={(vod) => { setActiveVod(vod); setActiveHighlight(null) }}
              onOpenHighlight={(vod, hl) => { setActiveVod(vod); setActiveHighlight(hl) }}
              profile={profile}
              subTab={riftSubTab}
              onSubTabChange={setRiftSubTab}
              onDelete={(vod) => {
                if (confirm(t(lang, 'confirmDeleteVod'))) {
                  deleteVodFiles(vod.videoPath)
                  const vods = loadVodsRaw().filter(v => v.id !== vod.id)
                  saveVodsRaw(vods)
                }
              }}
            />
          </main>
        </>
      ) : (
        <>
          <header className="topbar topbar-icon-rail">
            <div className="topbar-left">
              <SearchBar
                onSearch={(n, t) => { setOwnProfile(false); load(n, t) }}
                loading={loading}
                lang={lang}
                searchText={searchText}
                onSearchTextChange={setSearchText}
              />
            </div>
            <div className="topbar-right">
              {profile && (
                <button
                  className="btn btn-update"
                  disabled={refreshing}
                  onClick={() =>
                    profile && load(profile.summoner.name, profile.summoner.tag, true)
                  }
                >
                  {refreshing ? (
                    <span className="btn-spinner" aria-hidden="true" />
                  ) : (
                    <svg className="refresh-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M23 4v6h-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M1 20v-6h6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {t(lang, 'update')}
                </button>
              )}
              {isTauri() && <RiotClientWidget lang={lang} onOpen={openPlayer} />}
              {!isTauri() && profile && (
                <div className="topbar-summoner-card" onClick={() => setTab('matches')}>
                  <img
                    className="topbar-summoner-avatar"
                    src={`https://ddragon.leagueoflegends.com/cdn/14.10.1/img/profileicon/${profile.summoner.profile_icon || 0}.png`}
                    alt=""
                  />
                  <div className="topbar-summoner-info">
                    <span className="topbar-summoner-name">{profile.summoner.name}</span>
                    <span className="topbar-summoner-tag">#{profile.summoner.tag}</span>
                  </div>
                </div>
              )}
            </div>
          </header>

          {error && (
            <div className="error-banner">
              <span className="err-dot">⚠</span> {error}
            </div>
          )}

          <main className="content">
            {champLoading && (
              <div className="loader">
                <div className="spinner" />
                {t(lang, 'loading')}
              </div>
            )}

            {champion && !champLoading && (
              <ChampionPage champ={champion} lang={lang} onOpenPlayer={openPlayer} />
            )}

            {!champion && !champLoading && !profile && !loading && !error && (
              <div className="hero">
                <Favorites onOpen={openPlayer} lang={lang} />
              </div>
            )}

            {loading && (
              <div className="loader">
                <div className="spinner" />
                {t(lang, 'loading')}
              </div>
            )}

            {profile && !loading && !champion && (
              <div className="profile-layout">
                <aside className="profile-sidebar">
                  <RankCards summoner={profile.summoner} lang={lang} />
                  <ChampionStats matches={profile.matches} lang={lang} />
                </aside>

                <div className="profile-main">
                  <ProfileHeader
                    summoner={profile.summoner}
                    matches={profile.matches}
                    lang={lang}
                    inGame={!!(live && live.in_game)}
                  />
                    <div className="profile-tabs">
                      <button
                        className={`tab ${tab === 'matches' ? 'active' : ''}`}
                        onClick={() => setTab('matches')}
                      >
                        {t(lang, 'tabMatches')}
                      </button>
                      <button
                        className={`tab ${tab === 'mastery' ? 'active' : ''}`}
                        onClick={openMastery}
                      >
                        {t(lang, 'tabMastery')}
                      </button>
                      {live && live.in_game && (
                        <button
                          className={`tab live-tab ${tab === 'live' ? 'active' : ''}`}
                          onClick={openLive}
                        >
                          {t(lang, 'tabLive')}
                          <span className="live-dot" />
                        </button>
                      )}
                    </div>

                    {tab === 'live' ? (
                      liveLoading ? (
                        <div className="loader">
                          <div className="spinner" />
                          {t(lang, 'liveLoading')}
                        </div>
                      ) : live && live.in_game ? (
                        <LiveGame data={live} lang={lang} openPlayer={openPlayer} />
                      ) : (
                        <div className="live-empty">{t(lang, 'liveNotInGame')}</div>
                      )
                    ) : tab === 'mastery' ? (
                      masteryLoading ? (
                        <div className="loader">
                          <div className="spinner" />
                          {t(lang, 'masteryLoading')}
                        </div>
                      ) : mastery && mastery.mastery.length ? (
                        <Mastery data={mastery} lang={lang} />
                      ) : (
                        <div className="live-empty">{t(lang, 'masteryEmpty')}</div>
                      )
                    ) : (
                      <div className="match-list">
                        <QueueFilter
                          matches={profile.matches}
                          filter={queueFilter}
                          onChange={setQueueFilter}
                          lang={lang}
                        />
                        {profile.matches
                          .filter(
                            (m) => queueFilter === 'all' || matchGroup(m.queue) === queueFilter
                          )
                          .map((m) => (
                            <MatchCard
                              key={m.match_id}
                              match={m}
                              lang={lang}
                              puuid={profile.summoner.puuid}
                              onOpenPlayer={openPlayer}
                            />
                          ))}
                        <div className="load-more" ref={sentinelRef}>
                          {moreLoading && (
                            <div className="loader-inline">
                              <div className="spinner spinner-sm" />
                              {t(lang, 'loadingMore')}
                            </div>
                          )}
                          {!hasMore && !moreLoading && fetched > PAGE_SIZE && (
                            <span className="no-more">{t(lang, 'noMoreMatches')}</span>
                          )}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {view === 'profile' && (
        <footer className="footer">
          RiftHelper · {t(lang, 'footerRiot')} · {new Date().getFullYear()}
        </footer>
      )}

      {view === 'profile' && ownProfile && profile && (
        <AICoach matches={profile.matches} lang={lang} puuid={profile.summoner.puuid} summonerName={profile.summoner.name} onLangChange={setLang} />
      )}

      {isTauri() && (isRecording || recordingExiting) && (
        <div className={`recording-overlay ${recordingExiting ? 'exiting' : ''}`}>
          <div className="recording-overlay-card">
            <img src="/ai_coach.png" alt="" className="recording-overlay-icon" draggable="false" />
            <div className="recording-overlay-text">
              <span className="recording-overlay-title">{t(lang, 'recording')}</span>
              <span className="recording-overlay-sub">Rift Timeline</span>
            </div>
            <span className="rec-rec-dot" />
          </div>
        </div>
      )}

      {settingsOpen && (
        <AppSettings
          theme={theme}
          onThemeChange={setTheme}
          lang={lang}
          onLangChange={setLang}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
