// src/utils/api.js
// Fetches an MSAL access token then calls the Azure Functions backend.

import { msalInstance, apiRequest } from '../authConfig'

// Simple client-side cache with TTL (45 seconds, same as backend)
const _cache = {}
const CACHE_TTL = 45 * 1000 // 45 seconds in milliseconds

function getCached(key) {
  const entry = _cache[key]
  if (!entry) return null
  const now = Date.now()
  if (entry.expiresAt <= now) {
    delete _cache[key]
    return null
  }
  return entry.value
}

function setCached(key, value) {
  _cache[key] = {
    value,
    expiresAt: Date.now() + CACHE_TTL,
  }
}

async function getToken() {
  const account = msalInstance.getActiveAccount()
  if (!account) throw new Error('No active account')
  try {
    const res = await msalInstance.acquireTokenSilent({ ...apiRequest, account })
    return res.accessToken
  } catch {
    const res = await msalInstance.acquireTokenPopup({ ...apiRequest, account })
    return res.accessToken
  }
}

async function apiFetch(path, options = {}, cacheKey = null) {
  // Check cache for GET requests
  if (!options.method || options.method === 'GET') {
    if (cacheKey) {
      const cached = getCached(cacheKey)
      if (cached) return cached
    }
  }

  const token = await getToken().catch(() => null)
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(path, { ...options, headers })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  const data = await res.json()

  // Cache GET responses
  if ((!options.method || options.method === 'GET') && cacheKey) {
    setCached(cacheKey, data)
  }

  return data
}

async function apiFetchBlob(path, options = {}) {
  const token = await getToken().catch(() => null)
  const headers = { ...(options.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(path, { ...options, headers })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.blob()
}


export const api = {
  getProjects:      ()           => apiFetch('/api/projects', {}, 'projects'),
  getWeeks:         (id)         => apiFetch(`/api/projects/${id}/weeks`, {}, `weeks:${id}`),
  getFiles:         (id, week)   => apiFetch(`/api/projects/${id}/weeks/${week}/files`, {}, `files:${id}:${week}`),
  getSasUrl:        (blobPath, minutes = 60) =>
    apiFetch('/api/sas/generate', { method: 'POST', body: JSON.stringify({ blobPath, expiryMinutes: minutes }) }),
  getThumbBlob:     (blobPath, width = 480, quality = 72) =>
    apiFetchBlob(`/api/thumb?blobPath=${encodeURIComponent(blobPath)}&w=${width}&q=${quality}`),
  createShare:      (projectId, week, expiryDays) =>
    apiFetch('/api/share/create', { method: 'POST', body: JSON.stringify({ projectId, week, expiryDays }) }),
  listShares:       ()           => apiFetch('/api/share/list'),
  revokeShare:      (token)      => apiFetch(`/api/share/${token}`, { method: 'DELETE' }),
  resolveShare:     (token)      => apiFetch(`/api/share/${token}`),
}

