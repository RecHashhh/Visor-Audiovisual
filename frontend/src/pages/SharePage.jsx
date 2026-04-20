// src/pages/SharePage.jsx — acceso externo sin login
import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../utils/api'

const IMG_EXTS  = ['jpg','jpeg','png','tiff','tif','webp']
const VID_EXTS  = ['mp4','mov','avi']
const RAW_EXTS  = ['dng','cr3','arw','raw','nef']
const I360_EXTS = ['insv']

function extOf(name) { return name.split('.').pop().toLowerCase() }
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

function orientationOf(width, height) {
  if (!width || !height) return 'No disponible'
  if (width === height) return 'Cuadrada'
  return width > height ? 'Horizontal' : 'Vertical'
}

function formatDate(isoDate) {
  if (!isoDate) return 'No disponible'
  const dt = new Date(isoDate)
  if (Number.isNaN(dt.getTime())) return 'No disponible'
  return dt.toLocaleString('es-CL')
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

export default function SharePage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [viewer, setViewer] = useState(null)

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then(r => { if (!r.ok) throw new Error('Enlace inválido o expirado'); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  const files = useMemo(() => data?.files || [], [data])

  const openViewer = async (file, idx) => {
    const kind = kindOf(file.name)
    const url = file.sasUrl
    setViewer({ idx, file, url, kind, width: null, height: null, metaLoading: kind === 'img' || kind === 'vid' })

    if (kind !== 'img' && kind !== 'vid') return

    try {
      const meta = kind === 'img' ? await readImageDimensions(url) : await readVideoDimensions(url)
      setViewer(curr => curr && curr.url === url ? { ...curr, ...meta, metaLoading: false } : curr)
    } catch {
      setViewer(curr => curr && curr.url === url ? { ...curr, metaLoading: false } : curr)
    }
  }

  const navViewer = async (dir) => {
    if (!viewer || !files.length) return
    const next = files[(viewer.idx + dir + files.length) % files.length]
    if (!next) return
    await openViewer(next, files.indexOf(next))
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
      <div className="spinner" style={{ width:36, height:36 }} />
      <span style={{ color:'var(--text-dim)', fontSize:'0.85rem' }}>Verificando enlace...</span>
    </div>
  )

  if (error) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, padding:40, textAlign:'center', maxWidth:380 }}>
        <div style={{ fontSize:'2.5rem', marginBottom:16 }}>⏰</div>
        <h2 style={{ fontFamily:'var(--font-display)', marginBottom:8 }}>Enlace no disponible</h2>
        <p style={{ color:'var(--text-dim)', fontSize:'0.85rem' }}>{error}</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', padding:'24px 20px', maxWidth:1200, margin:'0 auto' }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:'1.4rem', color:'var(--accent)' }}>VISOR AUDIOVISUAL</div>
        <div style={{ fontSize:'0.75rem', color:'var(--text-dim)', marginTop:4 }}>
          Acceso compartido · Proyecto {data?.projectId} · Semana {data?.week} ·{' '}
          <span style={{ color:'var(--orange)' }}>Expira: {new Date(data?.expiresAt).toLocaleDateString('es-EC')}</span>
        </div>
      </div>

      <h1 style={{ fontFamily:'var(--font-display)', fontSize:'1.1rem', marginBottom:16, color:'var(--text)' }}>
        {data?.projectName || data?.projectId} / {data?.week}
      </h1>

      <div className="gallery-grid">
        {files.map((file, i) => (
          <div key={file.name} className="gallery-item" onClick={() => openViewer(file, i)}>
            {file.type === 'img' ? (
              <img src={file.sasUrl} alt={file.name} loading="lazy" />
            ) : (
              <div className="file-icon">
                <div className="file-icon-sym">{file.type === 'vid' ? '▶' : file.type === 'raw' ? 'RAW' : file.type === 'i360' ? '360°' : '📄'}</div>
                <div className="file-icon-name">{file.name}</div>
              </div>
            )}
            <div className="gallery-item-label">{file.name}</div>
          </div>
        ))}
      </div>

      {viewer && (
        <div className="lightbox-overlay" onClick={e => e.target === e.currentTarget && setViewer(null)}>
          <button className="lightbox-close" onClick={() => setViewer(null)}>✕</button>
          <button className="lightbox-nav prev" onClick={() => navViewer(-1)}>‹</button>
          <button className="lightbox-nav next" onClick={() => navViewer(1)}>›</button>

          {viewer.kind === 'img' && <img className="lightbox-img" src={viewer.url} alt={viewer.file.name} />}

          {viewer.kind === 'vid' && (
            <div className="lightbox-media-wrap">
              <video className="lightbox-video" controls autoPlay src={viewer.url}>Tu navegador no soporta video.</video>
            </div>
          )}

          {(viewer.kind === 'raw' || viewer.kind === 'i360' || viewer.kind === 'file') && (
            <div className="lightbox-media-wrap">
              <div className="lightbox-file-fallback">
                <div className="lightbox-file-icon">{viewer.kind === 'raw' ? 'RAW' : viewer.kind === 'i360' ? '360°' : '📄'}</div>
                <div className="lightbox-file-text">Vista previa no disponible</div>
              </div>
            </div>
          )}

          <div className="lightbox-bottom-row">
            <div className="lightbox-toolbar">
              <span className="lightbox-name">{viewer.file.name}</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  try {
                    await downloadAsFile(viewer.url, viewer.file.name)
                  } catch {
                    window.location.href = viewer.url
                  }
                }}
              >
                ⬇ Descargar
              </button>
            </div>

            <div className="lightbox-meta-panel">
              <div className="meta-row"><span>Tamaño:</span><strong>{formatBytes(viewer.file.size)}</strong></div>
              <div className="meta-row"><span>Resolución:</span><strong>{viewer.metaLoading ? 'Calculando...' : (viewer.width && viewer.height ? `${viewer.width} x ${viewer.height} px` : 'No disponible')}</strong></div>
              <div className="meta-row"><span>Orientación:</span><strong>{orientationOf(viewer.width, viewer.height)}</strong></div>
              <div className="meta-row"><span>Tipo:</span><strong>{viewer.file.type?.toUpperCase() || extOf(viewer.file.name).toUpperCase()}</strong></div>
              <div className="meta-row"><span>Modificado:</span><strong>{formatDate(viewer.file.lastModified)}</strong></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
