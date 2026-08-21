let mediaRecorder = null
let recordedChunks = []
let stream = null

export async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true,
    })
    recordedChunks = []
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    mediaRecorder = new MediaRecorder(stream, { mimeType })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data)
    }
    mediaRecorder.start(1000)
    stream.getVideoTracks()[0].onended = () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop()
      }
    }
    return true
  } catch (err) {
    console.warn('Screen capture denied or unavailable:', err.message)
    mediaRecorder = null
    stream = null
    recordedChunks = []
    return false
  }
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      recordedChunks = []
      stream = null
      resolve(null)
      return
    }
    mediaRecorder.onstop = () => {
      const blob = recordedChunks.length > 0
        ? new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' })
        : null
      recordedChunks = []
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
        stream = null
      }
      mediaRecorder = null
      resolve(blob)
    }
    mediaRecorder.stop()
  })
}

export function isRecordingActive() {
  return mediaRecorder && mediaRecorder.state === 'recording'
}

const DB_NAME = 'rh-video-db'
const STORE_NAME = 'recordings'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveRecordingBlob(vodId, blob) {
  if (!blob) return
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).put(blob, vodId)
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function getRecordingBlob(vodId) {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const req = tx.objectStore(STORE_NAME).get(vodId)
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteRecordingBlob(vodId) {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).delete(vodId)
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function createVideoUrl(blob) {
  if (!blob) return null
  return URL.createObjectURL(blob)
}
