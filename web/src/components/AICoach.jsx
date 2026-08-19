import { useState, useRef, useEffect, useCallback } from 'react'
import { t } from '../i18n.js'
import { buildMatchSummary, buildBatchSummary, formatAnalysisPrompt, extractDetailedAnalysis } from '../matchAnalysis.js'

export default function AICoach({ matches, lang, puuid }) {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(420)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedMatches, setSelectedMatches] = useState(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const chatRef = useRef(null)
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const inputRef = useRef(null)
  const openedRef = useRef(false)

  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true
      setSelectedMatches(new Set())
      setSelectMode(false)
      setMessages([{
        role: 'coach',
        text: lang === 'es'
          ? '¡Hola! Soy tu Coach IA 🧠\n\nElige qué partidas quieres analizar usando el botón de selección, o escríbeme directamente tu pregunta.\n\nPuedo analizar: farm, rotaciones, visión, KDA, builds, decisiones de juego y más.'
          : "Hello! I'm your AI Coach 🧠\n\nChoose which matches you want to analyze using the selection button, or write me your question directly.\n\nI can analyze: farm, rotations, vision, KDA, builds, game decisions and more.",
      }])
    }
    if (!open) {
      openedRef.current = false
    }
  }, [open, lang])

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [messages])

  const toggleMatchSelection = useCallback((matchId) => {
    setSelectedMatches(prev => {
      const next = new Set(prev)
      if (next.has(matchId)) next.delete(matchId)
      else next.add(matchId)
      return next
    })
  }, [])

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
    let detailText = '\n\n📊 Detalles avanzados:\n'
    for (const d of playerDetails) {
      detailText += `• ${d.champion} (${d.role}): ${d.goldShare}% gold share, ${d.damageShare}% damage share, CS ${d.csPerMin} (target: ${d.csTarget}), Vision/min: ${d.visionPerMin}\n`
    }

    const fullPrompt = prompt + detailText

    setMessages(prev => [...prev, {
      role: 'user',
      text: lang === 'es'
        ? `Analiza mis ${selected.length} partidas seleccionadas`
        : `Analyze my ${selected.length} selected matches`,
    }])

    try {
      const coachResponse = generateLocalCoachResponse(summary, playerDetails, lang)
      setMessages(prev => [...prev, {
        role: 'coach',
        text: coachResponse,
        prompt: fullPrompt,
      }])
    } catch {
      setMessages(prev => [...prev, {
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
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setAnalyzing(true)

    try {
      let contextPrompt = ''
      if (matches && matches.length > 0) {
        const recent = matches.slice(0, 5)
        const summary = buildBatchSummary(recent, lang)
        contextPrompt = formatAnalysisPrompt(summary, lang)
      }

      const response = generateLocalCoachResponse(null, null, lang, userMsg, contextPrompt)
      setMessages(prev => [...prev, { role: 'coach', text: response }])
    } catch {
      setMessages(prev => [...prev, {
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
      const newWidth = Math.max(320, Math.min(800, startWidth.current + delta))
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
        className="ai-coach-fab"
        onClick={() => setOpen(!open)}
        title={t(lang, 'aiCoach')}
        aria-label={t(lang, 'aiCoach')}
      >
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
          <img src="/ai_coach.png" alt="" className="ai-coach-header-icon" draggable="false" />
          <span className="ai-coach-title">{t(lang, 'aiCoach')}</span>
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
            title={selectMode ? (lang === 'es' ? 'Cancelar selección' : 'Cancel selection') : (lang === 'es' ? 'Seleccionar partidas' : 'Select matches')}
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
              {lang === 'es' ? 'Seleccionar todo' : 'Select all'}
            </button>
            <button className="ai-coach-select-action" onClick={clearSelection}>
              {lang === 'es' ? 'Limpiar' : 'Clear'}
            </button>
            <span className="ai-coach-select-count">
              {selectedMatches.size} / {matches.length}
            </span>
            <button
              className="ai-coach-analyze-btn"
              disabled={selectedMatches.size === 0 || analyzing}
              onClick={analyzeSelected}
            >
              {analyzing ? (lang === 'es' ? 'Analizando...' : 'Analyzing...') : (lang === 'es' ? 'Analizar' : 'Analyze')}
            </button>
          </div>
        )}

        <div className="ai-coach-chat" ref={chatRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`ai-coach-msg ${msg.role}`}>
              {msg.role === 'coach' && (
                <div className="ai-coach-avatar">
                  <img src="/ai_coach.png" alt="" draggable="false" />
                </div>
              )}
              <div className="ai-coach-bubble">
                {msg.text.split('\n').map((line, j) => (
                  <span key={j}>
                    {line}
                    {j < msg.text.split('\n').length - 1 && <br />}
                  </span>
                ))}
                {msg.prompt && (
                  <button
                    className="ai-coach-copy-prompt"
                    onClick={() => {
                      navigator.clipboard.writeText(msg.prompt).catch(() => {})
                    }}
                    title={lang === 'es' ? 'Copiar prompt para LLM' : 'Copy prompt for LLM'}
                  >
                    📋 {lang === 'es' ? 'Copiar prompt' : 'Copy prompt'}
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
            ref={inputRef}
            className="ai-coach-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={lang === 'es' ? 'Escribe tu pregunta...' : 'Type your question...'}
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


function generateLocalCoachResponse(summary, details, lang, userQuestion, contextPrompt) {
  const isEs = lang === 'es'

  if (!summary && userQuestion) {
    if (isEs) {
      return `Buena pregunta. Para darte un análisis más profundo, necesito que selecciones las partidas que quieres analizar.\n\n📌 Usa el botón de selección (☑️) en la parte superior para elegir las partidas, y luego pulsa "Analizar".\n\nTambién puedes copiar el prompt que generé y pegarlo en un LLM gratuito como:\n• ChatGPT (chat.openai.com)\n• Claude (claude.ai)\n• Gemini (gemini.google.com)\n\n¿Qué aspecto de tu juego quieres mejorar?`
    }
    return `Good question. To give you a deeper analysis, I need you to select the matches you want to analyze.\n\n📌 Use the selection button (☑️) at the top to choose matches, then click "Analyze".\n\nYou can also copy the prompt I generated and paste it into a free LLM like:\n• ChatGPT (chat.openai.com)\n• Claude (claude.ai)\n• Gemini (gemini.google.com)\n\nWhat aspect of your gameplay do you want to improve?`
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
      ? `🌾 **Farm mejorable**: Tu CS/min promedio es ${summary.avgCSPerMin}. Intenta hacer last-hit más consistente. En las primeras 10 minutos, el target ideal es 8+ CS/min para carries, 7+ para tops, 4.5+ para jungle. Practica en la tool de practice tool.`
      : `🌾 **Farm needs work**: Your average CS/min is ${summary.avgCSPerMin}. Try to last-hit more consistently. In the first 10 minutes, the ideal target is 8+ CS/min for carries, 7+ for tops, 4.5+ for jungle. Practice in practice tool.`
    )
  } else {
    tips.push(isEs
      ? `🌾 **Buen farm**: Promedio de ${summary.avgCSPerMin} CS/min. Mantén esa consistencia.`
      : `🌾 **Good farm**: Average of ${summary.avgCSPerMin} CS/min. Keep that consistency.`
    )
  }

  if (avgKP < 50) {
    tips.push(isEs
      ? `🎯 **Participación en kills baja**: ${summary.avgKillParticipation}% en promedio. Intenta rotar más a skirmishes, especially around objectives (dragons, heralds). Permanece atento al minimapa.`
      : `🎯 **Low kill participation**: ${summary.avgKillParticipation}% on average. Try rotating more to skirmishes, especially around objectives (dragons, heralds). Keep an eye on the minimap.`
    )
  }

  if (avgVision < 40) {
    tips.push(isEs
      ? `👁️ **Visión por mejorar**: Score de ${summary.avgVision} en promedio. Coloca más wards, especialmente en la jungle enemiga antes de rotar. Usa sweeping lens antes de objectives.`
      : `👁️ **Vision needs improvement**: Score of ${summary.avgVision} on average. Place more wards, especially in the enemy jungle before rotating. Use sweeping lens before objectives.`
    )
  }

  if (avgKDA < 2) {
    tips.push(isEs
      ? `⚔️ **KDA bajo**: Promedio de ${summary.avgKDA}. Intenta no forzar plays si no tienes visión. Muerte innecesaria = pérdida de tempo y oro. Antes de hacer una jugada, pregunta: "¿Tengo visión? ¿Tengobackup?"`
      : `⚔️ **Low KDA**: Average of ${summary.avgKDA}. Try not to force plays without vision. Unnecessary death = loss of tempo and gold. Before making a play, ask: "Do I have vision? Do I have backup?"`
    )
  }

  if (summary.winrate >= 55) {
    tips.push(isEs
      ? `📈 **Winrate sólido**: ${summary.winrate}%. Estás en buena racha. Sigue focus en consistencia.`
      : `📈 **Solid winrate**: ${summary.winrate}%. You're on a good streak. Focus on consistency.`
    )
  } else if (summary.winrate < 45) {
    tips.push(isEs
      ? `📉 **Winrate a mejorar**: ${summary.winrate}%. Revisa si estás forzando picks o roles que no dominas. A veces cambiar de enfoque (menos aggressive early, más farm) ayuda.`
      : `📉 **Winrate needs work**: ${summary.winrate}%. Review if you're forcing picks or roles you don't master. Sometimes changing approach (less aggressive early, more farm) helps.`
    )
  }

  const mainRole = summary.mainRole
  if (mainRole === 'Jungle') {
    tips.push(isEs
      ? `🌲 **Jungle tips**: Prioriza objectives sobre kills innecesarias. Un dragon a tiempo vale más que 2 kills. Hacé tracking del enemy jungler. Si no sabes dónde está, asume que está en tu jungle.`
      : `🌲 **Jungle tips**: Prioritize objectives over unnecessary kills. A dragon on time is worth more than 2 kills. Track the enemy jungler. If you don't know where they are, assume they're in your jungle.`
    )
  } else if (mainRole === 'Mid') {
    tips.push(isEs
      ? `🗺️ **Mid tips**: Prio de wave > roams. Si tu wave está pushando, roam. Si está frozen, no dejes la wave. Ward los dos ríos. Push y roam es la clave.`
      : `🗺️ **Mid tips**: Wave prio > roams. If your wave is pushing, roam. If it's frozen, don't leave the wave. Ward both rivers. Push and roam is key.`
    )
  } else if (mainRole === 'Bot' || mainRole === 'ADC') {
    tips.push(isEs
      ? `🏹 **Bot tips**: farming es tu prioridad #1. No roaming sin wave management. Tras late game, positioning en teamfights es todo. Nunca frontlinies.`
      : `🏹 **Bot tips**: farming is your #1 priority. No roaming without wave management. After late game, teamfight positioning is everything. Never frontline.`
    )
  } else if (mainRole === 'Top') {
    tips.push(isEs
      ? `🏔️ **Top tips**: Wave management es clave (freeze, slow push, fast push). Si tu jungler está topside, setup ganks con la wave. Teleport para objectives, no para lane.`
      : `🏔️ **Top tips**: Wave management is key (freeze, slow push, fast push). If your jungler is topside, setup ganks with the wave. Teleport for objectives, not lane.`
    )
  } else if (mainRole === 'Support') {
    tips.push(isEs
      ? `🛡️ **Support tips**: Warding patterns: antes de objectives, deep wards en jungle enemiga. Roaming a mid cuando tu ADC está back o la wave está pushed. Zoning en lane.`
      : `🛡️ **Support tips**: Warding patterns: before objectives, deep wards in enemy jungle. Roaming to mid when your ADC is backing or wave is pushed. Zoning in lane.`
    )
  }

  if (details && details.length > 0) {
    const worstCS = details.reduce((w, d) => parseFloat(d.csDiff) < parseFloat(w.csDiff) ? d : w, details[0])
    if (parseFloat(worstCS.csDiff) < -1) {
      tips.push(isEs
        ? `📉 **Peor farm game**: ${worstCS.champion} (${worstCS.role}) con ${worstCS.csPerMin} CS/min (target: ${worstCS.csTarget}). Revisa las waves de esa partida — ¿estabas roamando demasiado? ¿Moriste mucho early?`
        : `📉 **Worst farm game**: ${worstCS.champion} (${worstCS.role}) with ${worstCS.csPerMin} CS/min (target: ${worstCS.csTarget}). Review that match's waves — were you roaming too much? Dying too much early?`
      )
    }
  }

  return isEs
    ? `📊 **Análisis de tus ${summary.matchCount} partidas**\n\n🏆 ${summary.wins}W / ${summary.losses}L (${summary.winrate}% WR)\n⚔️ KDA promedio: ${summary.avgKDA} | CS/min: ${summary.avgCSPerMin} | KP: ${summary.avgKillParticipation}%\n\n${tips.join('\n\n')}\n\n💡 **Consejo general**: Cada muerte evitable = ~300g y 15-20s perdidos. Antes de hacer una jugada, pregúntate: "¿Estoy preparado?" (visión, items, cooldowns). La paciencia gana más games que la agresividad.\n\n¿Quieres que analice algo específico? Puedo profundizar en farm, rotaciones, vision, teamfights, o matchups.`
    : `📊 **Analysis of your ${summary.matchCount} matches**\n\n🏆 ${summary.wins}W / ${summary.losses}L (${summary.winrate}% WR)\n⚔️ Avg KDA: ${summary.avgKDA} | CS/min: ${summary.avgCSPerMin} | KP: ${summary.avgKillParticipation}%\n\n${tips.join('\n\n')}\n\n💡 **General tip**: Every avoidable death = ~300g and 15-20s lost. Before making a play, ask yourself: "Am I prepared?" (vision, items, cooldowns). Patience wins more games than aggression.\n\nWant me to analyze something specific? I can dive deeper into farm, rotations, vision, teamfights, or matchups.`
}
