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

function clearCachedByPrefixes(prefixes = []) {
  Object.keys(_cache).forEach((key) => {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      delete _cache[key]
    }
  })
}

async function getToken() {
  // Bypass SOLO en desarrollo para las capturas/preview (dev-preview): sin cuenta
  // MSAL devuelve un token ficticio y las APIs quedan mockeadas por Playwright.
  // En el build de producción import.meta.env.DEV es false, así que no aplica.
  if (import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('ripcon-dev-preview') === '1') {
    return 'dev-preview-token'
  }
  const account = msalInstance.getActiveAccount()
  if (!account) throw new Error('No active account')
  try {
    const res = await msalInstance.acquireTokenSilent({ ...apiRequest, account })
    return res.accessToken
  } catch (silentError) {
    try {
      const res = await msalInstance.acquireTokenPopup({ ...apiRequest, account })
      return res.accessToken
    } catch (popupError) {
      throw popupError || silentError
    }
  }
}

// El backend responde {"error": "..."} en los fallos. Sin esto el usuario solo
// veía "→ 500" y se perdía la causa real (p. ej. "Faltan credenciales Graph").
async function throwApiError(res, path) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.error || ''
  } catch { /* respuesta sin JSON */ }
  throw new Error(detail ? `${detail} (${res.status})` : `API ${path} → ${res.status}`)
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
  if (!token) {
    throw new Error(`API ${path} → no access token available`)
  }
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  headers['X-Access-Token'] = token
  const res = await fetch(path, { ...options, headers })
  if (!res.ok) await throwApiError(res, path)
  const data = await res.json()

  // Cache GET responses
  if ((!options.method || options.method === 'GET') && cacheKey) {
    setCached(cacheKey, data)
  }

  return data
}

async function apiFetchBlob(path, options = {}) {
  const token = await getToken().catch(() => null)
  if (!token) {
    throw new Error(`API ${path} → no access token available`)
  }
  const headers = { ...(options.headers || {}) }
  headers['X-Access-Token'] = token
  const res = await fetch(path, { ...options, headers })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.blob()
}

