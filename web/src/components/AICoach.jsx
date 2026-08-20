import { useState, useRef, useEffect, useCallback } from 'react'
import Markdown from 'react-markdown'
import Img from './Img.jsx'
import { t, LANGS, queueLabel } from '../i18n.js'
import { kdaRatio, fmtNum } from '../utils.js'
import { buildRichCoachingPrompt } from '../matchAnalysis.js'
import { fetchAICoach } from '../api.js'
import { isTauri } from '../tauri.js'

const MAX_SELECTED = 1

function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08)
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.06, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.25)
  } catch {}
}

function TypewriterText({ text, onDone, speed = 10 }) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)
  const idx = useRef(0)

  useEffect(() => {
    idx.current = 0
    setDisplayed('')
    setDone(false)
  }, [text])

  useEffect(() => {
    if (done) return
    if (idx.current >= text.length) {
      setDone(true)
      onDone && onDone()
      return
    }
    const char = text[idx.current]
    const delay = char === '\n' ? 35 : char === '.' || char === '!' || char === '?' ? 55 : speed
    const id = setTimeout(() => {
      idx.current++
      setDisplayed(text.slice(0, idx.current))
    }, delay)
    return () => clearTimeout(id)
  }, [displayed, text, speed, done, onDone])

  return (
    <span className="ai-coach-typed-text">
      {displayed.split('\n').map((line, i, arr) => (
        <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
      ))}
      {!done && <span className="ai-coach-cursor">|</span>}
    </span>
  )
}

