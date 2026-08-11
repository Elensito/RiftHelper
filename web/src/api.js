export async function fetchSummoner(name, tag, count = 20) {
  const url = `/api/summoner?name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}&count=${count}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Error al obtener los datos')
  return data
}
