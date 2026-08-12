export async function fetchSummoner(name, tag, count = 20) {
  const url = `/api/summoner?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}&count=${count}`
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

export async function fetchLiveGame(name, tag) {
  const url = `/api/live-game?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener la partida en vivo')
  return data
}
