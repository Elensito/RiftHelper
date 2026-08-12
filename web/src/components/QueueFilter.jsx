import { QUEUE_FILTERS, matchGroup, t } from '../i18n.js'

export default function QueueFilter({ matches, filter, onChange, lang }) {
  const counts = {}
  const present = new Set()
  matches.forEach((m) => {
    const g = matchGroup(m.queue)
    counts[g] = (counts[g] || 0) + 1
    present.add(g)
  })
  const groups = QUEUE_FILTERS
  const showOther = present.has('other')

  return (
    <div className="queue-filter">
      <button
        className={`q-btn ${filter === 'all' ? 'active' : ''}`}
        onClick={() => onChange('all')}
      >
        {t(lang, 'filterAll')}
        <span className="q-count">{matches.length}</span>
      </button>
      {groups.map((g) => (
        <button
          key={g.id}
          className={`q-btn ${filter === g.id ? 'active' : ''}`}
          onClick={() => onChange(g.id)}
        >
          {g[lang] || g.en}
          <span className="q-count">{counts[g.id] || 0}</span>
        </button>
      ))}
      {showOther && (
        <button
          className={`q-btn ${filter === 'other' ? 'active' : ''}`}
          onClick={() => onChange('other')}
        >
          {t(lang, 'filterOther')}
          <span className="q-count">{counts.other}</span>
        </button>
      )}
    </div>
  )
}