export const api = {
  getMe:            ()           => apiFetch('/api/me'),
  getAccessConfig:  ()           => apiFetch('/api/access'),
  saveAccessConfig: (config)     => apiFetch('/api/access', { method: 'POST', body: JSON.stringify(config) }),
  getProjects:      ()           => apiFetch('/api/projects', {}, 'projects'),
  getWeeks:         (id)         => apiFetch(`/api/projects/${id}/weeks`, {}, `weeks:${id}`),
  getBrowse:        (id, path = '') => {
    const encodedPath = encodeURIComponent(path)
    return apiFetch(`/api/projects/${id}/browse?path=${encodedPath}`, {}, `browse:${id}:${path}`)
  },
  getFiles:         (id, week)   => {
    const encodedWeek = encodeURIComponent(week)
    return apiFetch(`/api/projects/${id}/weeks/${encodedWeek}/files`, {}, `files:${id}:${week}`)
  },
  refreshIndex:     async ()     => {
    const result = await apiFetch('/api/index/refresh', { method: 'POST' })
    clearCachedByPrefixes(['projects', 'weeks:', 'files:'])
    return result
  },
  getSasUrl:        (blobPath, minutes = 60) =>
    apiFetch('/api/sas/generate', { method: 'POST', body: JSON.stringify({ blobPath, expiryMinutes: minutes }) }),
  getThumbBlob:     (blobPath, width = 480, quality = 72, mode = '') =>
    apiFetchBlob(`/api/thumb?blobPath=${encodeURIComponent(blobPath)}&w=${width}&q=${quality}${mode ? `&mode=${mode}` : ''}`),

  // ── Biblioteca de media (_media/<seccion>/<a>/<b>/…) — carpetas anidadas ──
  // La ruta de carpeta viaja por query/body, no en el path, para no pelear con
  // el encoding de "/" y los espacios.
  getMediaPath:     (section, path = '') =>
    apiFetch(`/api/media/${section}?path=${encodeURIComponent(path)}`),
  // Todas las rutas de carpeta de la sección, en plano (para selectores).
  getMediaTree:     (section) => apiFetch(`/api/media/${section}?tree=1`),
  // Carpetas de la raíz de la sección.
  listMediaFolders: (section) => apiFetch(`/api/media/${section}`),
  createMediaFolder:(section, name, parentPath = '') =>
    apiFetch(`/api/media/${section}`, { method: 'POST', body: JSON.stringify({ name, parentPath }) }),
  // Plan de subida directa navegador→blob para biblioteca (SAS por archivo).
  // (Antes había uploadMediaFiles multipart, pero chocaba con el límite de
  // tamaño de la Function → 413; ahora TODO va directo al blob.)
  postMediaUploadPlan: (section, folderPath, files) =>
    apiFetch(`/api/media/${section}/plan`, { method: 'POST', body: JSON.stringify({ folderPath, files }) }),
  // Ficha opcional de una carpeta (descripción, colores, arquetipo).
  saveMediaMeta: (section, folderPath, meta) =>
    apiFetch(`/api/media/${section}/meta`, { method: 'POST', body: JSON.stringify({ folderPath, meta }) }),
  // Enlaces de una sección (Redes Sociales): lista de links, no carpetas.
  getSectionLinks:  (section) => apiFetch(`/api/media/${section}/links`),
  saveSectionLinks: (section, links) =>
    apiFetch(`/api/media/${section}/links`, { method: 'POST', body: JSON.stringify({ links }) }),
  createShare:      (projectId, week, expiryDays) =>
    apiFetch('/api/share/create', { method: 'POST', body: JSON.stringify({ projectId, week, expiryDays }) }),
  listShares:       ()           => apiFetch('/api/share/list'),
  revokeShare:      (token)      => apiFetch(`/api/share/${token}`, { method: 'DELETE' }),
  resolveShare:     (token)      => apiFetch(`/api/share/${token}`),
  postUpload:       (payload)    => apiFetch('/api/upload', { method: 'POST', body: JSON.stringify(payload) }),
  postUploadLocalPlan: (payload) => apiFetch('/api/upload/local/plan', { method: 'POST', body: JSON.stringify(payload) }),
  postRemotePlan:   (payload)    => apiFetch('/api/upload/remote/plan', { method: 'POST', body: JSON.stringify(payload) }),
  postRemoteBatch:  (payload)    => apiFetch('/api/upload/remote/batch', { method: 'POST', body: JSON.stringify(payload) }),
  // Biblioteca (media) desde SharePoint/OneDrive: conserva nombres y estructura.
  postRemoteMediaPlan:  (payload) => apiFetch('/api/upload/remote/media/plan', { method: 'POST', body: JSON.stringify(payload) }),
  postRemoteMediaBatch: (payload) => apiFetch('/api/upload/remote/media/batch', { method: 'POST', body: JSON.stringify(payload) }),
  // Estado de las copias servidor-a-servidor (para la barra de progreso).
  postRemoteCopyStatus: (payload) => apiFetch('/api/upload/remote/copy-status', { method: 'POST', body: JSON.stringify(payload) }),
  // Análisis reanudable de carpetas enormes (no choca con el timeout/throttling).
  postRemoteList:    (payload) => apiFetch('/api/upload/remote/list', { method: 'POST', body: JSON.stringify(payload) }),
  postRemotePrepare: (payload) => apiFetch('/api/upload/remote/prepare', { method: 'POST', body: JSON.stringify(payload) }),
  postUploadCheck:  (payload)    => apiFetch('/api/upload/check', { method: 'POST', body: JSON.stringify(payload) }),
  getUploadStatus:  (jobId)      => apiFetch(`/api/upload/status/${jobId}`),
  getProjectSettings:   (projectCode) =>
    apiFetch(`/api/projects/${encodeURIComponent(projectCode)}/settings`),
  saveProjectSettings:  (projectCode, settings) =>
    apiFetch(`/api/projects/${encodeURIComponent(projectCode)}/settings`, { method: 'POST', body: JSON.stringify(settings) }),

  // ── Nuevos: SharePoint / OneDrive ─────────────────────────────────────────
  // Resuelve una URL de carpeta SharePoint a { site_id, folder_path, site_name, ... }
  // sin iniciar ninguna subida. Útil para validar antes de lanzar el job.
  resolveSharepointUrl: (url) =>
    apiFetch('/api/upload/resolve-sharepoint', { method: 'POST', body: JSON.stringify({ url }) }),

  // Inicia una subida desde una carpeta SharePoint.
  // payload: { projectCode, projectName, sharepointUrl?, siteId?, folderPath?,
  //            prefijo?, maxWorkers?, refreshIndex?, recursive? }
  postUploadSharepoint: (payload) =>
    apiFetch('/api/upload/sharepoint', { method: 'POST', body: JSON.stringify(payload) }),

  // Inicia una subida desde OneDrive de un usuario.
  // payload: { projectCode, projectName, userEmail, folderPath,
  //            prefijo?, maxWorkers?, refreshIndex?, recursive? }
  postUploadOnedrive: (payload) =>
    apiFetch('/api/upload/onedrive', { method: 'POST', body: JSON.stringify(payload) }),
}