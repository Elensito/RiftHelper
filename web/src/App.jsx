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
import { isTauri, getRiotClientSession, notifyGameEnded, startRecordingTauri, stopRecordingTauri, getAutoRecord, isLolWindowOpen, showOverlay, hideOverlay } from './tauri.js'
import { matchGroup, t } from './i18n.js'

const PAGE_SIZE = 20

const QUEUE_NAMES = {
  0: 'Custom',
  2: '5v5 Blind Pick',
  4: '5v5 Draft Pick',
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingExiting, setRecordingExiting] = useState(false)
  const recordingStartRef = useRef(null)
  const recordingGameDataRef = useRef(null)
  const recordingActiveRef = useRef(false)
  const autoRecordRef = useRef(null)
  const wasInGameRef = useRef(null)
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

    /* Shared end-of-game flow: stop ffmpeg, save the VOD entry, backfill stats */
    const finalizeRecording = async () => {
      wasInGameRef.current = false
      hideOverlay()
      if (!recordingStartRef.current) return
      const duration = Math.floor((Date.now() - recordingStartRef.current) / 1000)
      recordingStartRef.current = null
      setRecordingExiting(true)
      setTimeout(() => {
        setIsRecording(false)
        setRecordingExiting(false)
      }, 600)
      let videoPath = null
      if (recordingActiveRef.current) {
        try { videoPath = await stopRecordingTauri() } catch {}
        recordingActiveRef.current = false
      }
      const gd = recordingGameDataRef.current || {}
            const playerTeam = (gd.teams || []).find(t =>
              (t.players || []).some(p => p.is_player)
            )
            const player = playerTeam
              ? playerTeam.players.find(p => p.is_player)
              : null
            let champion = player ? player.champion : ''
            let championIcon = player ? player.champion_icon : ''
            const queue = gd.queue || ''
            let result = ''
            let kda = ''
            let latestMatchId = ''
            let team1 = []
            let team2 = []
            let matchDuration = 0
            let winner = 0
            try {
              const matchRes = await fetchLatestMatch(profile.summoner.name, profile.summoner.tag)
              if (matchRes && matchRes.latest_match_id) {
                latestMatchId = matchRes.latest_match_id
                const match = (profile.matches || []).find(m => m.match_id === matchRes.latest_match_id)
                if (match) {
                  matchDuration = match.duration_sec || 0
                  const bluePlayers = (match.players || []).filter(p => p.team === 100)
                  const redPlayers = (match.players || []).filter(p => p.team === 200)
                  const blueWins = bluePlayers.length > 0 ? bluePlayers[0].win : false
                  winner = blueWins ? 1 : 2
                  team1 = bluePlayers.map(p => ({
                    name: p.player_name || '',
                    champion: p.champion || '',
                    championIcon: p.champion_icon || '',
                    kills: p.kills || 0,
                    deaths: p.deaths || 0,
                    assists: p.assists || 0,
                    cs: p.cs || 0,
                    gold: p.gold || 0,
                    items: (p.items || []).map(it => it ? (it.src || '') : '').filter(Boolean),
                    isPlayer: p.is_player || false,
                  }))
                  team2 = redPlayers.map(p => ({
                    name: p.player_name || '',
                    champion: p.champion || '',
                    championIcon: p.champion_icon || '',
                    kills: p.kills || 0,
                    deaths: p.deaths || 0,
                    assists: p.assists || 0,
                    cs: p.cs || 0,
                    gold: p.gold || 0,
                    items: (p.items || []).map(it => it ? (it.src || '') : '').filter(Boolean),
                    isPlayer: p.is_player || false,
                  }))
                  const me = (match.players || []).find(p => p.puuid === profile.summoner.puuid)
                  if (me) {
                    champion = champion || me.champion || ''
                    championIcon = championIcon || me.champion_icon || ''
                    result = me.win ? 'win' : 'loss'
                    kda = `${me.kills || 0}/${me.deaths || 0}/${me.assists || 0}`
                  }
                }
              }
            } catch (e) {}
            if (team1.length === 0 && team2.length === 0) {
              team1 = (gd.teams || []).find(t => t.team_id === 100)?.players?.map(p => ({
                name: p.summoner_name || '',
                champion: p.champion || '',
                championIcon: p.champion_icon || '',
                kills: 0, deaths: 0, assists: 0, gold: 0,
                items: [], isPlayer: p.is_player || false,
              })) || []
              team2 = (gd.teams || []).find(t => t.team_id === 200)?.players?.map(p => ({
                name: p.summoner_name || '',
                champion: p.champion || '',
                championIcon: p.champion_icon || '',
                kills: 0, deaths: 0, assists: 0, gold: 0,
                items: [], isPlayer: p.is_player || false,
              })) || []
            }
            const vods = JSON.parse(localStorage.getItem('rh-vods') || '[]')
            const vodId = `vod-${Date.now()}`
            vods.unshift({
              id: vodId,
              date: Date.now(),
              duration: matchDuration || duration,
              champion,
              championIcon,
              result,
              kda,
              queue: queueName(queue),
              matchId: latestMatchId,
              thumbnail: '',
              events: [],
              team1,
              team2,
              winner,
              hasVideo: !!videoPath,
              videoPath: videoPath || '',
            })
            localStorage.setItem('rh-vods', JSON.stringify(vods))
            window.dispatchEvent(new Event('rh-vods-changed'))

            const needsBackfill = team1.length > 0 && team1.every(p => p.kills === 0 && p.deaths === 0) && latestMatchId
            if (needsBackfill) {
              const backfillVodId = vodId
              const backfillMatchId = latestMatchId
              const backfillName = profile.summoner.name
              const backfillTag = profile.summoner.tag
              const backfillPuuid = profile.summoner.puuid
              setTimeout(async () => {
                try {
                  const freshData = await fetchSummoner(backfillName, backfillTag, 20, 0, true)
                  const match = (freshData.matches || []).find(m => m.match_id === backfillMatchId)
                  if (!match) return
                  const allVods = JSON.parse(localStorage.getItem('rh-vods') || '[]')
                  const vod = allVods.find(v => v.id === backfillVodId)
                  if (!vod) return
                  const bluePlayers = (match.players || []).filter(p => p.team === 100)
                  const redPlayers = (match.players || []).filter(p => p.team === 200)
                  const blueWins = bluePlayers.length > 0 ? bluePlayers[0].win : false
                  vod.winner = blueWins ? 1 : 2
                  vod.duration = match.duration_sec || vod.duration
                  vod.team1 = bluePlayers.map(p => ({
                    name: p.player_name || '',
                    champion: p.champion || '',
                    championIcon: p.champion_icon || '',
                    kills: p.kills || 0,
                    deaths: p.deaths || 0,
                    assists: p.assists || 0,
                    cs: p.cs || 0,
                    gold: p.gold || 0,
                    items: (p.items || []).map(it => it ? (it.src || '') : '').filter(Boolean),
                    isPlayer: p.is_player || false,
                  }))
                  vod.team2 = redPlayers.map(p => ({
                    name: p.player_name || '',
                    champion: p.champion || '',
                    championIcon: p.champion_icon || '',
                    kills: p.kills || 0,
                    deaths: p.deaths || 0,
                    assists: p.assists || 0,
                    cs: p.cs || 0,
                    gold: p.gold || 0,
                    items: (p.items || []).map(it => it ? (it.src || '') : '').filter(Boolean),
                    isPlayer: p.is_player || false,
                  }))
                  const me = (match.players || []).find(p => p.puuid === backfillPuuid)
                  if (me) {
                    vod.result = me.win ? 'win' : 'loss'
                    vod.kda = `${me.kills || 0}/${me.deaths || 0}/${me.assists || 0}`
                  }
                  localStorage.setItem('rh-vods', JSON.stringify(allVods))
                  window.dispatchEvent(new Event('rh-vods-changed'))
                } catch (e) {}
              }, 30000)
            }

      recordingGameDataRef.current = null
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
        if (inGame && wasInGameRef.current !== true) {
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
              recordingStartRef.current = Date.now()
              setIsRecording(true)
              recordingActiveRef.current = true
              showOverlay(lang)
              startRecordingTauri().then(path => {
                if (!path) recordingActiveRef.current = false
              }).catch(() => { recordingActiveRef.current = false })
            }
            tryRecord()
          }
        }
        if (!inGame && wasInGameRef.current === true) {
          await finalizeRecording()
        }
        wasInGameLocal = inGame
      } catch (e) {}
    }
    poll()
    const id = setInterval(poll, 15000)

    /* Fast watchdog while recording: poll the LoL window every 1.5s via
       WinAPI so the end of the game is detected within ~3s of the client
       closing, instead of waiting for the 15s backend live-game poll */
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
        if (wdMisses >= 2) {
          wdMisses = 0
          await finalizeRecording()
        }
      } catch {}
    }, 1500)

    return () => { clearInterval(id); clearInterval(wd) }
  }, [profile, tab, lang])

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
        onNavigate={(v) => { if (v !== 'rift-timeline' || isTauri()) setView(v); setActiveVod(null); setChampion(null) }}
        lang={lang}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      {view === 'rift-timeline' && activeVod ? (
        <VODPlayer vod={activeVod} lang={lang} puuid={profile?.summoner?.puuid} onBack={() => setActiveVod(null)} />
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
              onOpenVod={(vod) => setActiveVod(vod)}
              profile={profile}
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
