




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
  tabMatches: 'Matches',
  filterAll: 'All',
  filterOther: 'Other',
  filterEmpty: 'No matches in this queue',
  tabGeneral: 'General',
  tabMetrics: 'Metrics',
  tabBuild: 'Build',
  tabLive: 'Live game',
  liveNow: 'IN GAME',
  liveBans: 'Bans',
  liveNotInGame: 'Not in a game right now',
  liveLoading: 'Loading live game…',
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
  tabMatches: 'Partidas',
  filterAll: 'Todas',
  filterOther: 'Otras',
  filterEmpty: 'No hay partidas en esta cola',
  tabGeneral: 'General',
  tabMetrics: 'Métricas',
  tabBuild: 'Build',
  tabLive: 'Partida en vivo',
  liveNow: 'EN PARTIDA',
  liveBans: 'Baneos',
  liveNotInGame: 'No está en partida ahora mismo',
  liveLoading: 'Cargando partida en vivo…',
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


export const LANGS = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
]


export const QUEUES = {
  0: { en: 'Custom', es: 'Personalizada' },
  400: { en: 'Normal (Draft)', es: 'Normal (Draft)' },
  420: { en: 'Ranked Solo', es: 'Clasificatoria Solo' },
  430: { en: 'Normal', es: 'Normal' },
  440: { en: 'Ranked Flex', es: 'Clasificatoria Flexible' },
  450: { en: 'ARAM', es: 'ARAM' },
  2400: { en: 'ARAM: Mayhem', es: 'ARAM: Mayhem' },
  480: { en: 'Swiftplay', es: 'Swiftplay' },
  490: { en: 'Quickplay', es: 'Quickplay' },
  700: { en: 'Clash', es: 'Clash' },
  720: { en: 'Clash', es: 'Clash' },
  820: { en: 'Co-op vs AI', es: 'Contra IA' },
  830: { en: 'Co-op vs AI', es: 'Contra IA' },
  840: { en: 'Co-op vs AI', es: 'Contra IA' },
  850: { en: 'Co-op vs AI', es: 'Contra IA' },
  900: { en: 'Clash', es: 'Clash' },
  1700: { en: 'Arena', es: 'Arena' },
  1740: { en: 'Arena', es: 'Arena' },
  1750: { en: 'Arena', es: 'Arena' },
}

export const QUEUE_FILTERS = [
  { id: 'solo', queues: [420], en: 'Solo/Duo', es: 'Solo/Dúo' },
  { id: 'flex', queues: [440], en: 'Flex', es: 'Flexible' },
  { id: 'draft', queues: [400], en: 'Draft', es: 'Draft' },
  { id: 'normal', queues: [430, 480, 490], en: 'Normals', es: 'Normales' },
  { id: 'aram', queues: [450, 2400], en: 'ARAM', es: 'ARAM' },
  { id: 'arena', queues: [1700, 1740, 1750], en: 'Arena', es: 'Arena' },
  { id: 'clash', queues: [700, 720, 900, 902, 904, 910], en: 'Clash', es: 'Clash' },
  { id: 'coop', queues: [820, 830, 840, 850], en: 'Co-op vs AI', es: 'Contra IA' },
  { id: 'custom', queues: [0], en: 'Custom', es: 'Personalizada' },
]

export function matchGroup(queue) {
  for (const g of QUEUE_FILTERS) {
    if (g.queues.includes(queue)) return g.id
  }
  return 'other'
}

export function queueLabel(lang, id) {
  const q = QUEUES[id]
  if (q) return q[lang] || q.en
  return lang === 'es' ? 'Partida' : 'Match'
}

export const MAPS = {
  1: "Summoner's Rift",
  2: "Summoner's Rift",
  3: 'The Proving Grounds',
  4: 'Twisted Treeline',
  8: 'Crystal Scar',
  10: 'Twisted Treeline',
  11: "Summoner's Rift",
  12: 'Howling Abyss',
  14: "Butcher's Bridge",
  21: 'Rift Quest',
  22: 'Valoran City Park',
  23: 'Convergence',
  30: 'Howling Abyss',
  31: 'Nexus Blitz',
  32: 'Nexus Blitz',
}

export function mapLabel(lang, id) {
  const m = MAPS[id]
  if (m) return m
  return lang === 'es' ? 'Mapa' : 'Map'
}

export function t(lang, key) {
  const dict = STR[lang] || STR.en
  return dict[key] || STR.en[key] || key
}
