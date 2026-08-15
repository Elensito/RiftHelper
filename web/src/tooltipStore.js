let current = null
let timer = null
const listeners = new Set()

export function showTooltip(payload) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    current = payload
    listeners.forEach((l) => l(current))
  }, 120)
}

export function hideTooltip() {
  clearTimeout(timer)
  current = null
  listeners.forEach((l) => l(current))
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
