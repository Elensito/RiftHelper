/**
 * TEMPORARY TEST SCRIPT — force re-resolve a VOD's match and rebuild timeline.
 * Usage: import { debugVod, forceReResolve } from './test-timeline.js'
 *        Then call debugVod() in browser console or add a temp button.
 * DELETE AFTER TESTING.
 */

import { loadVodsRaw, saveVodsRaw } from './match-resolver.js'
import { readVodEvents } from './tauri.js'

function findVod(search) {
  const vods = loadVodsRaw()
  if (!search) return vods
  const s = String(search).toLowerCase()
  return vods.filter(v =>
    (v.id && v.id.includes(s)) ||
    (v.videoPath && v.videoPath.toLowerCase().includes(s)) ||
    (v.champion && String(v.champion).toLowerCase().includes(s)) ||
    (v.matchId && v.matchId.includes(s))
  )
}

export async function debugVod(search) {
  const matches = findVod(search)
  if (!matches.length) {
    console.warn('[test-timeline] No VODs found for:', search)
    return
  }
  for (const vod of matches) {
    console.group(`%c[VOD] ${vod.id}`, 'color: #0ff; font-weight: bold')
    console.log('matchId:', vod.matchId || '(none)')
    console.log('champion:', vod.champion || '?')
    console.log('pendingMatch:', !!vod.pendingMatch)
    console.log('duration:', vod.duration, 'sec')
    console.log('team1:', vod.team1 || '[]')
    console.log('team2:', vod.team2 || '[]')

    if (vod.team1 || vod.team2) {
      const all = [...(vod.team1 || []), ...(vod.team2 || [])]
      const me = all.find(p => p.isPlayer || p.is_player)
      if (me) {
        console.log(
          `%cResolved KDA: ${me.kills}/${me.deaths}/${me.assists}`,
          'color: #0f0; font-weight: bold'
        )
      } else {
        console.warn('Player not found in team data!')
      }
    } else {
      console.warn('No team data — match not resolved yet')
    }

    // Read local LCD events
    if (vod.videoPath) {
      try {
        const raw = await readVodEvents(vod.videoPath)
        if (raw) {
          const parsed = JSON.parse(raw)
          const meName = (parsed.me || '').toLowerCase()
          const events = parsed.events || []
          const killMe = events.filter(e =>
            e.type === 'kill' && e.killer?.name?.toLowerCase() === meName
          ).length
          const deathMe = events.filter(e =>
            e.type === 'kill' && e.victim?.name?.toLowerCase() === meName
          ).length
          const assistMe = events.filter(e =>
            e.type === 'kill' &&
            (e.assisters || []).some(a => a?.name?.toLowerCase() === meName)
          ).length
          console.log(
            `%cLCD events: ${killMe}K / ${deathMe}D / ${assistMe}A (${events.length} total)`,
            'color: #ff0; font-weight: bold'
          )

          if (vod.team1 || vod.team2) {
            const all = [...(vod.team1 || []), ...(vod.team2 || [])]
            const me = all.find(p => p.isPlayer || p.is_player)
            if (me) {
              const dk = Math.max(0, killMe - (me.kills || 0))
              const dd = Math.max(0, deathMe - (me.deaths || 0))
              const da = Math.max(0, assistMe - (me.assists || 0))
              console.log(
                `%cExcess to filter: ${dk}K / ${dd}D / ${da}A`,
                dk || dd || da ? 'color: #f55; font-weight: bold' : 'color: #5f5'
              )
            }
          }
        }
      } catch (e) {
        console.warn('Could not read events:', e.message)
      }
    }
    console.groupEnd()
  }
}

export function forceReResolve(search) {
  const vods = loadVodsRaw()
  const s = String(search || '').toLowerCase()
  let changed = false
  for (const vod of vods) {
    const match = !s ||
      (vods.indexOf(vod) >= 0 && (
        (vod.id && vod.id.includes(s)) ||
        (vod.videoPath && vod.videoPath.toLowerCase().includes(s)) ||
        (vod.champion && String(vod.champion).toLowerCase().includes(s)) ||
        (vod.matchId && vod.matchId.includes(s))
      ))
    if (!match) continue

    console.log(`[test-timeline] Resetting VOD ${vod.id} (${vod.champion || '?'})`)
    vod.pendingMatch = true
    vod.pendingAt = Date.now()
    delete vod.bindFailed
    changed = true
  }
  if (changed) {
    saveVodsRaw(vods)
    console.log('[test-timeline] Done — app will re-resolve matches on next poll cycle')
  } else {
    console.warn('[test-timeline] No VODs matched:', search)
  }
  return changed
}

export function forceSetKda(search, kills, deaths, assists) {
  const vods = loadVodsRaw()
  const s = String(search || '').toLowerCase()
  let changed = false
  for (const vod of vods) {
    const match = !s ||
      (vod.id && vod.id.includes(s)) ||
      (vod.videoPath && vod.videoPath.toLowerCase().includes(s))
    if (!match) continue

    if (!vod.team1) vod.team1 = []
    if (!vod.team2) vod.team2 = []
    const all = [...vod.team1, ...vod.team2]
    let me = all.find(p => p.isPlayer || p.is_player)
    if (!me) {
      me = { name: 'Elensito', champion: vod.champion || '', kills: 0, deaths: 0, assists: 0, isPlayer: true }
      vod.team2.push(me)
    }
    console.log(`[test-timeline] Setting KDA for ${vod.id}: ${kills}/${deaths}/${assists}`)
    me.kills = kills
    me.deaths = deaths
    me.assists = assists
    vod.pendingMatch = false
    changed = true
  }
  if (changed) saveVodsRaw(vods)
  else console.warn('[test-timeline] No VODs matched:', search)
  return changed
}

// Expose globally for console usage
if (typeof window !== 'undefined') {
  window.__debugVod = debugVod
  window.__forceReResolve = forceReResolve
  window.__forceSetKda = forceSetKda
  console.log(
    '%c[test-timeline] Loaded! Use in console:\n' +
    '  __debugVod("Zeri")          — show VOD state + LCD vs actual KDA\n' +
    '  __forceReResolve("Zeri")    — force match re-resolution\n' +
    '  __forceSetKda("Zeri", 21, 7, 7) — manually set KDA for testing',
    'color: #0ff'
  )
}
