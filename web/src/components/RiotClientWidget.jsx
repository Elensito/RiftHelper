import { useEffect, useState } from 'react'
import Img from './Img.jsx'
import { t } from '../i18n.js'
import { isTauri, getRiotClientSession } from '../tauri.js'
import { fetchWidgetSummoner } from '../api.js'

function RiotMark() {
  return (
    <svg className="riot-logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="riot-mark-g" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="var(--cyan)" />
          <stop offset="1" stopColor="var(--violet)" />
        </linearGradient>
      </defs>
      <path
        d="M12 1.8 21 7v10l-9 5.2L3 17V7l9-5.2z"
        stroke="url(#riot-mark-g)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 8.2h4.2L11.4 12h2l-3.6 4v-3.6l1.4-1.6"
        fill="url(#riot-mark-g)"
      />
    </svg>
  )
}

export default function RiotClientWidget({ lang, onOpen }) {
  const [status, setStatus] = useState('idle')
  const [summoner, setSummoner] = useState(null)
  const [error, setError] = useState(null)

  const detect = async () => {
    if (!isTauri()) return
    setStatus('loading')
    setError(null)
    const result = await getRiotClientSession()
    if (!result || !result.ok || !result.session) {
      setError(result?.error || t(lang, 'riotNotDetected'))
      setStatus('unavailable')
      return
    }
    const session = result.session
    try {
      const data = await fetchWidgetSummoner(session.game_name, session.game_tag || 'EUW')
      setSummoner(data)
      setStatus('connected')
    } catch (e) {
      setError(e?.message || t(lang, 'riotNotDetected'))
      setStatus('unavailable')
    }
  }

  useEffect(() => {
    detect()
  }, [])

  if (!isTauri()) return null

  if (status === 'idle' || status === 'loading') {
    return (
      <button
        className="riot-widget riot-loading"
        title={t(lang, 'riotConnecting')}
        aria-label={t(lang, 'riotConnecting')}
      >
        <span className="riot-spinner" />
      </button>
    )
  }

  if (status === 'unavailable') {
    return (
      <button
        className="riot-widget riot-unavailable"
        onClick={detect}
        title={error || t(lang, 'riotNotDetected')}
        aria-label={t(lang, 'riotNotDetected')}
      >
        <RiotMark />
        <span className="riot-lbl">Riot Client</span>
      </button>
    )
  }

  return (
    <button
      className="riot-widget"
      onClick={() => onOpen(summoner.name, summoner.tag)}
      title={`${t(lang, 'riotAccount')} · ${summoner.name}#${summoner.tag} · ${t(lang, 'riotLevel')} ${summoner.level}`}
      aria-label={`${summoner.name}#${summoner.tag}`}
    >
      <span className="riot-status-dot" aria-hidden="true" />
      <Img className="riot-avatar" src={summoner.profile_icon} alt={summoner.name} />
      <span className="riot-name">{summoner.name}</span>
      <span className="riot-tag">#{summoner.tag}</span>
      <span className="riot-lvl">{summoner.level}</span>
    </button>
  )
}
