import { fetchSummoner } from './api.js'

export function loadVodsRaw() {
  try { return JSON.parse(localStorage.getItem('rh-vods') || '[]') } catch { return [] }
}

export function saveVodsRaw(vods) {
  localStorage.setItem('rh-vods', JSON.stringify(vods))
  window.dispatchEvent(new Event('rh-vods-changed'))
}

function mapPlayer(p) {
  return {
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
  }
}

export function buildTeamsFromMatch(match) {
  const bluePlayers = (match.players || []).filter(p => p.team === 100)
  const redPlayers = (match.players || []).filter(p => p.team === 200)
  const blueWins = bluePlayers.length > 0 ? bluePlayers[0].win : false
  return {
    team1: bluePlayers.map(mapPlayer),
    team2: redPlayers.map(mapPlayer),
    winner: blueWins ? 1 : 2,
    durationSec: match.duration_sec || 0,
  }
}

/* Finds the freshly-indexed match for a pending VOD. `excludeIds` rejects
   matches known BEFORE the game started (stale /check results). */
export async function retryPendingMatches(summoner, excludeIds = []) {
  const vods = loadVodsRaw()
  const pending = vods.filter(v => v.pendingMatch)
  if (!pending.length || !summoner) return pending.length

  /* A match can only ever back ONE VOD: claim ids already used by resolved
     VODs up-front, and add each new binding as it happens. Without this,
     several stale pendings (crashed sessions) all bound the same recent
     match, producing duplicate cards. */
  const claimed = new Set(
    vods.filter(v => !v.pendingMatch).map(v => v.matchId).filter(Boolean)
  )
  const now = Date.now()

  let fresh = null
  try {
    /* Each poll only needs the most recent matches — one per pending VOD
       (usually exactly 1) instead of a fixed batch of 5. This cuts the
       Riot API cost of the aggressive polling window by ~3x while staying
       correct when several recordings are pending at once. */
    const need = Math.min(Math.max(pending.length, 1), 5)
    const data = await fetchSummoner(summoner.name, summoner.tag, need, 0, true)
    fresh = data.matches || []
  } catch {
    return pending.length
  }

  let changed = false
  for (const vod of pending) {
    /* Pendings older than 2h will almost never resolve cleanly (app crashed
       mid-game, or a custom/practice game Riot never indexed): stop polling
       instead of risking a wrong bind on some future match. */
    if (vod.pendingAt && now - vod.pendingAt > 2 * 60 * 60 * 1000) {
      vod.pendingMatch = false
      vod.bindFailed = true
      changed = true
      continue
    }
    const champ = vod.pendingChampion || vod.champion || ''
    const cand = fresh.find(m =>
      m.match_id &&
      !claimed.has(m.match_id) &&
      m.match_id !== vod.matchId &&
      !excludeIds.includes(m.match_id) &&
      (!champ || !m.champion || String(m.champion).toLowerCase() === String(champ).toLowerCase())
    )
    if (!cand) continue
    claimed.add(cand.match_id)
    const t = buildTeamsFromMatch(cand)
    vod.matchId = cand.match_id
    vod.duration = t.durationSec || vod.duration
    vod.winner = t.winner
    vod.team1 = t.team1
    vod.team2 = t.team2
    const me = (cand.players || []).find(p => p.puuid === summoner.puuid)
    if (me) {
      vod.result = me.win ? 'win' : 'loss'
      vod.kda = `${me.kills || 0}/${me.deaths || 0}/${me.assists || 0}`
      vod.champion = vod.champion || me.champion || ''
      vod.championIcon = vod.championIcon || me.champion_icon || ''
    }
    vod.pendingMatch = false
    changed = true
  }
  if (changed) saveVodsRaw(vods)
  return vods.filter(v => v.pendingMatch).length
}
