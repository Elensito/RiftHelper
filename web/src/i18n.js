// ============================================================
// Strings de la interfaz, separadas por idioma.
// Todas las cadenas visibles de la página viven aquí.
// ============================================================

const EN = {
  search: 'Search',
  placeholder: 'Summoner name',
  tag: 'tag',
  update: 'Update',
  loading: 'Loading matches…',
  heroTitle: 'Analyze any summoner matches',
  heroSub:
    'Search by Name#tag and discover runes, builds, gold and damage of all 10 players of each match.',
  lp: 'LP',
  level: 'Lv',
  wins: 'W',
  losses: 'L',
  wr: 'WR',
  recentMatches: 'recent matches',
  blueTeam: 'BLUE TEAM',
  redTeam: 'RED TEAM',
  win: 'W',
  loss: 'L',
  kda: 'KDA',
  gold: 'Gold',
  damage: 'Damage',
  kp: 'KP',
  cs: 'CS',
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  goldShort: 'GOLD',
  damageShort: 'DAMAGE',
  visionShort: 'VISION',
  you: 'YOU',
  match: 'Match',
  tabGeneral: 'General',
  tabMetrics: 'Metrics',
  tabBuild: 'Build',
  buildSpells: 'Spells',
  buildSkillOrder: 'Skill order',
  buildRunes: 'Runes',
  buildNotFound: 'Build data not available for this player',
  metricGold: 'Gold',
  metricDamage: 'Damage',
  metricXp: 'XP',
  metricCs: 'CS',
  metricHint: 'Click a champion to track its curve',
  minShort: 'min',
  footerRiot: 'unofficial data provided by Riot Games',
}

const ES = {
  search: 'Buscar',
  placeholder: 'Nombre de invocador',
  tag: 'tag',
  update: 'Actualizar',
  loading: 'Cargando partidas…',
  heroTitle: 'Analiza las partidas de cualquier invocador',
  heroSub:
    'Busca por Nombre#tag y descubre runas, builds, oro y daño de los 10 jugadores de cada partida.',
  lp: 'LP',
  level: 'Nv',
  wins: 'V',
  losses: 'D',
  wr: 'WR',
  recentMatches: 'partidas recientes',
  blueTeam: 'EQUIPO AZUL',
  redTeam: 'EQUIPO ROJO',
  win: 'V',
  loss: 'D',
  kda: 'KDA',
  gold: 'Oro',
  damage: 'Daño',
  kp: 'KP',
  cs: 'CS',
  showDetails: 'Ver detalle',
  hideDetails: 'Ocultar detalle',
  goldShort: 'Oro',
  damageShort: 'Daño',
  visionShort: 'Visión',
  you: 'TÚ',
  match: 'Partida',
  tabGeneral: 'General',
  tabMetrics: 'Métricas',
  tabBuild: 'Build',
  buildSpells: 'Habilidades',
  buildSkillOrder: 'Orden de habilidades',
  buildRunes: 'Runas',
  buildNotFound: 'No hay datos de build para este jugador',
  metricGold: 'Oro',
  metricDamage: 'Daño',
  metricXp: 'XP',
  metricCs: 'CS',
  metricHint: 'Pulsa un campeón para activar su curva',
  minShort: 'min',
  footerRiot: 'datos no oficiales de Riot Games',
}

export const STR = { en: EN, es: ES }

// Idiomas disponibles (nombre mostrado en su propio idioma).
export const LANGS = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
]

// Modos de partida (nombres oficiales en el juego, por idioma).
export const QUEUES = {
  400: { en: 'Normal (Draft)', es: 'Normal (Draft)' },
  420: { en: 'Ranked Solo', es: 'Clasificatoria Solo' },
  430: { en: 'Normal', es: 'Normal' },
  440: { en: 'Ranked Flex', es: 'Clasificatoria Flexible' },
  450: { en: 'ARAM', es: 'ARAM' },
  480: { en: 'Swiftplay', es: 'Swiftplay' },
  700: { en: 'Clash', es: 'Clash' },
}

export function queueLabel(lang, id) {
  const q = QUEUES[id]
  if (q) return q[lang] || q.en
  return lang === 'es' ? 'Partida' : 'Match'
}

export function t(lang, key) {
  const dict = STR[lang] || STR.en
  return dict[key] || STR.en[key] || key
}
