export function roleLabel(role) {
  const map = {
    TOP: 'TOP',
    JUNGLE: 'JG',
    MIDDLE: 'MID',
    BOTTOM: 'ADC',
    UTILITY: 'SUP',
  }
  return map[role] || role || '?'
}

export function fmtNum(n) {
  if (n == null) return '0'
  n = Number(n)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

export function kdaRatio(k, d, a) {
  if (d === 0) return 'P'
  return ((k + a) / d).toFixed(2)
}

export function timeAgo(createdMs, lang) {
  if (!createdMs) return ''
  const diff = Date.now() - createdMs
  if (diff < 0) return ''
  const s = Math.floor(diff / 1000)
  if (s < 60) return lang === 'es' ? 'ahora' : 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return lang === 'es' ? `hace ${m} min` : `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return lang === 'es' ? `hace ${h}h` : `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 0) return lang === 'es' ? 'hoy' : 'today'
  if (d === 1) return lang === 'es' ? 'ayer' : 'yesterday'
  return lang === 'es' ? `hace ${d} días` : `${d}d ago`
}

export function sortPlayers(players) {
  const order = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 }
  return [...players].sort(
    (a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9),
  )
}
