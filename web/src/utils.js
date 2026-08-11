export const QUEUES = {
  400: 'Normal (Draft)',
  420: 'Ranked Solo',
  430: 'Normal',
  440: 'Ranked Flex',
  450: 'ARAM',
  480: 'Swiftplay',
  700: 'Clash',
}

export function queueLabel(id) {
  return QUEUES[id] || 'Partida'
}

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

export function sortPlayers(players) {
  const order = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 }
  return [...players].sort(
    (a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9),
  )
}
