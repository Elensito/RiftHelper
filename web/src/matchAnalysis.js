
const ROLE_LABELS = {
  en: { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' },
  es: { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' },
}

function roleLabel(role, lang) {
  return (ROLE_LABELS[lang] || ROLE_LABELS.en)[role] || role || '?'
}

function csRating(csPerMin, role) {
  if (role === 'JUNGLE') {
    if (csPerMin >= 5.5) return 'excellent'
    if (csPerMin >= 4.5) return 'good'
    if (csPerMin >= 3.5) return 'average'
    return 'poor'
  }
  if (role === 'SUPPORT' || role === 'UTILITY') {
    return csPerMin >= 1.5 ? 'good' : 'average'
  }
  if (csPerMin >= 8) return 'excellent'
  if (csPerMin >= 7) return 'good'
  if (csPerMin >= 6) return 'average'
  return 'poor'
}

function visionRating(vision, durationMin) {
  const perMin = vision / Math.max(1, durationMin)
  if (perMin >= 1.8) return 'excellent'
  if (perMin >= 1.2) return 'good'
  if (perMin >= 0.8) return 'average'
  return 'poor'
}

function kdaGrade(kills, deaths, assists) {
  if (deaths === 0) return 'perfect'
  const ratio = (kills + assists) / deaths
  if (ratio >= 5) return 'excellent'
  if (ratio >= 3) return 'good'
  if (ratio >= 2) return 'average'
  return 'poor'
}

function goldDiffAtMinutes(frames, puuid, allyTeamId) {
  const diffs = []
  for (const frame of frames) {
    const ts = frame.timestamp || 0
    const min = Math.round(ts / 60000)
    if (min % 5 !== 0 || min === 0) continue
    const playerFrame = (frame.participantFrames || {})[String(Object.keys(frame.participantFrames || {}).find(k => {
      const pf = frame.participantFrames[k]
      return pf && pf.puuid === puuid
    }))]
    if (playerFrame) {
      diffs.push({ minute: min, gold: playerFrame.totalGold || 0 })
    }
  }
  return diffs
}

function findPuuidParticipantId(frames, puuid) {
  for (const frame of frames) {
    for (const [pid, pf] of Object.entries(frame.participantFrames || {})) {
      if (pf && pf.puuid === puuid) return Number(pid)
    }
  }
  return null
}

function estimateRotations(frames, puuid, participantId, durationSec) {
  const events = []
  for (const frame of frames) {
    for (const ev of frame.events || []) {
      if (ev.type !== 'CHAMPION_KILL') continue
      if (ev.killerId !== participantId && !(ev.assistingParticipantIds || []).includes(participantId)) continue
      const min = Math.round((ev.timestamp || 0) / 60000)
      const pos = ev.position || {}
      let lane = 'unknown'
      if (pos.x !== undefined) {
        if (pos.x < 5000) lane = 'top'
        else if (pos.x > 10000) lane = 'bot'
        else lane = 'mid'
      }
      if (pos.y !== undefined) {
        if (pos.y > 10000) lane = 'top'
        else if (pos.y < 4000) lane = 'bot'
        else if (pos.x > 12000) lane = 'jungle_red'
        else lane = 'jungle_blue'
      }
      events.push({ minute: min, lane, type: 'kill' })
    }
  }

  const laneCounts = {}
  for (const e of events) {
    if (e.lane !== 'unknown') {
      laneCounts[e.lane] = (laneCounts[e.lane] || 0) + 1
    }
  }

  const primaryLane = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0]
  const otherLanes = Object.entries(laneCounts).filter(([l]) => l !== (primaryLane || [])[0])
  const roamScore = otherLanes.reduce((s, [, c]) => s + c, 0)
  const totalKills = events.length
  const roamPercent = totalKills > 0 ? Math.round((roamScore / totalKills) * 100) : 0

  return {
    primaryLane: primaryLane ? primaryLane[0] : 'unknown',
    roamScore,
    roamPercent,
    totalKillsInvolvement: totalKills,
    events: events.slice(0, 20),
  }
}

function detectObjectiveParticipation(frames, participantId) {
  const objectives = { dragons: 0, barons: 0, heralds: 0, towers: 0 }
  for (const frame of frames) {
    for (const ev of frame.events || []) {
      if (!ev.killerId) continue
      const assisted = ev.assistingParticipantIds || []
      const involved = ev.killerId === participantId || assisted.includes(participantId)
      if (!involved) continue
      switch (ev.type) {
        case 'DRAGON_KILL':
        case 'DRAGON_SOUL_KILL':
          objectives.dragons++
          break
        case 'BARON_KILL':
          objectives.barons++
          break
        case 'RIFT_HERALD_KILL':
          objectives.heralds++
          break
        case 'TURRET_PLATE_DESTROYED':
        case 'TURRET_DESTROYED':
          objectives.towers++
          break
      }
    }
  }
  return objectives
}

function detectTimelineEvents(frames, participantId) {
  const firstBlood = frames.some(f =>
    (f.events || []).some(e => e.type === 'CHAMPION_KILL' && e.killerId === participantId && e.firstBlood)
  )
  const shutdowns = frames.reduce((count, f) =>
    count + (f.events || []).filter(e =>
      e.type === 'CHAMPION_KILL' && e.killerId === participantId && e.shutdown
    ).length, 0
  )
  const deathsToShutdown = frames.reduce((count, f) =>
    count + (f.events || []).filter(e =>
      e.type === 'CHAMPION_KILL' && e.victimId === participantId && e.shutdown
    ).length, 0
  )
  return { firstBlood, shutdowns, deathsToShutdown }
}

function lanePhasePerformance(pl, teamPlayers, durationMin) {
  const role = pl.role || ''
  const isSupport = role === 'UTILITY'
  const isJungle = role === 'JUNGLE'

  const teamKills = teamPlayers.reduce((s, p) => s + (p.kills || 0), 0)
  const kp = teamKills > 0 ? ((pl.kills + pl.assists) / teamKills * 100) : 0

  const avgTeamGold = teamPlayers.reduce((s, p) => s + (p.gold || 0), 0) / Math.max(1, teamPlayers.length)
  const goldAdv = pl.gold - avgTeamGold

  const avgTeamDamage = teamPlayers.reduce((s, p) => s + (p.damage || 0), 0) / Math.max(1, teamPlayers.length)
  const damageAdv = pl.damage - avgTeamDamage

  return {
    role: roleLabel(role, 'en'),
    roleEs: roleLabel(role, 'es'),
    csPerMin: pl.cs_per_min || 0,
    csGrade: csRating(pl.cs_per_min || 0, role),
    visionScore: pl.vision || 0,
    visionGrade: visionRating(pl.vision || 0, durationMin),
    kdaGrade: kdaGrade(pl.kills, pl.deaths, pl.assists),
    killParticipation: Math.round(kp),
    goldAdvantage: Math.round(goldAdv),
    damageAdvantage: Math.round(damageAdv),
    isSupport,
    isJungle,
  }
}

export function buildMatchSummary(match, lang = 'en') {
  const pl = match.player || {}
  const info = match.players || []
  const durationSec = match.duration_sec || 0
  const durationMin = durationSec / 60 || 1

  const teamId = pl.team
  const teamPlayers = info.filter(p => p.team === teamId)
  const enemyPlayers = info.filter(p => p.team !== teamId)
  const enemyTeamKills = enemyPlayers.reduce((s, p) => s + (p.kills || 0), 0)

  const teamKills = teamPlayers.reduce((s, p) => s + (p.kills || 0), 0)
  const teamDeaths = teamPlayers.reduce((s, p) => s + (p.deaths || 0), 0)
  const teamAssists = teamPlayers.reduce((s, p) => s + (p.assists || 0), 0)

  const enemyTeamDeaths = teamPlayers.reduce((s, p) => s + (p.kills || 0), 0)

  const performance = lanePhasePerformance(pl, teamPlayers, durationMin)

  const mvp = info.filter(p => p.team === teamId).sort((a, b) => (b.carry_score || 0) - (a.carry_score || 0))[0]
  const isMVP = mvp && mvp.player_name === pl.player_name && mvp.champion === pl.champion

  const enemyADC = enemyPlayers.find(p => (p.role || '').toUpperCase() === 'BOTTOM' && p.team !== teamId)

  return {
    matchId: match.match_id,
    win: match.win,
    remake: match.remake,
    queue: match.queue,
    duration: match.duration,
    durationMin: Math.round(durationMin),
    date: match.date,
    player: {
      champion: pl.champion,
      role: performance.role,
      roleEs: performance.roleEs,
      kills: pl.kills,
      deaths: pl.deaths,
      assists: pl.assists,
      kda: pl.deaths === 0 ? 'Perfect' : ((pl.kills + pl.assists) / pl.deaths).toFixed(2),
      cs: pl.cs,
      csPerMin: pl.cs_per_min,
      csGrade: performance.csGrade,
      gold: pl.gold,
      damage: pl.damage,
      killParticipation: performance.killParticipation,
      vision: performance.visionScore,
      visionGrade: performance.visionGrade,
      kdaGrade: performance.kdaGrade,
      goldAdvantage: performance.goldAdvantage,
      damageAdvantage: performance.damageAdvantage,
      isMVP,
    },
    team: {
      kills: teamKills,
      deaths: teamDeaths,
      assists: teamAssists,
      kda: teamDeaths === 0 ? 'Perfect' : ((teamKills + teamAssists) / teamDeaths).toFixed(2),
    },
    enemy: {
      kills: enemyTeamKills,
      deaths: enemyTeamDeaths,
    },
    rating: getOverallRating(performance, match.win),
  }
}

function getOverallRating(perf, win) {
  let score = 0
  if (perf.csGrade === 'excellent') score += 3
  else if (perf.csGrade === 'good') score += 2
  else if (perf.csGrade === 'average') score += 1

  if (perf.visionGrade === 'excellent') score += 3
  else if (perf.visionGrade === 'good') score += 2
  else if (perf.visionGrade === 'average') score += 1

  if (perf.kdaGrade === 'excellent' || perf.kdaGrade === 'perfect') score += 3
  else if (perf.kdaGrade === 'good') score += 2
  else if (perf.kdaGrade === 'average') score += 1

  if (perf.killParticipation >= 60) score += 2
  else if (perf.killParticipation >= 40) score += 1

  if (win) score += 1

  if (score >= 8) return 'S'
  if (score >= 6) return 'A'
  if (score >= 4) return 'B'
  if (score >= 2) return 'C'
  return 'D'
}

export function buildBatchSummary(matches, lang = 'en') {
  if (!matches || matches.length === 0) return null

  const summaries = matches.map(m => buildMatchSummary(m, lang)).filter(Boolean)
  const wins = summaries.filter(s => s.win).length
  const total = summaries.length
  const winrate = total > 0 ? Math.round((wins / total) * 100) : 0

  const avgKDA = summaries.reduce((s, m) => s + parseFloat(m.player.kda || '0'), 0) / Math.max(1, total)
  const avgCS = summaries.reduce((s, m) => s + m.player.csPerMin, 0) / Math.max(1, total)
  const avgKP = summaries.reduce((s, m) => s + m.player.killParticipation, 0) / Math.max(1, total)
  const avgVision = summaries.reduce((s, m) => s + m.player.vision, 0) / Math.max(1, total)

  const ratings = summaries.reduce((acc, s) => {
    acc[s.rating] = (acc[s.rating] || 0) + 1
    return acc
  }, {})

  const strongestRating = Object.entries(ratings).sort((a, b) => b[1] - a[1])[0]
  const roles = summaries.reduce((acc, s) => {
    acc[s.player.role] = (acc[s.player.role] || 0) + 1
    return acc
  }, {})
  const mainRole = Object.entries(roles).sort((a, b) => b[1] - a[1])[0]

  return {
    matchCount: total,
    wins,
    losses: total - wins,
    winrate,
    avgKDA: avgKDA.toFixed(2),
    avgCSPerMin: avgCS.toFixed(1),
    avgKillParticipation: Math.round(avgKP),
    avgVision: avgVision.toFixed(1),
    ratings,
    mainRole: mainRole ? mainRole[0] : 'Unknown',
    summaries,
  }
}

export function formatAnalysisPrompt(batchSummary, lang = 'en') {
  if (!batchSummary) return ''

  const t = lang === 'es' ? {
    intro: 'He analizado tus últimas partidas. Aquí están los datos:',
    wins: 'Victorias',
    losses: 'Derrotas',
    winrate: 'Winrate',
    avgKDA: 'KDA promedio',
    avgCS: 'CS/min promedio',
    avgKP: 'Participación en kills promedio',
    avgVision: 'Visión promedio',
    mainRole: 'Rol principal',
    matchDetails: 'Detalles por partida:',
    win: 'Victoria',
    loss: 'Derrota',
    kda: 'KDA',
    csMin: 'CS/min',
    kp: 'KP',
    rating: 'Calificación',
    coach: 'Coach IA',
    ask: '¿Qué aspectos de tu juego te gustaría mejorar? Puedo analizar tu farm, rotaciones, visión, build, decisiones de juego y más.',
  } : {
    intro: "I've analyzed your recent matches. Here are the stats:",
    wins: 'Wins',
    losses: 'Losses',
    winrate: 'Winrate',
    avgKDA: 'Avg KDA',
    avgCS: 'Avg CS/min',
    avgKP: 'Avg Kill Participation',
    avgVision: 'Avg Vision Score',
    mainRole: 'Main Role',
    matchDetails: 'Match details:',
    win: 'Win',
    loss: 'Loss',
    kda: 'KDA',
    csMin: 'CS/min',
    kp: 'KP',
    rating: 'Rating',
    coach: 'AI Coach',
    ask: 'What aspects of your gameplay would you like to improve? I can analyze your farm, rotations, vision, build, game decisions and more.',
  }

  let prompt = `${t.intro}\n\n`
  prompt += `📊 ${t.wins}: ${batchSummary.wins} | ❌ ${t.losses}: ${batchSummary.losses} | 📈 ${t.winrate}: ${batchSummary.winrate}%\n`
  prompt += `⚔️ ${t.avgKDA}: ${batchSummary.avgKDA} | 🌾 ${t.avgCS}: ${batchSummary.avgCSPerMin} | 🎯 ${t.avgKP}: ${batchSummary.avgKillParticipation}%\n`
  prompt += `👁️ ${t.avgVision}: ${batchSummary.avgVision} | 🎭 ${t.mainRole}: ${batchSummary.mainRole}\n\n`

  prompt += `${t.matchDetails}\n`
  for (const s of batchSummary.summaries) {
    const icon = s.win ? '✅' : '❌'
    prompt += `${icon} ${s.player.champion} (${s.player.role}) | ${s.win ? t.win : t.loss} | ${s.player.kills}/${s.player.deaths}/${s.player.assists} (${t.kda}: ${s.player.kda}) | ${s.player.csPerMin} ${t.csMin} | ${s.player.killParticipation}% ${t.kp} | ⭐${s.rating}\n`
  }

  prompt += `\n${t.ask}`

  return prompt
}

export function extractDetailedAnalysis(match) {
  const pl = match.player || {}
  const info = match.players || []
  const durationSec = match.duration_sec || 0
  const durationMin = durationSec / 60 || 1

  const teamId = pl.team
  const teamPlayers = info.filter(p => p.team === teamId)

  const teamGold = teamPlayers.reduce((s, p) => s + (p.gold || 0), 0)
  const teamDamage = teamPlayers.reduce((s, p) => s + (p.damage || 0), 0)
  const goldShare = teamGold > 0 ? Math.round((pl.gold / teamGold) * 100) : 0
  const damageShare = teamDamage > 0 ? Math.round((pl.damage / teamDamage) * 100) : 0

  const role = (pl.role || '').toUpperCase()
  const expectedCSPerMin = {
    TOP: 7.5, JUNGLE: 4.5, MIDDLE: 8, BOTTOM: 8.5, UTILITY: 1.5,
  }
  const csTarget = expectedCSPerMin[role] || 7
  const csDiff = (pl.cs_per_min || 0) - csTarget

  return {
    champion: pl.champion,
    role: roleLabel(role, 'en'),
    goldShare,
    damageShare,
    csTarget,
    csDiff: csDiff.toFixed(1),
    csPerMin: pl.cs_per_min,
    visionPerMin: (pl.vision / Math.max(1, durationMin)).toFixed(1),
    kda: pl.deaths === 0 ? 'Perfect' : ((pl.kills + pl.assists) / pl.deaths).toFixed(2),
    killParticipation: pl.kp || 0,
    goldPerMin: (pl.gold / Math.max(1, durationMin)).toFixed(0),
    damagePerMin: (pl.damage / Math.max(1, durationMin)).toFixed(0),
    win: match.win,
    durationMin: Math.round(durationMin),
  }
}

export function buildRichCoachingPrompt(matches, lang = 'en') {
  if (!matches || matches.length === 0) return ''

  const es = lang === 'es'

  const lines = []
  lines.push(es
    ? '=== ANÁLISIS DETALLADO DE PARTIDAS ==='
    : '=== DETAILED MATCH ANALYSIS ===')
  lines.push('')

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const pl = m.player || {}
    const ctx = m.ai_context || {}
    const dur = m.duration || `${m.duration_sec ? Math.round(m.duration_sec / 60) : '?'}min`

    lines.push(es ? `--- Partida ${i + 1} ---` : `--- Match ${i + 1} ---`)
    lines.push(`${m.win ? (es ? 'Victoria' : 'WIN') : (es ? 'Derrota' : 'LOSS')} | ${pl.champion} ${pl.role || ''} | ${pl.kills}/${pl.deaths}/${pl.assists} | ${dur}`)
    lines.push(es ? `CS: ${pl.cs} (${pl.cs_per_min}/min) | Gold: ${pl.gold} | Damage: ${pl.damage} | KP: ${pl.kp}% | Vision: ${pl.vision}` : `CS: ${pl.cs} (${pl.cs_per_min}/min) | Gold: ${pl.gold} | Damage: ${pl.damage} | KP: ${pl.kp}% | Vision: ${pl.vision}`)

    if (ctx.my_build && ctx.my_build.length > 0) {
      lines.push(es ? `Build: ${ctx.my_build.filter(Boolean).join(', ')}` : `Build: ${ctx.my_build.filter(Boolean).join(', ')}`)
    }
    if (ctx.my_runes && ctx.my_runes.length > 0) {
      lines.push(es ? `Runas: ${ctx.my_runes.filter(Boolean).join(' > ')}` : `Runes: ${ctx.my_runes.filter(Boolean).join(' > ')}`)
    }
    if (ctx.my_spells && ctx.my_spells.length > 0) {
      lines.push(es ? `Hechizos: ${ctx.my_spells.filter(Boolean).join(', ')}` : `Spells: ${ctx.my_spells.filter(Boolean).join(', ')}`)
    }

    if (ctx.enemy_matchup_build && ctx.enemy_matchup_build.length > 0) {
      const enemy = m.players ? m.players.find(p => p.team !== pl.team && (p.role || '').toUpperCase() === (pl.role || '').toUpperCase()) : null
      const enemyName = enemy ? `${enemy.champion}` : (es ? 'enemigo' : 'enemy')
      lines.push(es ? `Matchup vs ${enemyName}: ${ctx.enemy_matchup_build.filter(Boolean).join(', ')}` : `Matchup vs ${enemyName}: ${ctx.enemy_matchup_build.filter(Boolean).join(', ')}`)
      if (ctx.enemy_matchup_runes && ctx.enemy_matchup_runes.length > 0) {
        lines.push(es ? `Runas enemigas: ${ctx.enemy_matchup_runes.filter(Boolean).join(' > ')}` : `Enemy runes: ${ctx.enemy_matchup_runes.filter(Boolean).join(' > ')}`)
      }
    }

    if (ctx.gold_snapshots && Object.keys(ctx.gold_snapshots).length > 0) {
      const snaps = Object.entries(ctx.gold_snapshots).sort((a, b) => Number(a[0]) - Number(b[0]))
      const snapStr = snaps.map(([min, s]) => `${min}min:${s.gold}g/${s.cs}cs`).join(' | ')
      lines.push(es ? `Curva de oro: ${snapStr}` : `Gold curve: ${snapStr}`)
    }

    if (ctx.diff10 != null) {
      lines.push(es ? `Gold diff @10: ${ctx.diff10 > 0 ? '+' : ''}${ctx.diff10}` : `Gold diff @10: ${ctx.diff10 > 0 ? '+' : ''}${ctx.diff10}`)
    }
    if (ctx.diff30 != null) {
      lines.push(es ? `Gold diff @30: ${ctx.diff30 > 0 ? '+' : ''}${ctx.diff30}` : `Gold diff @30: ${ctx.diff30 > 0 ? '+' : ''}${ctx.diff30}`)
    }

    if (ctx.kills && ctx.kills.length > 0) {
      const killStr = ctx.kills.map(k => `${k.minute}' ${es ? 'vs' : 'vs'} ${k.vs} ${k.lane}${k.shutdown ? ' (shutdown)' : ''}`).join('; ')
      lines.push(es ? `Kills: ${killStr}` : `Kills: ${killStr}`)
    }

    if (ctx.deaths && ctx.deaths.length > 0) {
      const deathStr = ctx.deaths.map(d => `${d.minute}' ${es ? 'por' : 'by'} ${d.by} ${d.lane}${d.assists_count ? ` (+${d.assists_count})` : ''}`).join('; ')
      lines.push(es ? `Muertes: ${deathStr}` : `Deaths: ${deathStr}`)
    }

    if (ctx.objectives && ctx.objectives.length > 0) {
      const objStr = ctx.objectives.map(o => `${o.minute}' ${o.objective}`).join('; ')
      lines.push(es ? `Objetivos: ${objStr}` : `Objectives: ${objStr}`)
    }

    if (ctx.towers && ctx.towers.length > 0) {
      const towerStr = ctx.towers.map(t => `${t.minute}' ${t.lane}`).join('; ')
      lines.push(es ? `Torres destruidas: ${towerStr}` : `Towers taken: ${towerStr}`)
    }

    if (ctx.team_comp) {
      const allyComp = (ctx.team_comp.allies || []).map(p => `${p.champion}(${p.role})`).join(', ')
      const enemyComp = (ctx.team_comp.enemies || []).map(p => `${p.champion}(${p.role})`).join(', ')
      lines.push(es ? `Tu equipo: ${allyComp}` : `Your team: ${allyComp}`)
      lines.push(es ? `Equipo enemigo: ${enemyComp}` : `Enemy team: ${enemyComp}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
