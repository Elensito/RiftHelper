import { useState, useMemo, useRef, useEffect } from 'react'
import { t } from '../i18n.js'
import CHAMP_DATA from '../data/championCooldowns.json'

const DDG = CHAMP_DATA.version || '16.18.1'
const ITEM_CDN = `https://ddragon.leagueoflegends.com/cdn/${DDG}/img/item`
const PERK_CDN = 'https://ddragon.leagueoflegends.com/cdn/img/perk-images'
const champIcon = (img) => `https://ddragon.leagueoflegends.com/cdn/${DDG}/img/champion/${img}`
const spellIcon = (img) => `https://ddragon.leagueoflegends.com/cdn/${DDG}/img/spell/${img}`
const passiveIcon = (img) => `https://ddragon.leagueoflegends.com/cdn/${DDG}/img/passive/${img}`

const MOD_SRC = {
  shard: `${PERK_CDN}/StatMods/StatModsCDRScalingIcon.png`,
  codex: `${ITEM_CDN}/3108.png`,
  malignance: `${ITEM_CDN}/3118.png`,
  hexplate: `${ITEM_CDN}/3073.png`,
  uh: `${PERK_CDN}/Styles/Domination/UltimateHunter/UltimateHunter.png`,
}

const AH_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80]
const MAX_CHAMPS = 5

const defaultMods = () => ({
  ah: 0,
  rune8: false,
  codex: false,
  malignance: false,
  hexplate: false,
  ultHunter: false,
  ultStacks: 1,
})

/* League of Legends cooldown redn: final = base * 100 / (100 + haste).
   Ability haste applies to every spell. Ultimate haste stacks additively
   with ability haste but only affects the ultimate. */
const cdAfter = (base, ah, ultAh) => (base * 100) / (100 + ah + ultAh)

