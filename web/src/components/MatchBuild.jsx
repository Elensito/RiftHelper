import { useEffect, useState } from 'react'
import { fetchMatchBuild } from '../api.js'
import { t } from '../i18n.js'
import { TooltipTarget } from './Tooltip.jsx'

function teamColor(p, players) {
  const team = players.filter((x) => x.team === p.team)
  const i = team.findIndex((x) => x.participant_id === p.participant_id)
  const palette = p.team === 100
    ? ['#00e5ff', '#38bdf8', '#60a5fa', '#818cf8', '#22d3ee']
    : ['#ff2d78', '#fb7185', '#f97316', '#f43f5e', '#e879f9']
  return palette[i % palette.length]
}

function TeamTiles({ players, selected, onSelect, data }) {
  return (
    <div className="build-team-tiles">
      {players.map((p) => {
        const on = selected === p.participant_id
        return (
          <button
            key={p.participant_id}
            className={`champ-tile ${on ? 'active' : ''} ${p.is_player ? 'me' : ''}`}
            onClick={() => onSelect(p.participant_id)}
            style={on ? { '--tile': teamColor(p, data.players) } : null}
          >
            <img src={p.champion_icon} alt={p.champion} title={p.champion} draggable="false" />
            <span className="champ-tile-name">{p.champion}</span>
          </button>
        )
      })}
    </div>
  )
}

function SpellIcon({ spell, level, champ }) {
  const label = level ? `Lv ${level} · ${spell.name}` : spell.name
  return (
    <TooltipTarget
      as="div"
      kind="ability"
      id={spell.index}
      champ={champ}
      src={spell.icon}
      name={label}
      className="spell-cell-wrap"
    >
      <div className="spell-cell" title={label}>
        <img src={spell.icon} alt={spell.name} draggable="false" />
        <span className="spell-key">{spell.key}</span>
      </div>
    </TooltipTarget>
  )
}

export default function MatchBuild({ matchId, puuid, lang, players }) {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    setData(null)
    fetchMatchBuild(matchId)
      .then((d) => {
        if (cancelled) return
        setData(d)
        const me = players.find((p) => p.is_player)
        setSelected(me ? me.participant_id : players[0]?.participant_id)
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [matchId, players])

  if (error) return <div className="metrics-error">{error}</div>
  if (!data)
    return (
      <div className="metrics-loading">
        <div className="spinner" />
      </div>
    )

  const blue = players.filter((p) => p.team === 100)
  const red = players.filter((p) => p.team === 200)
  const me = players.find((p) => p.is_player)
  const pid = selected ?? me?.participant_id ?? players[0]?.participant_id
  const b = data.players.find((x) => x.participant_id === pid)
  const mp = players.find((x) => x.participant_id === pid)

  if (!b) return <div className="metrics-error">{t(lang, 'buildNotFound')}</div>

  const spells = b.spells
  const keyOf = (slot) => spells[slot - 1]
  const runes = mp?.runes || []
  const keystone = runes[0]
  const minor = runes.slice(1)

  return (
    <div className="build-wrap">
      <div className="metrics-teams">
        <TeamTiles players={blue} selected={pid} onSelect={setSelected} data={data} />
        <TeamTiles players={red} selected={pid} onSelect={setSelected} data={data} />
      </div>

      <div className="build-panel">
        <div className="build-champ">
          <img src={mp?.champion_icon} alt={mp?.champion} draggable="false" />
          <div>
            <h4>{mp?.champion}</h4>
            <span className="build-roles">
              {mp?.player_name}
              {mp?.player_tag ? `#${mp.player_tag}` : ''}
            </span>
          </div>
        </div>

        {spells.length > 0 && (
          <div className="build-section">
            <span className="build-label">{t(lang, 'buildSpells')}</span>
            <div className="spell-row">
              {spells.map((s) => (
                <SpellIcon key={s.key} spell={s} champ={b.champion_key} />
              ))}
            </div>
          </div>
        )}

        {b.skill_order.length > 0 && (
          <div className="build-section">
            <span className="build-label">{t(lang, 'buildSkillOrder')}</span>
            <div className="skill-order">
              {b.skill_order.map((slot, i) => {
                const spell = keyOf(slot)
                if (!spell) return null
                return <SpellIcon key={i} spell={spell} level={i + 2} champ={b.champion_key} />
              })}
            </div>
          </div>
        )}

        {keystone && (
          <div className="build-section">
            <span className="build-label">{t(lang, 'buildRunes')}</span>
            <div className="rune-row">
              <TooltipTarget
                as="div"
                kind="rune"
                id={keystone.id}
                lang={lang}
                src={keystone.src}
                name={keystone[lang] || keystone.en}
                className="rune-icon-wrap"
              >
                <div className="rune-icon rune-keystone">
                  <img src={keystone.src} alt={keystone.en} draggable="false" />
                </div>
              </TooltipTarget>
              <div className="rune-minor">
                {minor.map((r, i) =>
                  r ? (
                    <TooltipTarget
                      key={i}
                      as="div"
                      kind="rune"
                      id={r.id}
                      lang={lang}
                      src={r.src}
                      name={r[lang] || r.en}
                      className="rune-icon-wrap"
                    >
                      <div className="rune-icon">
                        <img src={r.src} alt={r.en} draggable="false" />
                      </div>
                    </TooltipTarget>
                  ) : null
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
