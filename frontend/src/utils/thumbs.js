// src/utils/thumbs.js
// Caché de miniaturas autenticadas (blobPath -> Promise<objectURL>) con
// concurrencia limitada para no saturar el endpoint /api/thumb.
import { api } from './api'

const cache = new Map()
let active = 0
const queue = []
const MAX_CONCURRENT = 4

export function fetchThumb(path, { w = 480, q = 70, mode = '' } = {}) {
  const key = `${path}|${w}|${q}|${mode}`
  if (cache.has(key)) return cache.get(key)
  const promise = new Promise((resolve, reject) => {
    const run = () => {
      active++
      api.getThumbBlob(path, w, q, mode)
        .then(blob => resolve(URL.createObjectURL(blob)))
        .catch(reject)
        .finally(() => {
          active--
          const next = queue.shift()
          if (next) next()
        })
    }
    if (active < MAX_CONCURRENT) run()
    else queue.push(run)
  })
  cache.set(key, promise)
  return promise
}
