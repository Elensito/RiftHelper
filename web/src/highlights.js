/* Automatic play highlights derived from a recorded match's local LCD events
   (the same `.events.json` used for the Rift timeline). Pure, frame-agnostic
   detection: we scan kill events where the local player was involved, group
   them into temporal "engagements", and classify the meaningful ones into a
   small set of highlight archetypes. Rules are deliberately strict and the
   per-VOD cap is low (3) so only real plays surface. */

/* Seconds of slack when grouping kill/assist/death events into one
   "engagement": events closer than this are considered part of the same play. */
const ENGAGEMENT_GAP_SEC = 22

/* Two-second lead-in before the first event of a play, and a tail after the
   last one, once converted to video seconds. */
const LEAD_SEC = 3
const TAIL_SEC = 2

function parseEventSec(ev) {
  const tm = typeof ev.time === 'string' ? ev.time.match(/(\d+)\s*:\s*(\d{1,2})/) : null
  if (tm) return Number(tm[1]) * 60 + Number(tm[2])
  const minute = Number(ev.minute)
  if (!Number.isNaN(minute)) return minute * 60
  return null
}

function isPlayer(name, me) {
  return !!name && !!me && String(name).toLowerCase() === String(me).toLowerCase()
}

/* Build a list of player-involved combat events in chronological order. */
function collectCombat(events, me) {
  if (!Array.isArray(events)) return []
  const out = []
  for (const ev of events) {
    if (!ev || ev.type !== 'kill') continue
    const sec = parseEventSec(ev)
    if (sec == null) continue
    const killerP = isPlayer(ev.killer?.name, me)
    const victimP = isPlayer(ev.victim?.name, me)
    const assists = (ev.assisters || []).filter(a => a && a.is_player)
    const assistP = assists.length > 0
    if (killerP || victimP || assistP) {
      out.push({
        sec,
        killerP,
        victimP,
        assistP,
        /* solo kill: the player got the kill with NO allies assisting */
        soloKill: killerP && !((ev.assisters || []).length > 0),
        champ: ev.killer?.name || '',
      })
    }
  }
  out.sort((a, b) => a.sec - b.sec)
  return out
}

/* Group combat events into engagements using the time gap. */
function groupEngagements(combat) {
  const groups = []
  let cur = null
  for (const c of combat) {
    if (!cur || c.sec - cur.lastSec > ENGAGEMENT_GAP_SEC) {
      if (cur) groups.push(cur.events)
      cur = { lastSec: c.sec, events: [] }
    }
    cur.lastSec = c.sec
    cur.events.push(c)
  }
  if (cur) groups.push(cur.events)
  return groups
}

/* Score a classified engagement; higher is a better highlight. */
function score(hl) {
  let s = hl.kills * 10 + hl.assists * 3
  if (hl.solo) s += 8
  if (!hl.died) s += 2
  if (hl.kills >= 3) s += 2
  return s
}

/* Translate an engagement into a highlight object, or null if it does not
   meet the (strict) play rules. */
function classifyGroup(events) {
  let kills = 0
  let assists = 0
  let deaths = 0
  let solo = true
  const firstSec = events[0].sec
  const lastSec = events[events.length - 1].sec

  for (const e of events) {
    if (e.killerP) { kills += 1; if (!e.soloKill) solo = false }
    if (e.assistP) assists += 1
    if (e.victimP) deaths += 1
  }
  const died = deaths > 0

  let kind = null
  if (!died && kills >= 2 && solo) kind = 'solo'            // 1v2+ kills, no assists, survives
  else if (!died && kills >= 2) kind = 'multi'              // multikill, no death
  else if (!died && assists >= 3 && kills >= 1) kind = 'assist-carry' // assist-heavy, no death
  else if (died && kills >= 2) kind = 'multi-die'           // multikill then died
  else if (died && kills >= 1 && assists >= 2) kind = 'trade-die' // involvement, then died
  if (!kind) return null

  return {
    kind,
    kills,
    assists,
    deaths,
    died,
    solo,
    firstSec,
    lastSec,
    score: 0, // filled by caller
  }
}

/* Compute the up-to-`max` best highlights from a VOD's local events.
   `me` is the local player's summoner name (case-insensitive).
   `gameTimeOffset` and `vodDurationSec` are used to map in-game seconds to
   video timestamps (the video starts at gameTimeOffset). */
export function computeHighlights(events, { me, gameTimeOffset = 0, vodDurationSec = 0, max = 3 } = {}) {
  const combat = collectCombat(events, me)
  const highlights = []
  for (const group of groupEngagements(combat)) {
    const hl = classifyGroup(group)
    if (!hl) continue
    hl.score = score(hl)
    highlights.push(hl)
  }
  highlights.sort((a, b) => b.score - a.score)
  const picked = highlights.slice(0, max)

  const offs = Number(gameTimeOffset) || 0
  return picked.map((hl) => ({
    ...hl,
    /* In-game seconds the play spans */
    startSec: hl.firstSec,
    endSec: hl.lastSec,
    /* Video player timestamps (video starts at gameTimeOffset) */
    startVideoSec: Math.max(0, hl.firstSec - LEAD_SEC - offs),
    endVideoSec: Math.max(0, hl.lastSec + TAIL_SEC - offs),
  }))
}

/* Per-language nouns used to build a highlight's display name, e.g.
   "2 kills con Smolder", "3 asistencias 1 kill con Leona". */
const HL_WORDS = {
  en: { killsFew: 'kills', killsOne: 'kill', assistFew: 'assists', assistOne: 'assist', dying: 'dying', with: 'with', solo: 'solo' },
  es: { killsFew: 'kills', killsOne: 'kill', assistFew: 'asistencias', assistOne: 'asistencia', dying: 'muriendo', with: 'con', solo: 'solo' },
  pt: { killsFew: 'kills', killsOne: 'kill', assistFew: 'assistências', assistOne: 'assistência', dying: 'morrendo', with: 'com', solo: 'solo' },
  fr: { killsFew: 'kills', killsOne: 'kill', assistFew: 'assists', assistOne: 'assist', dying: 'mourant', with: 'avec', solo: 'seul' },
  ko: { killsFew: '킬', killsOne: '킬', assistFew: '어시스트', assistOne: '어시스트', dying: '사망', with: '로', solo: '솔로' },
}

const noun = (lang, n, few, one) => (n === 1 ? one : few)

export function highlightLabel(hl, lang, champion) {
  const w = HL_WORDS[lang] || HL_WORDS.en
  const champ = champion || ''
  const c = champ ? ` ${w.with} ${champ}` : ''
  const dies = hl.died ? ` (${w.dying})` : ''
  let body
  if (hl.kind === 'assist-carry') {
    body = `${hl.assists} ${noun(lang, hl.assists, w.assistFew, w.assistOne)} ${hl.kills} ${noun(lang, hl.kills, w.killsFew, w.killsOne)}${c}`
  } else if (hl.solo) {
    body = `${hl.kills} ${noun(lang, hl.kills, w.killsFew, w.killsOne)} (${w.solo})${c}`
  } else if (hl.assists > 0) {
    body = `${hl.kills} ${noun(lang, hl.kills, w.killsFew, w.killsOne)} ${hl.assists} ${noun(lang, hl.assists, w.assistFew, w.assistOne)}${c}`
  } else {
    body = `${hl.kills} ${noun(lang, hl.kills, w.killsFew, w.killsOne)}${c}`
  }
  return `${body}${dies}`
}

/* Stable id for a highlight within a VOD (used to persist favorites/hidden). */
export function highlightId(vodId, hl) {
  return `${vodId}::${hl.firstSec}`
}
