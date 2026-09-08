import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n.js'
import { submitFeedback } from '../api.js'

const TOPICS = ['bug', 'request', 'other']

export default function FeedbackButton({ lang }) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('bug')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const close = () => {
    setOpen(false)
    setTimeout(() => {
      setStatus('idle')
      setMessage('')
    }, 250)
  }

  const send = async () => {
    if (status === 'sending' || !message.trim()) return
    setStatus('sending')
    try {
      await submitFeedback({ topic, message })
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="feedback-wrap" ref={ref}>
      <button
        className={`feedback-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        title={t(lang, 'feedback')}
        aria-label={t(lang, 'feedback')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 4H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h6l2 3 2-3h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
        </svg>
        <span className="feedback-btn-label">{t(lang, 'feedback')}</span>
      </button>

      {open && (
        <div className="feedback-pop" role="dialog" aria-modal="true">
          {status === 'sent' ? (
            <div className="feedback-body feedback-sent">
              <div className="feedback-check">✓</div>
              <h4>{t(lang, 'feedbackSent')}</h4>
              <p>{t(lang, 'feedbackSentDesc')}</p>
              <button className="feedback-primary" onClick={close}>{t(lang, 'close')}</button>
            </div>
          ) : (
            <div className="feedback-body">
              <h4>{t(lang, 'feedbackTitle')}</h4>
              <p className="feedback-sub">{t(lang, 'feedbackDesc')}</p>

              <label className="feedback-label" htmlFor="fb-topic">{t(lang, 'feedbackTopic')}</label>
              <div className="feedback-topic-row">
                {TOPICS.map((k) => (
                  <button
                    key={k}
                    className={`feedback-topic ${topic === k ? 'active' : ''}`}
                    onClick={() => setTopic(k)}
                  >
                    {t(lang, `feedbackTopic${k[0].toUpperCase()}${k.slice(1)}`)}
                  </button>
                ))}
              </div>

              <textarea
                className="feedback-textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t(lang, 'feedbackPlaceholder')}
                rows={4}
                maxLength={4000}
              />

              {status === 'error' && <p className="feedback-error">{t(lang, 'feedbackError')}</p>}

              <div className="feedback-actions">
                <button className="feedback-ghost" onClick={close}>{t(lang, 'cancel')}</button>
                <button
                  className="feedback-primary"
                  disabled={status === 'sending' || !message.trim()}
                  onClick={send}
                >
                  {status === 'sending' ? (
                    <><span className="feedback-spinner" /> {t(lang, 'feedbackSending')}</>
                  ) : (
                    t(lang, 'feedbackSend')
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
