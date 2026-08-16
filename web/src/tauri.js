export const isTauri = () =>
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

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