function LangInline({ lang, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = LANGS.find(l => l.code === lang) || LANGS[0]

  return (
    <div className="ai-coach-lang" ref={ref}>
      <button className={`ai-coach-lang-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <img className="ai-coach-lang-flag" src={current.flagImg} alt="" draggable="false"
          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'inline' }} />
        <span className="ai-coach-lang-fb" style={{ display: 'none' }}>{current.flag}</span>
        <span className="ai-coach-lang-code">{current.code.toUpperCase()}</span>
        <svg className={`ai-coach-lang-caret ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="ai-coach-lang-menu">
          {LANGS.map(l => (
            <li key={l.code}>
              <button className={`ai-coach-lang-opt ${l.code === lang ? 'active' : ''}`}
                onClick={() => { onChange(l.code); setOpen(false) }}>
                <img className="ai-coach-lang-flag" src={l.flagImg} alt="" draggable="false"
                  onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'inline' }} />
                <span className="ai-coach-lang-fb" style={{ display: 'none' }}>{l.flag}</span>
                <span>{l.label}</span>
                {l.code === lang && <span className="ai-coach-lang-check">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MatchPicker({ matches, selected, onToggle, onConfirm, lang, onCancel }) {
  return (
    <div className="ai-coach-picker-overlay" onClick={onCancel}>
      <div className="ai-coach-picker" onClick={e => e.stopPropagation()}>
        <div className="ai-coach-picker-header">
          <span className="ai-coach-picker-title">
            {lang === 'es' ? 'Elige 1 partida para analizar' : 'Choose 1 match to analyze'}
          </span>
          <span className="ai-coach-picker-count">
            {selected.size}/{MAX_SELECTED}
          </span>
        </div>
        <div className="ai-coach-picker-list">
          {matches.map(m => {
            const pl = m.player || {}
            const isSelected = selected.has(m.match_id)
            return (
              <button
                key={m.match_id}
                className={`ai-coach-picker-card ${isSelected ? 'selected' : ''} ${m.win ? 'win' : 'loss'}`}
                onClick={() => onToggle(m.match_id)}
                disabled={!isSelected && selected.size >= MAX_SELECTED}
              >
                <div className="picker-badge-col">
                  <span className={`picker-badge ${m.win ? 'win' : 'loss'}`}>
                    {m.win ? (lang === 'es' ? 'V' : 'W') : (lang === 'es' ? 'D' : 'L')}
                  </span>
                </div>
                <div className="picker-champ">
                  <Img src={pl.champion_icon} className="picker-champ-icon" />
                </div>
                <div className="picker-info">
                  <span className="picker-champ-name">{pl.champion}</span>
                  <span className="picker-meta">{queueLabel(lang, m.queue)} · {m.duration}</span>
                </div>
                <div className="picker-stats">
                  <span className="picker-kda">{pl.kills}/{pl.deaths}/{pl.assists}</span>
                  <span className="picker-kda-ratio">{kdaRatio(pl.kills, pl.deaths, pl.assists)} KDA</span>
                </div>
                <div className="picker-check">
                  {isSelected && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        <div className="ai-coach-picker-footer">
          <button className="ai-coach-picker-cancel" onClick={onCancel}>
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            className="ai-coach-picker-confirm"
            disabled={selected.size === 0}
            onClick={onConfirm}
          >
            {lang === 'es' ? `Analizar ${selected.size} partida${selected.size !== 1 ? 's' : ''}` : `Analyze ${selected.size} match${selected.size !== 1 ? 'es' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

async function callMistral(systemPrompt, userMessage) {
  return await fetchAICoach([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ])
}

function buildSystemPrompt(lang, name) {
  const playerName = name || (lang === 'es' ? 'bro' : 'bro')
  return lang === 'es'
    ? `Eres un coach personal de League of Legends, estilo OP.GG o U.GG. Hablas como un amigo que sabe mucho del juego — directo, claro, sin ser grosero. Respondes en español. Te diriges al jugador como "${playerName}".

Reglas:
- Usa lenguaje natural y conversacional. NO uses markdown (sin ###, sin **, sin ---, sin tablas, sin listas con emojis).
- Escribe en párrafos claros con saltos de línea simples.
- Menciona al jugador por su nombre "${playerName}" al menos una vez.
- Analiza por qué perdiste o ganaste, no solo los números.
- Dale contexto del campeón: ¿es early/mid/late game? ¿Qué debería priorizar en early? ¿Cómo escala? ¿Cuál es su power spike?
- Habla de posicionamiento en teamfights: dónde estar, a quién focusear, cuándo entrar.
- Habla de rotaciones, macro, visión, y decisiones de juego.
- Si el jugador tiene muertes evitables, explica exactamente qué hacer diferente.
- NO des consejos de builds, items, runas o summoner spells. Solo enfócate en gameplay, posicionamiento, rotaciones y decisiones.
- Responde en máximo 3-4 párrafos. Sé conciso pero con impacto.
- Revisa tu ortografía antes de responder. No cometas errores de escritura como "barra" en vez de "borra", "kompa" en vez de "kompa", etc. Escribe correctamente todas las palabras.`
    : `You are a personal League of Legends coach, like OP.GG or U.GG style. You talk like a knowledgeable friend who knows the game — direct, clear, not toxic. Respond in English. Address the player as "${playerName}".

Rules:
- Use natural, conversational language. NO markdown (no ###, no **, no ---, no tables, no emoji lists).
- Write in clear paragraphs with simple line breaks.
- Mention the player by name "${playerName}" at least once.
- Analyze WHY they lost or won, not just the numbers.
- Give champion context: is it early/mid/late game? What should they prioritize early? How does it scale? What are their power spikes?
- Talk about teamfight positioning: where to stand, who to focus, when to go in.
- Talk about rotations, macro, vision, and game decisions.
- If the player had avoidable deaths, explain exactly what to do differently.
- Do NOT give advice on builds, items, runes, or summoner spells. Only focus on gameplay, positioning, rotations, and decisions.
- Respond in 3-4 paragraphs max. Be concise but impactful.
- Review your spelling before responding. Do not make typos or misspell any words. Write everything correctly.`
}

export default function AICoach({ matches, lang, puuid, summonerName, onLangChange }) {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(420)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedMatches, setSelectedMatches] = useState(new Set())
  const [showPicker, setShowPicker] = useState(false)
  const [typingDone, setTypingDone] = useState({})
  const [webNotice, setWebNotice] = useState(false)
  const chatRef = useRef(null)
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const openedRef = useRef(false)
  const prevLangRef = useRef(lang)
  const prevMsgCount = useRef(0)

  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true
      prevLangRef.current = lang
      setSelectedMatches(new Set())
      setShowPicker(false)
      setTypingDone({})
      if (messages.length === 0) {
        const webMsg = !isTauri()
          ? (lang === 'es'
              ? '\n\n⚠️ El Coach IA solo está disponible en la app de escritorio de RiftHelper. Descárgalo para desbloquear análisis de partidas con datos reales.'
              : '\n\n⚠️ AI Coach is only available in the RiftHelper desktop app. Download it to unlock match analysis with real data.')
          : ''
        setMessages([{
          id: Date.now(),
          role: 'coach',
          text: (lang === 'es'
            ? '¡Hola! Soy tu Coach IA 🧠\n\nPuedo analizar tus partidas con datos reales: farm, rotaciones, visión, KDA, builds, decisiones de juego y más.'
            : "Hello! I'm your AI Coach 🧠\n\nI can analyze your matches with real data: farm, rotations, vision, KDA, builds, game decisions and more.") + webMsg,
        }])
        prevMsgCount.current = 1
      }
    }
    if (!open) openedRef.current = false
  }, [open, lang])

  useEffect(() => {
    if (open && prevLangRef.current !== lang) {
      prevLangRef.current = lang
      setSelectedMatches(new Set())
      setShowPicker(false)
      setTypingDone({})
      setInput('')
      setMessages([{
        id: Date.now(),
        role: 'coach',
        text: lang === 'es'
          ? '¡Hola! Soy tu Coach IA 🧠\n\nPuedo analizar tus partidas con datos reales: farm, rotaciones, visión, KDA, builds, decisiones de juego y más.\n\nPulsa "Seleccionar partidas" abajo para elegir qué analizar, o escríbeme tu pregunta directamente.'
          : "Hello! I'm your AI Coach 🧠\n\nI can analyze your matches with real data: farm, rotations, vision, KDA, builds, game decisions and more.\n\nClick \"Select matches\" below to choose what to analyze, or write me your question directly.",
      }])
      prevMsgCount.current = 1
    }
  }, [lang, open])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, analyzing, showPicker])

  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      const last = messages[messages.length - 1]
      if (last && last.role === 'coach') playDing()
    }
    prevMsgCount.current = messages.length
  }, [messages])

  const toggleMatch = useCallback((id) => {
    setSelectedMatches(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) }
      else if (next.size < MAX_SELECTED) { next.add(id) }
      return next
    })
  }, [])

  const analyzeSelected = useCallback(async () => {
    if (selectedMatches.size === 0 || !matches) return
    setAnalyzing(true)
    setShowPicker(false)

    const selected = matches.filter(m => selectedMatches.has(m.match_id))

    const userText = lang === 'es'
      ? `Analiza mis ${selected.length} partidas seleccionadas`
      : `Analyze my ${selected.length} selected matches`

    setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: userText }])
    setSelectedMatches(new Set())

    try {
      const richContext = buildRichCoachingPrompt(selected, lang)

      const systemPrompt = buildSystemPrompt(lang, summonerName)
      const response = await callMistral(systemPrompt, richContext)

      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'coach', text: response }])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'coach',
        text: lang === 'es'
          ? `Error: ${err.message}\n\nInténtalo de nuevo o escribe tu pregunta.`
          : `Error: ${err.message}\n\nTry again or write your question.`,
      }])
    } finally {
      setAnalyzing(false)
    }
  }, [selectedMatches, matches, lang, summonerName])

  const sendMessage = useCallback(async () => {
    if (!input.trim()) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: userMsg }])
    setAnalyzing(true)

    try {
      let context = ''
      if (matches && matches.length > 0) {
        const recent = matches.slice(0, 5)
        context = buildRichCoachingPrompt(recent, lang)
      }

      const systemPrompt = buildSystemPrompt(lang, summonerName)
      const fullUserMsg = context
        ? `${context}\n\n${lang === 'es' ? 'Mi pregunta' : 'My question'}: ${userMsg}`
        : userMsg

      const response = await callMistral(systemPrompt, fullUserMsg)
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'coach', text: response }])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'coach',
        text: lang === 'es'
          ? `Error: ${err.message}\n\nInténtalo de nuevo.`
          : `Error: ${err.message}\n\nTry again.`,
      }])
    } finally {
      setAnalyzing(false)
    }
  }, [input, matches, lang, summonerName])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }, [sendMessage])

  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    resizing.current = true
    startX.current = e.clientX || (e.touches && e.touches[0].clientX) || 0
    startWidth.current = width
    const onMove = (ev) => {
      if (!resizing.current) return
      const clientX = ev.clientX || (ev.touches && ev.touches[0].clientX) || 0
      const delta = startX.current - clientX
      setWidth(Math.max(380, Math.min(800, startWidth.current + delta)))
    }
    const onUp = () => {
      resizing.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onUp)
  }, [width])

  const lastCoachIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'coach') return i
    }
    return -1
  })()

  if (!matches || matches.length === 0) return null

  return (
    <>
      {!open && (
        <button
          className="ai-coach-fab"
          onClick={() => setOpen(true)}
          title={t(lang, 'aiCoach')}
          aria-label={t(lang, 'aiCoach')}
        >
          <span className="ai-coach-fab-ring" />
          <span className="ai-coach-fab-ring ai-coach-fab-ring-2" />
          <img src="/ai_coach.png" alt="" className="ai-coach-icon" draggable="false" />
        </button>
      )}

      {webNotice && (
        <div className="ai-coach-web-notice-overlay" onClick={() => setWebNotice(false)}>
          <div className="ai-coach-web-notice" onClick={(e) => e.stopPropagation()}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <h3>{t(lang, 'aiCoach')}</h3>
            <p>{t(lang, 'aiCoachWebOnly')}</p>
            <button className="rt-btn rt-btn-primary" onClick={() => setWebNotice(false)}>
              {t(lang, 'close')}
            </button>
          </div>
        </div>
      )}

      {open && (
        <>
          <div className="ai-coach-overlay" onClick={() => setOpen(false)} />

          <div className="ai-coach-panel open" style={{ width }}>
            <div className="ai-coach-resize-handle" onMouseDown={onResizeStart} onTouchStart={onResizeStart} />

            <div className="ai-coach-header">
              <span className="ai-coach-title">{t(lang, 'aiCoach')}</span>
              <LangInline lang={lang} onChange={onLangChange} />
              <button className="ai-coach-clear" onClick={() => {
                setMessages([])
                setSelectedMatches(new Set())
                setShowPicker(false)
                setTypingDone({})
                prevMsgCount.current = 0
              }} aria-label="Clear chat" title={lang === 'es' ? 'Limpiar chat' : 'Clear chat'}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="ai-coach-close" onClick={() => setOpen(false)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {showPicker && (
              <MatchPicker
                matches={matches}
                selected={selectedMatches}
                onToggle={toggleMatch}
                onConfirm={analyzeSelected}
                lang={lang}
                onCancel={() => { setShowPicker(false); setSelectedMatches(new Set()) }}
              />
            )}

            <div className="ai-coach-chat" ref={chatRef}>
              {messages.map((msg, i) => (
                <div key={msg.id || i} className={`ai-coach-msg ${msg.role}`}>
                  {msg.role === 'coach' && (
                    <div className="ai-coach-avatar">
                      <img src="/ai_coach.png" alt="" draggable="false" />
                    </div>
                  )}
                  <div className="ai-coach-bubble">
                    {msg.role === 'coach' && !typingDone[msg.id] ? (
                      <TypewriterText text={msg.text} speed={10}
                        onDone={() => setTypingDone(prev => ({ ...prev, [msg.id]: true }))} />
                    ) : msg.role === 'coach' ? (
                      <div className="ai-coach-markdown">
                        <Markdown>{msg.text}</Markdown>
                      </div>
                    ) : (
                      msg.text.split('\n').map((line, j, arr) => (
                        <span key={j}>{line}{j < arr.length - 1 && <br />}</span>
                      ))
                    )}
                    {typingDone[msg.id] && i === lastCoachIdx && isTauri() && (
                      <div className="ai-coach-actions-row">
                        <button className="ai-coach-select-trigger" onClick={() => setShowPicker(true)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
                            <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {lang === 'es' ? 'Seleccionar partidas' : 'Select matches'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {analyzing && (
                <div className="ai-coach-msg coach">
                  <div className="ai-coach-avatar">
                    <img src="/ai_coach.png" alt="" draggable="false" />
                  </div>
                  <div className="ai-coach-bubble ai-coach-typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
            </div>

            <div className="ai-coach-input-area">
              {isTauri() ? (
                <>
                  <textarea className="ai-coach-input" value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={lang === 'es' ? 'Escribe tu pregunta…' : 'Type your question…'} rows={1} />
                  <button className="ai-coach-send" disabled={!input.trim() || analyzing} onClick={sendMessage}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </>
              ) : (
                <div className="ai-coach-web-disabled">
                  {lang === 'es' ? 'El coaching IA solo está disponible en la app de escritorio.' : 'AI coaching is only available in the desktop app.'}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
