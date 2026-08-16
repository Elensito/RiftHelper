const API_BASE =
  typeof window !== 'undefined' && window.__TAURI_INTERNALS__
    ? 'https://rift-helper.com'
    : ''

export async function fetchSummoner(name, tag, count = 20, start = 0, refresh = false) {
  const url = `${API_BASE}/api/summoner?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}&count=${count}&start=${start}${refresh ? '&refresh=1' : ''}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener los datos')
  return data
}

export async function fetchLatestMatch(name, tag) {
  const url = `${API_BASE}/api/summoner/check?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al comprobar partidas')
  return data
}

export async function fetchMatchMetrics(matchId, puuid) {
  const url = `${API_BASE}/api/match/${encodeURIComponent(matchId)}/metrics?puuid=${encodeURIComponent(puuid || '')}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener las métricas')
  return data
}

export async function fetchMatchBuild(matchId) {
  const url = `${API_BASE}/api/match/${encodeURIComponent(matchId)}/build`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener el build')
  return data
}

export async function fetchMatchEvents(matchId, puuid) {
  const url = `${API_BASE}/api/match/${encodeURIComponent(matchId)}/events?puuid=${encodeURIComponent(puuid || '')}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener los eventos')
  return data
}

export async function fetchLiveGame(name, tag) {
  const url = `${API_BASE}/api/live-game?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener la partida en vivo')
  return data
}

export async function fetchSummonerByPuuid(puuid, region) {
  const url = `${API_BASE}/api/summoner/by-puuid?puuid=${encodeURIComponent(puuid)}${region ? `&region=${encodeURIComponent(region)}` : ''}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener el invocador')
  return data
}

export async function fetchMastery(name, tag) {
  const url = `${API_BASE}/api/mastery?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener la maestría')
  return data
}

export async function fetchChampions() {
  const res = await fetch(`${API_BASE}/api/champions`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener los campeones')
  return data.champions || []
}

export async function fetchChampion(key) {
  const res = await fetch(`${API_BASE}/api/champion/${encodeURIComponent(key)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener el campeón')
  return data
}

export async function fetchTooltip(kind, id, lang, champ) {
  let url = `${API_BASE}/api/tooltip?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang || 'es')}`
  if (champ) url += `&champ=${encodeURIComponent(champ)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener la información')
  return data
}
