// src/pages/GalleryPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../utils/api'
import { fetchThumb } from '../utils/thumbs'
import { useFavorites } from '../utils/favorites'
import Modal from '../components/Modal'

// Corazón (relleno = ya es favorito)
function HeartIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  )
}

const PREFIX_BADGE = {
  DRN: 'badge-orange', FOT: 'badge-blue', VID: 'badge-red',
  E360: 'badge-accent', I360: 'badge-dim',
}
const IMG_EXTS  = ['jpg','jpeg','png','tiff','tif','webp']
const VID_EXTS  = ['mp4','mov','avi']
const RAW_EXTS  = ['dng','cr3','arw','raw','nef']
const I360_EXTS = ['insv']

function extOf(name) { return name.split('.').pop().toLowerCase() }
function prefixOf(name) { return name.split('_')[0].toUpperCase() }
function isImg(name)  { return IMG_EXTS.includes(extOf(name)) }
function isVid(name)  { return VID_EXTS.includes(extOf(name)) }
function isRaw(name)  { return RAW_EXTS.includes(extOf(name)) }
function isI360(name) { return I360_EXTS.includes(extOf(name)) }
function kindOf(name) {
  if (isImg(name)) return 'img'
  if (isVid(name)) return 'vid'
  if (isRaw(name)) return 'raw'
  if (isI360(name)) return 'i360'
  return 'file'
}
function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return 'No disponible'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
function formatDate(isoDate) {
  if (!isoDate) return 'No disponible'
  const dt = new Date(isoDate)
  if (Number.isNaN(dt.getTime())) return 'No disponible'
  return dt.toLocaleString('es-CL')
}
function orientationOf(width, height) {
  if (!width || !height) return 'No disponible'
  if (width === height) return 'Cuadrada'
  return width > height ? 'Horizontal' : 'Vertical'
}
function aspectRatioOf(width, height) {
  if (!width || !height) return 'No disponible'
  const ratio = (width / height).toFixed(2)
  return `${ratio}:1`
}

function sizeBucketOf(bytes) {
  const size = Number(bytes || 0)
  if (size < 1024 * 1024) return 'small' // < 1 MB
  if (size < 10 * 1024 * 1024) return 'medium' // 1 MB - 9.99 MB
  return 'large' // >= 10 MB
}

function readImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('No se pudo leer metadata de la imagen'))
    img.src = url
  })
}

function readVideoDimensions(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight })
    video.onerror = () => reject(new Error('No se pudo leer metadata del video'))
    video.src = url
  })
}

