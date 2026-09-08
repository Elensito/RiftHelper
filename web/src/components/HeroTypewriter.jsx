import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n.js'

const FEATURE_KEYS = ['heroFeature1', 'heroFeature2', 'heroFeature3', 'heroFeature4', 'heroFeature5', 'heroFeature6']

export default function HeroTypewriter({ lang }) {
  const msgsRef = useRef(FEATURE_KEYS.map((k) => t(lang, k)))
  msgsRef.current = FEATURE_KEYS.map((k) => t(lang, k))

  const [msgIdx, setMsgIdx] = useState(0)
  const [len, setLen] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setMsgIdx(0)
    setLen(0)
    setDeleting(false)
  }, [lang])

  useEffect(() => {
    const msgs = msgsRef.current
    if (!msgs.length) return
    const current = msgs[msgIdx % msgs.length]
    let timer
    if (deleting) {
      if (len === 0) {
        timer = setTimeout(() => {
          setDeleting(false)
          setMsgIdx((i) => (i + 1) % msgs.length)
        }, 320)
      } else {
        timer = setTimeout(() => setLen((n) => n - 1), 24)
      }
    } else if (len < current.length) {
      timer = setTimeout(() => setLen((n) => n + 1), 42)
    } else {
      timer = setTimeout(() => setDeleting(true), 2000)
    }
    return () => clearTimeout(timer)
  }, [len, deleting, msgIdx, lang])

  const current = (msgsRef.current[msgIdx % msgsRef.current.length] || '').slice(0, len)

  return (
    <div className="hero-typewriter" aria-live="polite">
      <span className="hero-typewriter-text">{current}</span>
      <span className={`hero-typewriter-caret ${deleting ? 'off' : ''}`} aria-hidden="true" />
    </div>
  )
}