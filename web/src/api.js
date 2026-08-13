export async function fetchSummoner(name, tag, count = 20, start = 0, refresh = false) {
  const url = `/api/summoner?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}&count=${count}&start=${start}${refresh ? '&refresh=1' : ''}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener los datos')
  return data
}

export async function fetchMatchMetrics(matchId, puuid) {
  const url = `/api/match/${encodeURIComponent(matchId)}/metrics?puuid=${encodeURIComponent(puuid || '')}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener las métricas')
  return data
}

export async function fetchMatchBuild(matchId) {
  const url = `/api/match/${encodeURIComponent(matchId)}/build`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener el build')
  return data
}

export async function fetchMatchEvents(matchId, puuid) {
  const url = `/api/match/${encodeURIComponent(matchId)}/events?puuid=${encodeURIComponent(puuid || '')}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener los eventos')
  return data
}

export async function fetchLiveGame(name, tag) {
  const url = `/api/live-game?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener la partida en vivo')
  return data
}

export async function fetchChampions() {
  const res = await fetch('/api/champions')
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener los campeones')
  return data.champions || []
}

export async function fetchChampion(key) {
  const res = await fetch(`/api/champion/${encodeURIComponent(key)}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener el campeón')
  return data
}
