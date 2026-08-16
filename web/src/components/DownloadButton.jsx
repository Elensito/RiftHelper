import { t } from '../i18n.js'

export default function DownloadButton({ lang }) {
  return (
    <a
      className="download-btn"
      href="/download"
      title={t(lang, 'downloadTitle')}
      aria-label={t(lang, 'downloadTitle')}
    >
      <svg
        className="download-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {t(lang, 'download')}
    </a>
  )
}
