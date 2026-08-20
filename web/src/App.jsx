import { useEffect, useRef, useState } from 'react'
import SearchBar from './components/SearchBar.jsx'
import ProfileHeader from './components/ProfileHeader.jsx'
import RankCards from './components/RankCards.jsx'
import ChampionStats from './components/ChampionStats.jsx'
import MatchCard from './components/MatchCard.jsx'
import LiveGame from './components/LiveGame.jsx'
import QueueFilter from './components/QueueFilter.jsx'
import LangSwitcher from './components/LangSwitcher.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import DiscordButton from './components/DiscordButton.jsx'
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
import { fetchSummoner, fetchLatestMatch, fetchLiveGame, fetchMastery, fetchChampions, fetchChampion } from './api.js'
import { isTauri, getRiotClientSession, notifyGameEnded } from './tauri.js'
import { matchGroup, t } from './i18n.js'

const PAGE_SIZE = 20

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
  const [navOpen, setNavOpen] = useState(false)
  const [activeVod, setActiveVod] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sentinelRef = useRef(null)
  const latestMatchRef = useRef(null)
  const busyRef = useRef(false)
  const loadRef = useRef(null)

  useEffect(() => {
    loadRef.current = load
  })

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
    if (tab !== 'live' || !profile) return
    let wasInGame = null
    const poll = async () => {
      try {
        const data = await fetchLiveGame(profile.summoner.name, profile.summoner.tag)
        setLive(data)
        if (wasInGame === true && !data.in_game) {
          notifyGameEnded(profile.summoner, lang)
        }
        wasInGame = !!data.in_game
        if (!data.in_game) setTab('matches')
      } catch (e) {}
    }
    const id = setInterval(poll, 30000)
    return () => clearInterval(id)
  }, [tab, profile, lang])

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
          load(sName, sTag)
        }
      }).catch(() => {})
    }
  }, [])

  return (
    <div className="app">
      <Tooltip />
      <NavSidebar
        open={navOpen}
        onToggle={() => setNavOpen(!navOpen)}
        view={view}
        onNavigate={(v) => { setView(v); setActiveVod(null); setChampion(null) }}
        lang={lang}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      {view === 'rift-timeline' && activeVod ? (
        <VODPlayer vod={activeVod} lang={lang} onBack={() => setActiveVod(null)} />
      ) : view === 'rift-timeline' ? (
        <>
          <header className="topbar">
            <div className="topbar-left-spacer" />
            <SearchBar
              onSearch={(n, t) => load(n, t)}
              loading={loading}
              lang={lang}
              searchText={searchText}
              onSearchTextChange={setSearchText}
            />
            <div className="topbar-right">
              {profile && (
                <span className="topbar-summoner-pill">
                  <img
                    className="topbar-summoner-avatar"
                    src={`https://ddragon.leagueoflegends.com/cdn/14.10.1/img/profileicon/${profile.summoner.icon || 0}.png`}
                    alt=""
                  />
                  <span>{profile.summoner.name}#{profile.summoner.tag}</span>
                </span>
              )}
              <LangSwitcher lang={lang} onChange={setLang} />
              <DiscordButton lang={lang} />
              <ThemeToggle theme={theme} onChange={setTheme} />
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
          <header className="topbar">
            <div className="topbar-left-spacer" />
            <SearchBar
              onSearch={(n, t) => load(n, t)}
              loading={loading}
              lang={lang}
              searchText={searchText}
              onSearchTextChange={setSearchText}
            />
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
                    <svg
                      className="refresh-icon"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M23 4v6h-6"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M1 20v-6h6"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {t(lang, 'update')}
                </button>
              )}
              <LangSwitcher lang={lang} onChange={setLang} />
              <DiscordButton lang={lang} />
              {isTauri() && <RiotClientWidget lang={lang} onOpen={openPlayer} />}
              {!isTauri() && <DownloadButton lang={lang} />}
              <ThemeToggle theme={theme} onChange={setTheme} />
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

      <AICoach matches={profile ? profile.matches : []} lang={lang} puuid={profile ? profile.summoner.puuid : null} summonerName={profile ? profile.summoner.name : null} onLangChange={setLang} />
    </div>
  )
}