const fmt = (n) => {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function ChampionPicker({ onSelect, onClose, lang }) {
  const [q, setQ] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const list = useMemo(() => {
    const all = Object.values(CHAMP_DATA.champions)
    if (!q.trim()) return all
    const s = q.trim().toLowerCase()
    return all.filter((c) => c.name.toLowerCase().includes(s))
  }, [q])

  return (
    <div className="cd-picker" ref={ref}>
      <div className="cd-picker-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(lang, 'cdSearchChamp')}
        />
        <span className="cd-picker-count">{list.length}</span>
      </div>
      <div className="cd-picker-grid">
        {list.map((c) => (
          <button key={c.id} className="cd-pick" onClick={() => onSelect(c.id)}>
            <img src={champIcon(c.img)} alt="" loading="lazy" />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function StackSelector({ value, onChange, lang }) {
  return (
    <div className="cd-uh-stacks">
      <span>{t(lang, 'cdUHStacks')}</span>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={`cd-stack ${value === n ? 'active' : ''}`} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
      <span className="cd-uh-total">+{6 + 5 * value} {t(lang, 'cdUltHaste')}</span>
    </div>
  )
}

function ModChip({ src, name, hint, checked, onChange, accent }) {
  return (
    <button className={`cd-chip ${checked ? 'active' : ''}`} onClick={onChange} data-accent={accent}>
      <span className="cd-chip-check">{checked ? '✓' : ''}</span>
      <span className="cd-chip-icon">
        <img src={src} alt="" draggable="false" />
      </span>
      <span className="cd-chip-txt">
        <b>{name}</b>
        <i>{hint}</i>
      </span>
    </button>
  )
}

function Modifiers({ mod, onChange, lang }) {
  const set = (patch) => onChange({ ...mod, ...patch })
  return (
    <div className="cd-mod">
      <div className="cd-mod-label">{t(lang, 'cdModifiers')}</div>
      <div className="cd-ah-steps">
        {AH_STEPS.map((v) => (
          <button
            key={v}
            className={`cd-ah-step ${mod.ah === v ? 'active' : ''}`}
            onClick={() => set({ ah: v })}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="cd-chips">
        <ModChip
          src={MOD_SRC.shard}
          name={t(lang, 'cdRune8Name')}
          hint={t(lang, 'cdRune8Hint')}
          checked={mod.rune8}
          onChange={() => set({ rune8: !mod.rune8 })}
        />
        <ModChip
          src={MOD_SRC.codex}
          name={t(lang, 'cdCodexName')}
          hint={t(lang, 'cdCodexHint')}
          checked={mod.codex}
          onChange={() => set({ codex: !mod.codex })}
        />
        <ModChip
          src={MOD_SRC.malignance}
          name={t(lang, 'cdMalName')}
          hint={t(lang, 'cdMalHint')}
          checked={mod.malignance}
          onChange={() => set({ malignance: !mod.malignance })}
          accent="violet"
        />
        <ModChip
          src={MOD_SRC.hexplate}
          name={t(lang, 'cdHexName')}
          hint={t(lang, 'cdHexHint')}
          checked={mod.hexplate}
          onChange={() => set({ hexplate: !mod.hexplate })}
          accent="pink"
        />
        <ModChip
          src={MOD_SRC.uh}
          name={t(lang, 'cdUHName')}
          hint={t(lang, 'cdUHHint')}
          checked={mod.ultHunter}
          onChange={() => set({ ultHunter: !mod.ultHunter })}
          accent="green"
        />
      </div>
      {mod.ultHunter && (
        <div className="cd-uh">
          <StackSelector value={mod.ultStacks} onChange={(n) => set({ ultStacks: n })} lang={lang} />
        </div>
      )}
    </div>
  )
}

function ChampionCard({ champ, mod, onModChange, onRemove, canRemove, lang }) {
  const ah = mod.ah + (mod.rune8 ? 8 : 0) + (mod.codex ? 10 : 0) + (mod.malignance ? 15 : 0)
  const ultAh =
    (mod.ultHunter ? 6 + 5 * mod.ultStacks : 0) +
    (mod.malignance ? 20 : 0) +
    (mod.hexplate ? 30 : 0)

  return (
    <div className="cd-card">
      <div className="cd-card-head">
        <div className="cd-card-avatar-wrap">
          <img className="cd-card-avatar" src={champIcon(champ.img)} alt="" />
          <img
            className="cd-card-passive"
            src={passiveIcon(champ.passive.img)}
            alt=""
            title={champ.passive.name}
            loading="lazy"
            draggable="false"
          />
        </div>
        <div className="cd-card-title">
          <b>{champ.name}</b>
          <i>{champ.title}</i>
        </div>
        {canRemove && (
          <button className="cd-card-x" onClick={onRemove} title={t(lang, 'cdRemove')}>×</button>
        )}
      </div>

      <div className="cd-spells">
        {champ.spells.map((sp) => {
          const isUlt = sp.slot === 'R'
          return (
            <div className={`cd-spell ${isUlt ? 'ult' : ''}`} key={sp.slot}>
              <div className="cd-spell-id">
                <img src={spellIcon(sp.img)} alt={sp.slot} loading="lazy" />
                <b>{sp.slot}</b>
              </div>
              <div className="cd-spell-body">
                <div className="cd-spell-name">
                  <span>{sp.name}</span>
                  {isUlt && <span className="cd-ult-tag">{t(lang, 'cdUlt')}</span>}
                </div>
                <div className="cd-ranks">
                  {sp.cd.map((base, r) => (
                    <div className="cd-rank" key={r}>
                      <span className="cd-rank-lv">{r + 1}</span>
                      <span className="cd-rank-val">
                        {fmt(cdAfter(base, ah, isUlt ? ultAh : 0))}s
                      </span>
                      <span className="cd-rank-base">{fmt(base)}s</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <Modifiers mod={mod} onChange={onModChange} lang={lang} />
    </div>
  )
}

export default function Cooldowns({ lang }) {
  const [slots, setSlots] = useState([null, null])
  const [mods, setMods] = useState([defaultMods(), defaultMods()])
  const [pickerFor, setPickerFor] = useState(null)

  const pickChamp = (slotIdx, id) => {
    setSlots((prev) => prev.map((c, i) => (i === slotIdx ? id : c)))
    setPickerFor(null)
  }

  const removeSlot = (slotIdx) => {
    setSlots((prev) => prev.filter((_, i) => i !== slotIdx))
    setMods((prev) => prev.filter((_, i) => i !== slotIdx))
  }

  const addSlot = () => {
    if (slots.length < MAX_CHAMPS) {
      setSlots((prev) => [...prev, null])
      setMods((prev) => [...prev, defaultMods()])
    }
  }

  const champs = useMemo(() =>
    slots.map((id) => (id ? (CHAMP_DATA.champions[id] || null) : null)),
  [slots])

  return (
    <div className="content cooldowns">
      <div className="cd-hero">
        <div className="cd-hero-title">
          <h1>{t(lang, 'navCooldownsTitle')}</h1>
          <p>{t(lang, 'cdSubtitle')}</p>
        </div>
      </div>

      <div className="cd-slotbar">
        <span className="cd-slotbar-count">{slots.filter(Boolean).length}/{MAX_CHAMPS}</span>
        {slots.length < MAX_CHAMPS && (
          <button className="cd-add" onClick={addSlot}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t(lang, 'cdAddChamp')}
          </button>
        )}
      </div>

      <div className={`cd-grid cols-${Math.min(slots.length, 3)}`}>
        {champs.map((champ, i) => (
          <div className="cd-slot" key={i}>
            {champ ? (
              <ChampionCard
                champ={champ}
                mod={mods[i]}
                onModChange={(m) => setMods((prev) => prev.map((x, j) => (j === i ? m : x)))}
                onRemove={() => removeSlot(i)}
                canRemove={slots.length > 2}
                lang={lang}
              />
            ) : (
              <button className="cd-empty" onClick={() => setPickerFor(i)}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <b>{t(lang, 'cdPickChamp')}</b>
              </button>
            )}
            {pickerFor === i && (
              <ChampionPicker
                lang={lang}
                onSelect={(id) => pickChamp(i, id)}
                onClose={() => setPickerFor(null)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="cd-foot">
        <span className="cd-foot-data">{t(lang, 'cdDataFrom')} {DDG}</span>
      </div>
    </div>
  )
}