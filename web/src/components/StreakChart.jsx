export default function StreakChart({ matches }) {
  if (!matches || matches.length < 2) return null

  const wins = matches.filter((m) => m.win).length
  const losses = matches.length - wins
  const positive = wins >= losses

  const w = 400
  const h = 36
  const pad = 4
  const step = (w - pad * 2) / (matches.length - 1)

  let y = h / 2
  const points = [`${pad},${y}`]

  for (let i = 0; i < matches.length; i++) {
    y += matches[i].win ? -6 : 6
    y = Math.max(pad + 4, Math.min(h - pad - 4, y))
    const x = pad + i * step
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }

  const pathD = 'M' + points.join(' L')
  const lastPoint = points[points.length - 1].split(',')
  const lastY = parseFloat(lastPoint[1])
  const midY = h / 2

  const gradId = 'sg-' + (positive ? 'pos' : 'neg')

  return (
    <div className="streak-wrap">
      <svg
        className="streak-svg"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={positive ? '#00e5ff' : '#ff1744'} stopOpacity="0.3" />
            <stop offset="100%" stopColor={positive ? '#00e5ff' : '#ff1744'} stopOpacity="1" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <line
          x1={pad}
          y1={midY}
          x2={w - pad}
          y2={midY}
          stroke={positive ? 'rgba(0,229,255,0.1)' : 'rgba(255,23,68,0.1)'}
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <path
          d={pathD}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="2.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
          filter="url(#glow)"
        />
        <circle
          cx={lastPoint[0]}
          cy={lastPoint[1]}
          r="3.5"
          fill={positive ? '#00e5ff' : '#ff1744'}
          filter="url(#glow)"
        />
      </svg>
      <span className={`streak-label ${positive ? 'positive' : 'negative'}`}>
        {wins}W {losses}L
      </span>
    </div>
  )
}
