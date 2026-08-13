import { useState } from 'react'

export default function Img({ src, alt, className, title }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className={`img-slot ${className || ''}`} title={title} />
  return (
    <img
      src={src}
      alt={alt || ''}
      title={title}
      className={className}
      draggable="false"
      onError={() => setFailed(true)}
    />
  )
}
