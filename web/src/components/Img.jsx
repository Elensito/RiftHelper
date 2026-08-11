export default function Img({ src, alt, className, title }) {
  if (!src) return <span className={`img-slot ${className || ''}`} title={title} />
  return (
    <img
      src={src}
      alt={alt || ''}
      title={title}
      className={className}
      draggable="false"
      onError={(e) => {
        e.currentTarget.style.opacity = '0.15'
      }}
    />
  )
}
