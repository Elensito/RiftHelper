const RECENT_KEY = 'rh:recent'
const FAV_KEY = 'rh:favorites'
const RECENT_LIMIT = 10

export function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch (e) {
    return []
  }
}

export function addRecent(name, tag) {
  if (!name || !tag) return
  const key = `${name.toLowerCase()}#${tag.toLowerCase()}`
  const list = getRecent().filter((r) => `${r.name.toLowerCase()}#${r.tag.toLowerCase()}` !== key)
  list.unshift({ name, tag })
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)))
}

export function clearRecent() {
  localStorage.removeItem(RECENT_KEY)
}

export function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || '[]')
  } catch (e) {
    return []
  }
}

export function isFavorite(name, tag) {
  const key = `${name.toLowerCase()}#${tag.toLowerCase()}`
  return getFavorites().some((f) => `${f.name.toLowerCase()}#${f.tag.toLowerCase()}` === key)
}

export function addFavorite(obj) {
  if (!obj || !obj.name || !obj.tag) return
  const key = `${obj.name.toLowerCase()}#${obj.tag.toLowerCase()}`
  const favs = getFavorites().filter((f) => `${f.name.toLowerCase()}#${f.tag.toLowerCase()}` !== key)
  favs.unshift(obj)
  localStorage.setItem(FAV_KEY, JSON.stringify(favs))
}

export function removeFavorite(name, tag) {
  const key = `${name.toLowerCase()}#${tag.toLowerCase()}`
  const favs = getFavorites().filter((f) => `${f.name.toLowerCase()}#${f.tag.toLowerCase()}` !== key)
  localStorage.setItem(FAV_KEY, JSON.stringify(favs))
}

export function clearFavorites() {
  localStorage.removeItem(FAV_KEY)
}

export default {
  getRecent,
  addRecent,
  clearRecent,
  getFavorites,
  isFavorite,
  addFavorite,
  removeFavorite,
  clearFavorites,
}
