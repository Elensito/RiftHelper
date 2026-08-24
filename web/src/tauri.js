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

export async function selectVodFolder() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke('select_vod_folder')
  } catch {
    return null
  }
}

export async function getDefaultVodFolder() {
  if (!isTauri()) {
    return `${window.location.protocol}//${window.location.host}/recordings`
  }
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke('get_default_vod_folder')
  } catch {
    return ''
  }
}

export async function toggleAutostart(enabled) {
  if (!isTauri()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke('toggle_autostart', { enabled })
  } catch {
    return false
  }
}

export async function isAutostartEnabled() {
  if (!isTauri()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke('is_autostart_enabled')
  } catch {
    return false
  }
}

export async function getCloseBehavior() {
  if (!isTauri()) return 'tray'
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke('get_close_behavior')
  } catch {
    return 'tray'
  }
}

export async function setCloseBehavior(behavior) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('set_close_behavior', { behavior })
  } catch {}
}

export async function getFfmpegPath() {
  if (!isTauri()) return ''
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('get_ffmpeg_path') } catch { return '' }
}

export async function setFfmpegPath(path) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('set_ffmpeg_path', { path }) } catch {}
}

export async function getRecordingsFolder() {
  if (!isTauri()) return ''
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('get_recordings_folder') } catch { return '' }
}

export async function setRecordingsFolder(folder) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('set_recordings_folder', { folder }) } catch {}
}

export async function selectRecordingsFolder() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('select_recordings_folder') } catch { return null }
}

export async function selectFfmpegFile() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('select_ffmpeg_file') } catch { return null }
}

export async function testFfmpeg(path) {
  if (!isTauri()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('test_ffmpeg', { path }) } catch { return false }
}

export async function getAutoRecord() {
  if (!isTauri()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('get_auto_record') } catch { return false }
}

export async function setAutoRecord(enabled) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('set_auto_record', { enabled }) } catch {}
}

export async function startRecordingTauri() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('start_recording') } catch { return null }
}

export async function stopRecordingTauri() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('stop_recording') } catch { return null }
}

export async function isRecordingTauri() {
  if (!isTauri()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('is_recording') } catch { return false }
}

export async function isLolWindowOpen() {
  if (!isTauri()) return true
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('is_lol_window_open') } catch { return true }
}

export async function readVodEvents(videoPath) {
  if (!isTauri() || !videoPath) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('read_vod_events', { videoPath }) } catch { return null }
}

export async function getLastGameMode() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('get_last_game_mode') } catch { return null }
}

export async function vodThumbUrl(videoPath) {
  if (!isTauri() || !videoPath) return null
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
  try {
    const p = await invoke('get_vod_thumb', { videoPath })
    return p ? convertFileSrc(p) : null
  } catch { return null }
}

export async function showOverlay(lang) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('show_overlay', { lang }) } catch {}
}

export async function hideOverlay() {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('hide_overlay') } catch {}
}

export async function downloadFfmpeg() {
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('download_and_setup_ffmpeg') } catch { return null }
}

export async function onFfmpegProgress(callback) {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen('ffmpeg-download-progress', (event) => {
    callback(event.payload)
  })
  return unlisten
}

export async function openVodFolder(path) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('open_vod_folder', { path }) } catch {}
}

export async function showInFolder(path) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('show_in_folder', { path }) } catch {}
}

export async function deleteVodFiles(videoPath) {
  if (!isTauri() || !videoPath) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('delete_vod', { videoPath }) } catch {}
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

export async function getAudioMode() {
  if (!isTauri()) return 'game'
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('get_audio_mode') } catch { return 'game' }
}

export async function setAudioMode(mode) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('set_audio_mode', { mode }) } catch {}
}

export async function listAudioOutputs() {
  if (!isTauri()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('list_audio_output_devices') } catch { return [] }
}

export async function getAudioOutputDevice() {
  if (!isTauri()) return ''
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke('get_audio_output_device') } catch { return '' }
}

export async function setAudioOutputDevice(deviceId) {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  try { await invoke('set_audio_output_device', { deviceId }) } catch {}
}
