import { useState, useMemo, useRef, useEffect } from 'react'
import { t } from '../i18n.js'
import CHAMP_DATA from '../data/championCooldowns.json'

const DDG = CHAMP_DATA.version || '16.18.1'
const ICON_CDN = `https://ddragon.leagueoflegends.com/cdn/${DDG}`
const champIcon = (img) => `${ICON_CDN}/img/champion/${img}`
const spellIcon = (img) => `${ICON_CDN}/img/spell/${img}`
const passiveIcon = (img) => `${ICON_CDN}/img/passive/${img}`

const AH_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80]
const MAX_CHAMPS = 5
const ULT_HUNTER_STACKS = 5

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

function ModChip({ name, hint, checked, onChange, icon, accent }) {
  return (
    <button className={`cd-chip ${checked ? 'active' : ''}`} onClick={onChange} data-accent={accent}>
      <span className="cd-chip-check">{checked ? '✓' : ''}</span>
      <span className="cd-chip-icon">{icon}</span>
      <span className="cd-chip-txt">
        <b>{name}</b>
        <i>{hint}</i>
      </span>
    </button>
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

function ChampionCard({ champ, ah, ultAh, onRemove, canRemove, lang }) {
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
                        {fmt(cdAfter(base, ah, isUlt ? ultAh : 0))}
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
    </div>
  )
}

export default function Cooldowns({ lang }) {
  const [slots, setSlots] = useState([null, null])
  const [pickerFor, setPickerFor] = useState(null)
  const [ah, setAh] = useState(0)
  const [rune8, setRune8] = useState(false)
  const [codex, setCodex] = useState(false)
  const [malignance, setMalignance] = useState(false)
  const [hexplate, setHexplate] = useState(false)
  const [ultHunter, setUltHunter] = useState(ULT_HUNTER_STACKS)
  const [ultStacks, setUltStacks] = useState(1)

  const pickChamp = (slotIdx, id) => {
    setSlots((prev) => prev.map((c, i) => (i === slotIdx ? id : c)))
    setPickerFor(null)
  }

  const removeSlot = (slotIdx) => {
    setSlots((prev) => prev.filter((_, i) => i !== slotIdx))
  }

  const addSlot = () => {
    if (slots.length < MAX_CHAMPS) setSlots((prev) => [...prev, null])
  }

  const champs = useMemo(() =>
    slots.map((id) => (id ? (CHAMP_DATA.champions[id] || null) : null)),
  [slots])

  const baseAh = ah + (rune8 ? 8 : 0) + (codex ? 10 : 0) + (malignance ? 15 : 0)
  const ultAh = (ultHunter ? 6 + 5 * ultStacks : 0) + (malignance ? 20 : 0) + (hexplate ? 30 : 0)

  return (
    <div className="content cooldowns">
      <div className="cd-hero">
        <div className="cd-hero-title">
          <h1>{t(lang, 'navCooldownsTitle')}</h1>
          <p>{t(lang, 'cdSubtitle')}</p>
        </div>
        <div className="cd-hero-stats">
          <div className="cd-hero-stat">
            <span>{t(lang, 'cdAH')}</span>
            <b>{baseAh}</b>
          </div>
          <div className="cd-hero-stat">
            <span>{t(lang, 'cdUltHaste')}</span>
            <b>{ultAh}</b>
          </div>
        </div>
      </div>

      <div className="cd-panel">
        <div className="cd-panel-sec">
          <div className="cd-panel-label">
            <b>{t(lang, 'cdAH')}</b>
            <span className="cd-ah-current">{ah}</span>
          </div>
          <div className="cd-ah-steps">
            {AH_STEPS.map((v) => (
              <button key={v} className={`cd-ah-step ${ah === v ? 'active' : ''}`} onClick={() => setAh(v)}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="cd-panel-sec">
          <div className="cd-panel-label">
            <b>{t(lang, 'cdModifiers')}</b>
          </div>
          <div className="cd-chips">
            <ModChip
              name={t(lang, 'cdRune8Name')}
              hint={t(lang, 'cdRune8Hint')}
              checked={rune8}
              onChange={() => setRune8(!rune8)}
              icon="R"
            />
            <ModChip
              name={t(lang, 'cdCodexName')}
              hint={t(lang, 'cdCodexHint')}
              checked={codex}
              onChange={() => setCodex(!codex)}
              icon="C"
            />
            <ModChip
              name={t(lang, 'cdMalName')}
              hint={t(lang, 'cdMalHint')}
              checked={malignance}
              onChange={() => setMalignance(!malignance)}
              icon="M"
              accent="violet"
            />
            <ModChip
              name={t(lang, 'cdHexName')}
              hint={t(lang, 'cdHexHint')}
              checked={hexplate}
              onChange={() => setHexplate(!hexplate)}
              icon="H"
              accent="pink"
            />
            <ModChip
              name={t(lang, 'cdUHName')}
              hint={t(lang, 'cdUHHint')}
              checked={ultHunter}
              onChange={() => setUltHunter(!ultHunter)}
              icon="U"
              accent="green"
            />
          </div>
          {ultHunter && (
            <div className="cd-uh">
              <StackSelector value={ultStacks} onChange={setUltStacks} lang={lang} />
            </div>
          )}
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
                ah={baseAh}
                ultAh={ultAh}
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
        <span className="cd-foot-legend">
          <span className="cd-foot-dot ah" /> {t(lang, 'cdAH')}
          <span className="cd-foot-dot uh" /> {t(lang, 'cdUltHaste')}
        </span>
      </div>
    </div>
  )
}