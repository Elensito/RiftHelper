import { useEffect, useState } from 'react'
import SearchBar from './components/SearchBar.jsx'
import ProfileHeader from './components/ProfileHeader.jsx'
import MatchCard from './components/MatchCard.jsx'
import LangSwitcher from './components/LangSwitcher.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import { fetchSummoner } from './api.js'
import { t } from './i18n.js'

export default function App() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lang, setLang] = useState('en')
  const [theme, setTheme] = useState(() => localStorage.getItem('rh-theme') || 'dark')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('rh-theme', theme)
  }, [theme])

  const load = async (name, tag, silent = false) => {
    setError('')
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await fetchSummoner(name, tag)
      setProfile(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const openPlayer = (name, tag) => {
    if (!name) return
    window.history.pushState(null, '', `/?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`)
    load(name, tag)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const name = params.get('name')
    const tag = params.get('tag')
    if (name && tag) load(name, tag)

  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">RIFT<span>HELPER</span></div>
        <SearchBar onSearch={(n, t) => load(n, t)} loading={loading} lang={lang} />
        <button
          className="btn btn-update"
          disabled={!profile || refreshing}
          onClick={() =>
            profile && load(profile.summoner.name, profile.summoner.tag, true)
          }
        >
          <span className={`refresh ${refreshing ? 'spin' : ''}`}>⟳</span>
          {t(lang, 'update')}
        </button>
        <LangSwitcher lang={lang} onChange={setLang} />
      </header>

      <ThemeToggle theme={theme} onChange={setTheme} />

      {error && (
        <div className="error-banner">
          <span className="err-dot">⚠</span> {error}
        </div>
      )}

      <main className="content">
        {!profile && !loading && !error && (
          <div className="hero">
            <h1>{t(lang, 'heroTitle')}</h1>
            <p className="hero-sub">{t(lang, 'heroSub')}</p>
          </div>
        )}

        {loading && (
          <div className="loader">
            <div className="spinner" />
            {t(lang, 'loading')}
          </div>
        )}

        {profile && !loading && (
          <>
            <ProfileHeader summoner={profile.summoner} matches={profile.matches} lang={lang} />
            <div className="match-list">
              {profile.matches.map((m) => (
                <MatchCard
                  key={m.match_id}
                  match={m}
                  lang={lang}
                  puuid={profile.summoner.puuid}
                  onOpenPlayer={openPlayer}
                />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        RiftHelper · {t(lang, 'footerRiot')} · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
