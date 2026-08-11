import { useEffect, useState } from 'react'
import SearchBar from './components/SearchBar.jsx'
import ProfileHeader from './components/ProfileHeader.jsx'
import MatchCard from './components/MatchCard.jsx'
import { fetchSummoner } from './api.js'

export default function App() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const name = params.get('name')
    const tag = params.get('tag')
    if (name && tag) load(name, tag)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">RIFT<span>HELPER</span></div>
        <SearchBar onSearch={(n, t) => load(n, t)} loading={loading} />
        <button
          className="btn btn-update"
          disabled={!profile || refreshing}
          onClick={() =>
            profile && load(profile.summoner.name, profile.summoner.tag, true)
          }
        >
          <span className={`refresh ${refreshing ? 'spin' : ''}`}>⟳</span>
          Actualizar
        </button>
      </header>

      {error && (
        <div className="error-banner">
          <span className="err-dot">⚠</span> {error}
        </div>
      )}

      <main className="content">
        {!profile && !loading && !error && (
          <div className="hero">
            <h1>Analiza las partidas de cualquier invocador</h1>
            <p className="hero-sub">
              Busca por <b>Nombre#tag</b> y descubre runas, builds, oro y daño de los
              10 jugadores de cada partida.
            </p>
          </div>
        )}

        {loading && (
          <div className="loader">
            <div className="spinner" />
            Cargando partidas…
          </div>
        )}

        {profile && !loading && (
          <>
            <ProfileHeader summoner={profile.summoner} matches={profile.matches} />
            <div className="match-list">
              {profile.matches.map((m) => (
                <MatchCard key={m.match_id} match={m} />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="footer">
        RiftHelper · datos no oficiales de Riot Games · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
