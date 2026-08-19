export const isTauri = () =>
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

let currentZoom = 1.0

export function initZoom() {
  if (!isTauri()) return
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return
    if (e.key === '=' || e.key === '+') {
      e.preventDefault()
      currentZoom = Math.min(2.0, currentZoom + 0.1)
      document.documentElement.style.zoom = String(currentZoom)
    } else if (e.key === '-') {
      e.preventDefault()
      currentZoom = Math.max(0.5, currentZoom - 0.1)
      document.documentElement.style.zoom = String(currentZoom)
    } else if (e.key === '0') {
      e.preventDefault()
      currentZoom = 1.0
      document.documentElement.style.zoom = '1'
    }
  })
}

export async function getRiotClientSession() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke('get_riot_client_session')
  } catch {
    return null
  }
}

export async function notifyGameEnded(summoner, lang = 'en') {
  const { t } = await import('./i18n.js')
  const title = 'RiftHelper'
  const who = summoner ? `${summoner.name}#${summoner.tag} · ` : ''
  const body = `${who}${t(lang, 'gameEnded')}`

  if (isTauri()) {
    const mod = await import('@tauri-apps/plugin-notification')
    let granted = await mod.isPermissionGranted()
    if (!granted) {
      const permission = await mod.requestPermission()
      granted = permission === 'granted'
    }
    if (granted) {
      mod.sendNotification({ title, body })
    }
    return
  }

  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
  if (Notification.permission === 'granted') {
    new Notification(title, { body })
  }
}
