import { useState, useRef, useEffect, useCallback } from 'react'
import { t, LANGS } from '../i18n.js'
import { buildBatchSummary, formatAnalysisPrompt, extractDetailedAnalysis } from '../matchAnalysis.js'

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
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.25)
  } catch {}
}

function TypewriterText({ text, onDone, speed = 12 }) {
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
    const delay = char === '\n' ? 40 : char === '.' || char === '!' || char === '?' ? 60 : speed
    const id = setTimeout(() => {
      idx.current++
      setDisplayed(text.slice(0, idx.current))
    }, delay)
    return () => clearTimeout(id)
  }, [displayed, text, speed, done, onDone])

  return (
    <span className="ai-coach-typed-text">
      {displayed.split('\n').map((line, i, arr) => (
        <span key={i}>
          {line}
          {i < arr.length - 1 && <br />}
        </span>
      ))}
      {!done && <span className="ai-coach-cursor">|</span>}
    </span>
  )
}

function LangInline({ lang, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = LANGS.find(l => l.code === lang) || LANGS[0]

  return (
    <div className="ai-coach-lang" ref={ref}>
      <button
        className={`ai-coach-lang-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
      >
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
              <button
                className={`ai-coach-lang-opt ${l.code === lang ? 'active' : ''}`}
                onClick={() => { onChange(l.code); setOpen(false) }}
              >
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

export default function AICoach({ matches, lang, puuid, onLangChange }) {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(420)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedMatches, setSelectedMatches] = useState(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [typingDone, setTypingDone] = useState({})
  const chatRef = useRef(null)
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const openedRef = useRef(false)
  const prevMsgCount = useRef(0)

  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true
      setSelectedMatches(new Set())
      setSelectMode(false)
      setTypingDone({})
      setMessages([{
        id: Date.now(),
        role: 'coach',
        text: lang === 'es'
          ? '¡Hola! Soy tu Coach IA 🧠\n\nElige qué partidas quieres analizar usando el botón de selección, o escríbeme directamente tu pregunta.\n\nPuedo analizar: farm, rotaciones, visión, KDA, builds, decisiones de juego y más.'
          : "Hello! I'm your AI Coach 🧠\n\nChoose which matches you want to analyze using the selection button, or write me your question directly.\n\nI can analyze: farm, rotations, vision, KDA, builds, game decisions and more.",
      }])
      prevMsgCount.current = 1
    }
    if (!open) {
      openedRef.current = false
    }
  }, [open, lang])

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, analyzing])

  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      const last = messages[messages.length - 1]
      if (last && last.role === 'coach') {
        playDing()
      }
    }
    prevMsgCount.current = messages.length
  }, [messages])

  const selectAll = useCallback(() => {
    if (!matches) return
    setSelectedMatches(new Set(matches.map(m => m.match_id)))
  }, [matches])

  const clearSelection = useCallback(() => {
    setSelectedMatches(new Set())
  }, [])

  const analyzeSelected = useCallback(async () => {
    if (selectedMatches.size === 0 || !matches) return

    setAnalyzing(true)
    setSelectMode(false)

    const selected = matches.filter(m => selectedMatches.has(m.match_id))
    const summary = buildBatchSummary(selected, lang)
    const prompt = formatAnalysisPrompt(summary, lang)
    const playerDetails = selected.map(m => extractDetailedAnalysis(m))

    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'user',
      text: lang === 'es'
        ? `Analiza mis ${selected.length} partidas seleccionadas`
        : `Analyze my ${selected.length} selected matches`,
    }])

    try {
      const coachResponse = generateLocalCoachResponse(summary, playerDetails, lang)
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'coach',
        text: coachResponse,
        prompt: fullPrompt(summary, playerDetails),
      }])
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'coach',
        text: lang === 'es'
          ? 'Ha ocurrido un error al analizar las partidas. Inténtalo de nuevo.'
          : 'An error occurred while analyzing the matches. Please try again.',
      }])
    } finally {
      setAnalyzing(false)
      setSelectedMatches(new Set())
    }
  }, [selectedMatches, matches, lang])

  const sendMessage = useCallback(async () => {
    if (!input.trim()) return

    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: userMsg }])
    setAnalyzing(true)

    try {
      let contextPrompt = ''
      if (matches && matches.length > 0) {
        const recent = matches.slice(0, 5)
        const summary = buildBatchSummary(recent, lang)
        contextPrompt = formatAnalysisPrompt(summary, lang)
      }

      const response = generateLocalCoachResponse(null, null, lang, userMsg, contextPrompt)
      setMessages(prev => [...prev, { id: Date.now() + 1, role: 'coach', text: response }])
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'coach',
        text: lang === 'es'
          ? 'Ha ocurrido un error. Inténtalo de nuevo.'
          : 'An error occurred. Please try again.',
      }])
    } finally {
      setAnalyzing(false)
    }
  }, [input, matches, lang])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
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
      const newWidth = Math.max(380, Math.min(800, startWidth.current + delta))
      setWidth(newWidth)
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

  if (!matches || matches.length === 0) return null

  return (
    <>
      <button
        className={`ai-coach-fab ${open ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
        title={t(lang, 'aiCoach')}
        aria-label={t(lang, 'aiCoach')}
      >
        <span className="ai-coach-fab-ring" />
        <span className="ai-coach-fab-ring ai-coach-fab-ring-2" />
        <img src="/ai_coach.png" alt="" className="ai-coach-icon" draggable="false" />
      </button>

      {open && (
        <div className="ai-coach-overlay" onClick={() => setOpen(false)} />
      )}

      <div
        className={`ai-coach-panel ${open ? 'open' : ''}`}
        style={{ width: open ? width : 0 }}
      >
        <div
          className="ai-coach-resize-handle"
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
        />

        <div className="ai-coach-header">
          <div className="ai-coach-header-icon-wrap">
            <img src="/ai_coach.png" alt="" className="ai-coach-header-icon" draggable="false" />
          </div>
          <span className="ai-coach-title">{t(lang, 'aiCoach')}</span>

          <LangInline lang={lang} onChange={onLangChange} />

          <button
            className="ai-coach-select-btn"
            onClick={() => {
              if (selectMode) {
                setSelectMode(false)
                setSelectedMatches(new Set())
              } else {
                setSelectMode(true)
              }
            }}
            title={selectMode ? (lang === 'es' ? 'Cancelar' : 'Cancel') : (lang === 'es' ? 'Seleccionar' : 'Select')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              {selectMode ? (
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              ) : (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
                  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}
            </svg>
          </button>

          <button
            className="ai-coach-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {selectMode && (
          <div className="ai-coach-select-bar">
            <button className="ai-coach-select-action" onClick={selectAll}>
              {lang === 'es' ? 'Todas' : 'All'}
            </button>
            <button className="ai-coach-select-action" onClick={clearSelection}>
              {lang === 'es' ? 'Limpiar' : 'Clear'}
            </button>
            <span className="ai-coach-select-count">
              {selectedMatches.size}/{matches.length}
            </span>
            <button
              className="ai-coach-analyze-btn"
              disabled={selectedMatches.size === 0 || analyzing}
              onClick={analyzeSelected}
            >
              {analyzing
                ? (lang === 'es' ? 'Analizando…' : 'Analyzing…')
                : (lang === 'es' ? 'Analizar' : 'Analyze')}
            </button>
          </div>
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
                  <TypewriterText
                    text={msg.text}
                    speed={10}
                    onDone={() => setTypingDone(prev => ({ ...prev, [msg.id]: true }))}
                  />
                ) : (
                  msg.text.split('\n').map((line, j, arr) => (
                    <span key={j}>
                      {line}
                      {j < arr.length - 1 && <br />}
                    </span>
                  ))
                )}
                {typingDone[msg.id] && msg.prompt && (
                  <button
                    className="ai-coach-copy-prompt"
                    onClick={() => navigator.clipboard.writeText(msg.prompt).catch(() => {})}
                    title={lang === 'es' ? 'Copiar prompt para LLM' : 'Copy prompt for LLM'}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    {lang === 'es' ? 'Copiar prompt' : 'Copy prompt'}
                  </button>
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
          <textarea
            className="ai-coach-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={lang === 'es' ? 'Escribe tu pregunta…' : 'Type your question…'}
            rows={1}
          />
          <button
            className="ai-coach-send"
            disabled={!input.trim() || analyzing}
            onClick={sendMessage}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}


function fullPrompt(summary, details) {
  let text = `Analysis:\n${summary.wins}W/${summary.losses}L (${summary.winrate}%)\nKDA: ${summary.avgKDA} | CS/min: ${summary.avgCSPerMin} | KP: ${summary.avgKillParticipation}%\n`
  for (const d of details) {
    text += `\n${d.champion} (${d.role}): ${d.goldShare}% gold, ${d.damageShare}% dmg, CS ${d.csPerMin}, vision/min ${d.visionPerMin}`
  }
  return text
}


function generateLocalCoachResponse(summary, details, lang, userQuestion) {
  const isEs = lang === 'es'

  if (!summary && userQuestion) {
    return isEs
      ? 'Buena pregunta. Para un análisis profundo, selecciona las partidas y pulsa "Analizar".\n\nTambién puedes copiar el prompt y pegarlo en un LLM gratuito:\n• ChatGPT (chat.openai.com)\n• Claude (claude.ai)\n• Gemini (gemini.google.com)\n\n¿Qué aspecto quieres mejorar?'
      : 'Good question. For deep analysis, select matches and click "Analyze".\n\nYou can also copy the prompt and paste it into a free LLM:\n• ChatGPT (chat.openai.com)\n• Claude (claude.ai)\n• Gemini (gemini.google.com)\n\nWhat do you want to improve?'
  }

  if (!summary) {
    return isEs
      ? 'Selecciona partidas para analizar o escribe tu pregunta.'
      : 'Select matches to analyze or write your question.'
  }

  const tips = []
  const avgCS = parseFloat(summary.avgCSPerMin)
  const avgKP = summary.avgKillParticipation
  const avgVision = parseFloat(summary.avgVision)
  const avgKDA = parseFloat(summary.avgKDA)

  if (avgCS < 7) {
    tips.push(isEs
      ? `🌾 **Farm mejorable**: CS/min promedio ${summary.avgCSPerMin}. Target ideal: 8+ carries, 7+ tops, 4.5+ jungle. Practica en practice tool.`
      : `🌾 **Farm needs work**: CS/min average ${summary.avgCSPerMin}. Ideal target: 8+ carries, 7+ tops, 4.5+ jungle. Practice in practice tool.`)
  } else {
    tips.push(isEs
      ? `🌾 **Buen farm**: ${summary.avgCSPerMin} CS/min. Mantén la consistencia.`
      : `🌾 **Good farm**: ${summary.avgCSPerMin} CS/min. Keep it up.`)
  }

  if (avgKP < 50) {
    tips.push(isEs
      ? `🎯 **KP bajo**: ${summary.avgKillParticipation}%. Rota más a skirmishes y objectives (dragons, heralds). Atento al minimapa.`
      : `🎯 **Low KP**: ${summary.avgKillParticipation}%. Rotate more to skirmishes and objectives. Watch the minimap.`)
  }

  if (avgVision < 40) {
    tips.push(isEs
      ? `👁️ **Visión**: Score ${summary.avgVision}. Coloca más wards en jungle enemiga antes de rotar. Sweeping lens antes de objectives.`
      : `👁️ **Vision**: Score ${summary.avgVision}. Place more deep wards before rotating. Sweeping lens before objectives.`)
  }

  if (avgKDA < 2) {
    tips.push(isEs
      ? `⚔️ **KDA bajo**: ${summary.avgKDA}. No fuerces plays sin visión. Muerte evitable = ~300g + 15s perdidos.`
      : `⚔️ **Low KDA**: ${summary.avgKDA}. Don't force plays without vision. Avoidable death = ~300g + 15s lost.`)
  }

  if (summary.winrate >= 55) {
    tips.push(isEs ? `📈 **WR sólido**: ${summary.winrate}%. Sigue así.` : `📈 **Solid WR**: ${summary.winrate}%. Keep going.`)
  } else if (summary.winrate < 45) {
    tips.push(isEs ? `📉 **WR bajo**: ${summary.winrate}%. Revisa si forzas picks/roles que no dominas.` : `📉 **Low WR**: ${summary.winrate}%. Review if you force picks/roles you don't master.`)
  }

  const role = summary.mainRole
  if (role === 'JUNGLE') tips.push(isEs ? '🌲 **Jungle**: Prioriza objectives. Tracking del enemy jungler — si no sabes dónde está, asume que está en tu jungle.' : '🌲 **Jungle**: Prioritize objectives. Track the enemy jungler — if you don\'t know where, assume they\'re in your jungle.')
  else if (role === 'Mid') tips.push(isEs ? '🗺️ **Mid**: Wave prio > roams. Push y roam. Ward los dos ríos.' : '🗺️ **Mid**: Wave prio > roams. Push and roam. Ward both rivers.')
  else if (role === 'Bot' || role === 'ADC') tips.push(isEs ? '🏹 **ADC**: Farm es prioridad #1. Late game positioning es todo. Nunca frontlinies.' : '🏹 **ADC**: Farm is #1 priority. Late game positioning is everything. Never frontline.')
  else if (role === 'Top') tips.push(isEs ? '🏔️ **Top**: Wave management clave. TP para objectives, no lane.' : '🏔️ **Top**: Wave management is key. TP for objectives, not lane.')
  else if (role === 'Support') tips.push(isEs ? '🛡️ **Support**: Deep wards antes de objectives. Roam mid cuando ADC backs.' : '🛡️ **Support**: Deep wards before objectives. Roam mid when ADC backs.')

  if (details && details.length > 0) {
    const worst = details.reduce((w, d) => parseFloat(d.csDiff) < parseFloat(w.csDiff) ? d : w, details[0])
    if (parseFloat(worst.csDiff) < -1) {
      tips.push(isEs
        ? `📉 **Peor farm**: ${worst.champion} (${worst.role}) — ${worst.csPerMin} CS/min (target ${worst.csTarget}).`
        : `📉 **Worst farm**: ${worst.champion} (${worst.role}) — ${worst.csPerMin} CS/min (target ${worst.csTarget}).`)
    }
  }

  return isEs
    ? `📊 **Análisis de ${summary.matchCount} partidas**\n\n🏆 ${summary.wins}V / ${summary.losses}D (${summary.winrate}%)\n⚔️ KDA: ${summary.avgKDA} | CS/min: ${summary.avgCSPerMin} | KP: ${summary.avgKillParticipation}%\n\n${tips.join('\n\n')}\n\n💡 **Consejo**: Paciencia > agresividad. Pregúntate antes de cada play: "¿Tengo visión? ¿Items? ¿Cooldowns?"\n\n¿Quieres que analice algo específico?`
    : `📊 **Analysis of ${summary.matchCount} matches**\n\n🏆 ${summary.wins}W / ${summary.losses}L (${summary.winrate}%)\n⚔️ KDA: ${summary.avgKDA} | CS/min: ${summary.avgCSPerMin} | KP: ${summary.avgKillParticipation}%\n\n${tips.join('\n\n')}\n\n💡 **Tip**: Patience > aggression. Ask before every play: "Do I have vision? Items? Cooldowns?"\n\nWant me to analyze something specific?`
}