async function downloadAsFile(url, filename) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('No se pudo descargar el archivo')
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export default function GalleryPage() {
  const { id, week } = useParams()
  const nav = useNavigate()
  const [browse, setBrowse] = useState({ folders: [], files: [] })
  const [sasCache, setSasCache] = useState({})
  const [thumbCache, setThumbCache] = useState({})
  const closeTimerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sizeFilter, setSizeFilter] = useState('all')
  const [viewer, setViewer] = useState(null)  // { idx, url, file, kind, width, height, metaLoading }
  const [previewOpen, setPreviewOpen] = useState(false)
  const [fullscreenViewer, setFullscreenViewer] = useState(null)
  const [shareLink, setShareLink] = useState(null)
  const [sharingDays, setSharingDays] = useState(7)
  const [showSharePanel, setShowSharePanel] = useState(false)
  const [copied, setCopied] = useState(false)
  const viewerRequestIdRef = useRef(0)
  const lightboxRef = useRef(null)
  const weekLabel = (week || '').split('/').join(' / ')
  const lightboxOpen = Boolean(fullscreenViewer)

  const { isFav, collections, createCollection, addToCollection, removeFromAll } = useFavorites()
  const [favTarget, setFavTarget] = useState(null)   // archivo a agregar a una colección
  const [newColName, setNewColName] = useState('')
  const [favBusy, setFavBusy] = useState(false)

  const onHeart = useCallback((file) => {
    if (isFav(file.path)) { removeFromAll(file.path).catch(() => {}); return }
    setNewColName(''); setFavTarget(file)
  }, [isFav, removeFromAll])

  const addTargetTo = async (collectionId) => {
    if (!favTarget) return
    setFavBusy(true)
    try {
      await addToCollection(collectionId, {
        path: favTarget.path, name: favTarget.name,
        projectCode: id, projectName: id, week: week || '',
      })
      setFavTarget(null)
    } catch {} finally { setFavBusy(false) }
  }

  const createAndAdd = async () => {
    const name = newColName.trim()
    if (!name) return
    setFavBusy(true)
    try {
      const col = await createCollection(name)
      if (col) await addTargetTo(col.id)
    } catch {} finally { setFavBusy(false) }
  }

  // Accesibilidad del lightbox: foco inicial dentro, Tab no escapa,
  // y al cerrar el foco vuelve a donde estaba.
  useEffect(() => {
    if (!lightboxOpen || !lightboxRef.current) return
    const node = lightboxRef.current
    const previouslyFocused = document.activeElement
    const focusables = () => node.querySelectorAll('button, a[href], video')
    focusables()[0]?.focus()
    const onKey = (e) => {
      if (e.key !== 'Tab') return
      const els = Array.from(focusables())
      if (!els.length) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [lightboxOpen])

  useEffect(() => {
    setLoading(true)
    setBrowse({ folders: [], files: [] })
    setLoadError(null)
    setViewer(null)
    setPreviewOpen(false)

    api.getBrowse(id, week || '')
      .then(setBrowse)
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [id, week])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
      }
      // Las miniaturas viven en la caché compartida (utils/thumbs): no se
      // revocan al salir, así volver a esta semana es instantáneo.
    }
  }, [])

  const getSas = useCallback(async (blobPath, minutes = 60) => {
    if (sasCache[blobPath]) return sasCache[blobPath]
    const res = await api.getSasUrl(blobPath, minutes)
    setSasCache(c => ({ ...c, [blobPath]: res.sasUrl }))
    return res.sasUrl
  }, [sasCache])

  const openViewer = async (file, idx) => {
    const requestId = viewerRequestIdRef.current + 1
    viewerRequestIdRef.current = requestId
    const kind = kindOf(file.name)
    const requiresUrl = kind === 'img' || kind === 'vid'
    setFullscreenViewer(null)
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setViewer({ idx, url: null, file, kind, width: null, height: null, metaLoading: requiresUrl, urlLoading: requiresUrl })
    setPreviewOpen(true)

    if (!requiresUrl) return

    let url = null
    try {
      url = await getSas(file.path)
      if (viewerRequestIdRef.current !== requestId) return
      setViewer((curr) => {
        if (!curr || curr.file?.path !== file.path) return curr
        return { ...curr, url, urlLoading: false }
      })
    } catch {
      if (viewerRequestIdRef.current !== requestId) return
      setViewer((curr) => {
        if (!curr || curr.file?.path !== file.path) return curr
        return { ...curr, urlLoading: false, metaLoading: false }
      })
      return
    }

    try {
      const meta = kind === 'img' ? await readImageDimensions(url) : await readVideoDimensions(url)
      setViewer((curr) => {
        if (!curr || curr.url !== url) return curr
        return { ...curr, ...meta, metaLoading: false }
      })
    } catch {
      setViewer((curr) => {
        if (!curr || curr.url !== url) return curr
        return { ...curr, metaLoading: false }
      })
    }
  }

  const openItem = async (file, idx) => {
    await openViewer(file, idx)
  }

  const navViewer = async (dir) => {
    const curIdx = displayFiles.findIndex(f => f.name === viewer?.file?.name)
    const next = displayFiles[(curIdx + dir + displayFiles.length) % displayFiles.length]
    if (!next) return
    const realIdx = displayFiles.indexOf(next)
    await openViewer(next, realIdx)
  }

  const closeViewer = () => {
    setFullscreenViewer(null)
    setPreviewOpen(false)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setViewer(null)
      closeTimerRef.current = null
    }, 180)
  }

  const download = async (file) => {
    const url = await getSas(file.path, 15)
    try {
      await downloadAsFile(url, file.name)
    } catch {
      window.location.href = url
    }
  }

  const generateShare = async () => {
    try {
      const res = await api.createShare(id, week, sharingDays)
      setShareLink(`${window.location.origin}/share/${res.token}`)
    } catch {}
  }

  const copyLink = () => {
    if (!shareLink) return
    navigator.clipboard.writeText(shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const files = browse.files || []
  const folders = browse.folders || []
  const showFoldersOnly = folders.length > 0
  const prefixes = [...new Set(files.map(f => prefixOf(f.name)))].filter(Boolean)
  const formatFilteredFiles = filter === 'all' ? files : files.filter(f => prefixOf(f.name) === filter)
  const displayFiles = sizeFilter === 'all'
    ? formatFilteredFiles
    : formatFilteredFiles.filter(f => sizeBucketOf(f.size) === sizeFilter)

  const sizeCounts = {
    small: files.filter(f => sizeBucketOf(f.size) === 'small').length,
    medium: files.filter(f => sizeBucketOf(f.size) === 'medium').length,
    large: files.filter(f => sizeBucketOf(f.size) === 'large').length,
  }

  const counts = {
    img: files.filter(f => isImg(f.name)).length,
    vid: files.filter(f => isVid(f.name)).length,
    raw: files.filter(f => isRaw(f.name)).length,
  }

  // Keyboard nav for lightbox
  useEffect(() => {
    const handler = (e) => {
      if (!viewer) return
      if (e.key === 'ArrowRight') navViewer(1)
      if (e.key === 'ArrowLeft')  navViewer(-1)
      if (e.key === 'Escape')     closeViewer()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [viewer, displayFiles])

  useEffect(() => {
    const handler = (e) => {
      if (!fullscreenViewer) return
      if (e.key === 'Escape') setFullscreenViewer(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreenViewer])

  return (
    <>
      <div className="breadcrumb">
        <Link to="/proyectos">Proyectos</Link>
        <span className="sep">›</span>
        <Link to={`/proyectos/project/${id}`}>{id}</Link>
        <span className="sep">›</span>
        <span className="current">{weekLabel}</span>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title project-code-title" style={{ fontSize: '1.2rem' }}>
            {id} <span>/ {weekLabel}</span>
          </h1>
          <p className="page-sub">
            {folders.length} carpetas · {files.length} archivos · {counts.img} imágenes · {counts.vid} videos · {counts.raw} RAW
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSharePanel(s => !s)}>
          Compartir semana
        </button>
      </div>

      {/* Share panel */}
      {showSharePanel && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: '10px', fontSize: '0.9rem' }}>
            Generar enlace externo (sin login)
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Expira en:</span>
            {[7, 14, 30].map(d => (
              <button key={d} className={`filter-chip ${sharingDays === d ? 'active' : ''}`}
                onClick={() => setSharingDays(d)}>{d} días</button>
            ))}
            <button className="btn btn-primary btn-sm" onClick={generateShare}>Generar link</button>
          </div>
          {shareLink && (
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg3)', padding: '10px 12px', borderRadius: 'var(--radius)', flexWrap: 'wrap' }}>
              <code style={{ flex: 1, fontSize: '0.75rem', wordBreak: 'break-all' }}>{shareLink}</code>
              <button className="btn btn-primary btn-sm" onClick={copyLink}>
                {copied ? 'Copiado ✓' : 'Copiar'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading && <div className="loading"><div className="spinner"/></div>}
      {!loading && loadError && (
        <div className="alert alert-error" role="alert">No se pudo cargar: {loadError}</div>
      )}

      {!loading && !loadError && (
        <div className={`gallery-split ${viewer ? 'has-preview' : 'no-preview'}`}>
          <div className="gallery-main">
            {folders.length > 0 && (
              <div className="week-list">
                {folders.map((folder) => (
                  <div
                    key={folder.path}
                    className="week-row"
                    onClick={() => nav(`/proyectos/project/${id}/week/${encodeURIComponent(folder.path)}`)}
                  >
                    <div className="week-label">{folder.name}</div>
                    <div className="week-badges">
                      {(folder.types || []).map((t) => (
                        <span key={t} className={`badge ${PREFIX_BADGE[t] || 'badge-dim'}`}>
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="week-count">{folder.count} archivos</div>
                    <div className="week-arrow">›</div>
                  </div>
                ))}
              </div>
            )}

            {!showFoldersOnly && (
              <>
                {/* Filters */}
                <div className="gallery-toolbar">
                  <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
                    Todos ({files.length})
                  </button>
                  {prefixes.map(p => (
                    <button key={p} className={`filter-chip ${filter === p ? 'active' : ''}`} onClick={() => setFilter(p)}>
                      {p} ({files.filter(f => prefixOf(f.name) === p).length})
                    </button>
                  ))}
                </div>

                <div className="gallery-toolbar" style={{ marginTop: 8 }}>
                  <button className={`filter-chip ${sizeFilter === 'all' ? 'active' : ''}`} onClick={() => setSizeFilter('all')}>
                    Cualquier tamaño ({files.length})
                  </button>
                  <button className={`filter-chip ${sizeFilter === 'small' ? 'active' : ''}`} onClick={() => setSizeFilter('small')}>
                    Pequeño ({sizeCounts.small})
                  </button>
                  <button className={`filter-chip ${sizeFilter === 'medium' ? 'active' : ''}`} onClick={() => setSizeFilter('medium')}>
                    Mediano ({sizeCounts.medium})
                  </button>
                  <button className={`filter-chip ${sizeFilter === 'large' ? 'active' : ''}`} onClick={() => setSizeFilter('large')}>
                    Grande ({sizeCounts.large})
                  </button>
                </div>

                <div className="gallery-grid">
                  {displayFiles.map((file, idx) => (
                    <GalleryItem
                      key={file.path || file.name}
                      file={file}
                      thumbUrl={thumbCache[file.path] || null}
                      onThumbLoaded={(url) => {
                        setThumbCache((c) => (c[file.path] ? c : { ...c, [file.path]: url }))
                      }}
                      getSas={getSas}
                      onClick={() => openItem(file, idx)}
                      active={viewer?.file?.name === file.name}
                      fav={isFav(file.path)}
                      onFav={() => onHeart(file)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {viewer && (
            <aside className={`gallery-preview ${previewOpen ? 'open' : 'closing'}`}>
              <div className="gallery-preview-header">
                <div className="gallery-preview-titleWrap">
                  <div className="gallery-preview-title">{viewer.file?.name || 'Sin nombre'}</div>
                  <div className="gallery-preview-subtitle">Vista previa dentro de la página</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeViewer}>Cerrar</button>
              </div>

              <div className="gallery-preview-media" onClick={() => viewer.kind === 'img' && setFullscreenViewer(viewer)}>
                {viewer.urlLoading && (
                  <div className="gallery-preview-empty">
                    <div className="spinner" />
                    <div className="gallery-preview-emptyTitle">Preparando vista previa</div>
                    <div className="gallery-preview-emptyText">El panel ya está abierto; cargando el archivo...</div>
                  </div>
                )}

                {!viewer.urlLoading && viewer.kind === 'img' && viewer.url && (
                  <img className="gallery-preview-img" src={viewer.url} alt={viewer.file?.name || 'preview'} />
                )}

                {!viewer.urlLoading && viewer.kind === 'vid' && viewer.url && (
                  <video className="gallery-preview-video" controls autoPlay src={viewer.url}>Tu navegador no soporta video.</video>
                )}

                {!viewer.urlLoading && (viewer.kind === 'img' || viewer.kind === 'vid') && !viewer.url && (
                  <div className="gallery-preview-empty">
                    <div className="gallery-preview-emptyTitle">No se pudo cargar la vista previa</div>
                    <div className="gallery-preview-emptyText">Puedes descargar el archivo para abrirlo localmente.</div>
                    <button className="btn btn-primary btn-sm" onClick={() => download(viewer.file)}>Descargar archivo</button>
                  </div>
                )}

                {!viewer.urlLoading && !viewer.url && (viewer.kind === 'raw' || viewer.kind === 'i360' || viewer.kind === 'file') && (
                  <div className="lightbox-file-fallback">
                    <div className="lightbox-file-icon">{viewer.kind === 'raw' ? 'RAW' : viewer.kind === 'i360' ? '360°' : '📄'}</div>
                    <div className="lightbox-file-text">Vista previa no disponible</div>
                    <button className="btn btn-primary btn-sm" onClick={() => download(viewer.file)}>Descargar archivo</button>
                  </div>
                )}
              </div>

              <div className="gallery-preview-content">
                <div className="gallery-preview-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => navViewer(-1)}>‹ Anterior</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => navViewer(1)}>Siguiente ›</button>
                  <button className="btn btn-primary btn-sm" onClick={() => download(viewer.file)}>Descargar</button>
                </div>

                <div className="lightbox-meta-panel gallery-preview-meta">
                  <div className="meta-row"><span>Tamaño:</span><strong>{formatBytes(viewer.file?.size)}</strong></div>
                  <div className="meta-row">
                    <span>Resolución:</span>
                    <strong>
                      {viewer.urlLoading
                        ? 'Preparando...'
                        : viewer.metaLoading
                        ? 'Calculando...'
                        : (viewer.width && viewer.height ? `${viewer.width} x ${viewer.height} px` : 'No disponible')}
                    </strong>
                  </div>
                  <div className="meta-row"><span>Orientación:</span><strong>{orientationOf(viewer.width, viewer.height)}</strong></div>
                  <div className="meta-row"><span>Proporción:</span><strong>{aspectRatioOf(viewer.width, viewer.height)}</strong></div>
                  <div className="meta-row"><span>Tipo:</span><strong>{extOf(viewer.file?.name || '').toUpperCase() || 'N/A'}</strong></div>
                  <div className="meta-row"><span>Modificado:</span><strong>{formatDate(viewer.file?.lastModified)}</strong></div>
                </div>
              </div>
            </aside>
          )}

          {fullscreenViewer && (
            <div
              ref={lightboxRef}
              className="lightbox-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`Vista completa: ${fullscreenViewer.file?.name || 'archivo'}`}
              onClick={e => e.target.className === 'lightbox-overlay' && setFullscreenViewer(null)}
            >
              <button className="lightbox-close" aria-label="Cerrar vista completa" onClick={() => setFullscreenViewer(null)}>✕</button>
              <button className="lightbox-nav prev" onClick={() => navViewer(-1)}>‹</button>
              <button className="lightbox-nav next" onClick={() => navViewer(1)}>›</button>

              <img className="lightbox-img" src={fullscreenViewer.url} alt={fullscreenViewer.file?.name || 'preview'} />

              <div className="lightbox-bottom-row">
                <div className="lightbox-toolbar">
                  <span className="lightbox-name">{fullscreenViewer.file?.name || 'Sin nombre'}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => download(fullscreenViewer.file)}>Descargar</button>
                </div>

                <div className="lightbox-meta-panel">
                  <div className="meta-row"><span>Tamaño:</span><strong>{formatBytes(fullscreenViewer.file?.size)}</strong></div>
                  <div className="meta-row">
                    <span>Resolución:</span>
                    <strong>
                      {fullscreenViewer.metaLoading
                        ? 'Calculando...'
                        : (fullscreenViewer.width && fullscreenViewer.height ? `${fullscreenViewer.width} x ${fullscreenViewer.height} px` : 'No disponible')}
                    </strong>
                  </div>
                  <div className="meta-row"><span>Orientación:</span><strong>{orientationOf(fullscreenViewer.width, fullscreenViewer.height)}</strong></div>
                  <div className="meta-row"><span>Proporción:</span><strong>{aspectRatioOf(fullscreenViewer.width, fullscreenViewer.height)}</strong></div>
                  <div className="meta-row"><span>Tipo:</span><strong>{extOf(fullscreenViewer.file?.name || '').toUpperCase() || 'N/A'}</strong></div>
                  <div className="meta-row"><span>Modificado:</span><strong>{formatDate(fullscreenViewer.file?.lastModified)}</strong></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!favTarget}
        onClose={() => !favBusy && setFavTarget(null)}
        title="Agregar a favoritos"
        subtitle={favTarget?.name}
        footer={<button className="btn btn-ghost" onClick={() => setFavTarget(null)} disabled={favBusy}>Cerrar</button>}
      >
        {collections.length > 0 && (
          <>
            <span className="field-label">Elige una colección</span>
            <div className="fav-col-picklist">
              {collections.map(c => (
                <button key={c.id} className="fav-col-pick" disabled={favBusy} onClick={() => addTargetTo(c.id)}>
                  <span className="fav-col-pick-name">{c.name}</span>
                  <span className="fav-col-pick-count">{(c.items || []).length}</span>
                </button>
              ))}
            </div>
            <div className="fav-col-sep">o crea una nueva</div>
          </>
        )}
        <div className="fav-col-new">
          <input
            className="field-input" autoFocus value={newColName}
            placeholder="Nombre de la colección (p. ej. Mejores Puente)"
            onChange={e => setNewColName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newColName.trim() && !favBusy) createAndAdd() }}
          />
          <button className="btn btn-primary" disabled={favBusy || !newColName.trim()} onClick={createAndAdd}>
            {favBusy ? '...' : 'Crear y guardar'}
          </button>
        </div>
      </Modal>
    </>
  )
}

function GalleryItem({ file, thumbUrl, onThumbLoaded, getSas, onClick, active, fav, onFav }) {
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)
  const prefix = prefixOf(file.name)

  // Lazy load thumbnail only when visible in viewport
  useEffect(() => {
    if (!isImg(file.name) || thumbUrl) return

    const observer = new IntersectionObserver(
      async (entries) => {
        if (entries[0].isIntersecting && !loading) {
          setLoading(true)
          try {
            // Caché compartida entre navegaciones: volver a la semana no re-descarga
            const thumbObjectUrl = await fetchThumb(file.path, { w: 520, q: 68 })
            onThumbLoaded(thumbObjectUrl)
            observer.disconnect()
          } catch (err) {
            // Fallback to original image SAS if thumbnail generation fails.
            try {
              const fallbackUrl = await getSas(file.path, 60)
              onThumbLoaded(fallbackUrl)
              observer.disconnect()
            } catch (fallbackErr) {
              console.error('Failed to load thumbnail:', fallbackErr)
            }
          } finally {
            setLoading(false)
          }
        }
      },
      { rootMargin: '100px' } // Start loading 100px before item enters viewport
    )

    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [file.path, file.name, thumbUrl, loading, onThumbLoaded, getSas])

  const icon = isVid(file.name) ? '▶' : isRaw(file.name) ? 'RAW' : isI360(file.name) ? '360°' : '📄'
  const typeColor = PREFIX_BADGE[prefix] || 'badge-dim'

  return (
    <div ref={ref} className={`gallery-item ${active ? 'active' : ''}`} onClick={onClick}>
      {thumbUrl ? (
        <img src={thumbUrl} alt={file.name} loading="lazy" />
      ) : (
        <div className="file-icon">
          <div className="file-icon-sym">{icon}</div>
          <div className="file-icon-name">{file.name}</div>
          {loading && <div className="spinner" style={{ width: 16, height: 16 }} />}
        </div>
      )}
      <button
        className={`gallery-fav-btn ${fav ? 'is-fav' : ''}`}
        title={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        aria-label={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        onClick={(e) => { e.stopPropagation(); onFav?.() }}
      >
        <HeartIcon filled={fav} />
      </button>
      <div className={`gallery-item-type badge ${typeColor}`}>{prefix}</div>
      <div className="gallery-item-label">{file.name}</div>
    </div>
  )
}
