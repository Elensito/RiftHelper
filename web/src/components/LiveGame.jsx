import Img from './Img.jsx'
import { queueLabel, mapLabel, t } from '../i18n.js'

function fmtClock(sec) {
  sec = Math.max(0, sec || 0)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function nameOf(rune, lang) {
  if (!rune) return ''
  if (typeof rune === 'string') return rune
  return rune[lang] || rune.en || ''
}

function RuneStrip({ runes, lang }) {
  if (!runes || runes.length === 0) return null
  return (
    <div className="rune-strip">
      {runes.slice(0, 4).map((r, i) => (
        <Img key={`p${i}`} src={r && r.src} className="rune" title={nameOf(r, lang)} />
      ))}
      <span className="rune-sep" />
      {runes.slice(4, 6).map((r, i) => (
        <Img key={`s${i}`} src={r && r.src} className="rune" title={nameOf(r, lang)} />
      ))}
      <span className="rune-sep" />
      {runes.slice(6).map((r, i) => (
        <Img key={`t${i}`} src={r && r.src} className="rune shard" title={nameOf(r, lang)} />
      ))}
    </div>
  )
}

function LiveRow({ p, lang }) {
  return (
    <div className={`prow live-row ${p.is_player ? 'me' : ''}`}>
      <div className="prow-main">
        <div className="p-champ">
          <div className="p-champ-icon-wrap">
            <Img src={p.champion_icon} className="p-champ-icon" title={p.champion} />
          </div>
          <div className="p-champ-name">
            <span className="p-name" title={p.champion}>
              {p.champion}
            </span>
            <span className="p-role">
              {p.summoner_name}
              {p.summoner_tag ? <span className="p-tag">#{p.summoner_tag}</span> : null}
            </span>
          </div>
        </div>
        <div className="live-spells">
          {p.spells.map((s, i) => (
            <Img key={i} src={s && s.src} className="live-spell" title={s && nameOf(s, lang)} />
          ))}
        </div>
        {p.is_player && <span className="me-badge">{t(lang, 'you')}</span>}
      </div>
      <div className="prow-sub">
        <RuneStrip runes={p.runes} lang={lang} />
      </div>
    </div>
  )
}

export default function LiveGame({ data, lang }) {
  const game = data.game
  const [blue, red] = data.teams
  const blueBans = data.bans[100] || []
  const redBans = data.bans[200] || []

  return (
    <section className="live">
      <div className="live-head">
        <span className="live-badge">
          <span className="live-pulse" />
          {t(lang, 'liveNow')}
        </span>
        <span className="live-mode">{queueLabel(lang, game.queue)}</span>
        {game.map ? <span className="live-mode-sub">{mapLabel(lang, game.map)}</span> : null}
        {game.mode ? <span className="live-mode-sub">{game.mode}</span> : null}
        <span className="live-dur">{fmtClock(game.length_sec)}</span>
      </div>

      <div className="teams live-teams">
        <div className="team-col blue">
          <div className="team-header">
            <span className="team-dot" />
            {t(lang, 'blueTeam')}
            <span className="team-kda">{t(lang, 'liveBans')}: {blueBans.length}</span>
          </div>
          <div className="live-bans">
            {blueBans.map((b, i) => (
              <Img key={i} src={b.champion_icon} className="live-ban" title={b.champion} />
            ))}
            {blueBans.length === 0 && <span className="live-ban-empty">—</span>}
          </div>
          {blue.players.map((p, i) => (
            <LiveRow key={i} p={p} lang={lang} />
          ))}
        </div>

        <div className="team-col red">
          <div className="team-header">
            <span className="team-dot" />
            {t(lang, 'redTeam')}
            <span className="team-kda">{t(lang, 'liveBans')}: {redBans.length}</span>
          </div>
          <div className="live-bans">
            {redBans.map((b, i) => (
              <Img key={i} src={b.champion_icon} className="live-ban" title={b.champion} />
            ))}
            {redBans.length === 0 && <span className="live-ban-empty">—</span>}
          </div>
          {red.players.map((p, i) => (
            <LiveRow key={i} p={p} lang={lang} />
          ))}
        </div>
      </div>
    </section>
  )
}
