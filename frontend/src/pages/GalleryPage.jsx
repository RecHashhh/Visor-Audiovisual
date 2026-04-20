// src/pages/GalleryPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../utils/api'

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

export default function GalleryPage() {
  const { id, week } = useParams()
  const [files, setFiles] = useState([])
  const [sasCache, setSasCache] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [lightbox, setLightbox] = useState(null)  // { idx: number, url: string, name: string }
  const [videoFile, setVideoFile] = useState(null)
  const [shareLink, setShareLink] = useState(null)
  const [sharingDays, setSharingDays] = useState(7)
  const [showSharePanel, setShowSharePanel] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.getFiles(id, week)
      .then(setFiles)
      .finally(() => setLoading(false))
  }, [id, week])

  const getSas = useCallback(async (blobPath, minutes = 60) => {
    if (sasCache[blobPath]) return sasCache[blobPath]
    const res = await api.getSasUrl(blobPath, minutes)
    setSasCache(c => ({ ...c, [blobPath]: res.sasUrl }))
    return res.sasUrl
  }, [sasCache])

  const openItem = async (file, idx) => {
    if (isVid(file.name)) {
      const url = await getSas(file.path)
      setVideoFile({ url, name: file.name })
      return
    }
    if (isImg(file.name)) {
      const url = await getSas(file.path)
      setLightbox({ idx, url, name: file.name })
    }
  }

  const navLightbox = async (dir) => {
    const imgs = displayFiles.filter(f => isImg(f.name))
    const curIdx = imgs.findIndex(f => f.name === lightbox?.name)
    const next = imgs[(curIdx + dir + imgs.length) % imgs.length]
    if (!next) return
    const url = await getSas(next.path)
    const realIdx = displayFiles.indexOf(next)
    setLightbox({ idx: realIdx, url, name: next.name })
  }

  const download = async (file) => {
    const url = await getSas(file.path, 15)
    const a = document.createElement('a'); a.href = url; a.download = file.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
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

  const prefixes = [...new Set(files.map(f => prefixOf(f.name)))].filter(Boolean)
  const displayFiles = filter === 'all' ? files : files.filter(f => prefixOf(f.name) === filter)

  const counts = {
    img: files.filter(f => isImg(f.name)).length,
    vid: files.filter(f => isVid(f.name)).length,
    raw: files.filter(f => isRaw(f.name)).length,
  }

  // Keyboard nav for lightbox
  useEffect(() => {
    const handler = (e) => {
      if (!lightbox) return
      if (e.key === 'ArrowRight') navLightbox(1)
      if (e.key === 'ArrowLeft')  navLightbox(-1)
      if (e.key === 'Escape')     setLightbox(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox])

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Proyectos</Link>
        <span className="sep">›</span>
        <Link to={`/project/${id}`}>{id}</Link>
        <span className="sep">›</span>
        <span className="current">{week}</span>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '1.2rem' }}>
            {id} <span>/ {week}</span>
          </h1>
          <p className="page-sub">
            {files.length} archivos · {counts.img} imágenes · {counts.vid} videos · {counts.raw} RAW
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSharePanel(s => !s)}>
          🔗 Compartir semana
        </button>
      </div>

      {/* Share panel */}
      {showSharePanel && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: '10px', fontSize: '0.9rem' }}>
            🔗 Generar enlace externo (sin login)
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
                {copied ? '✅ Copiado' : 'Copiar'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading && <div className="loading"><div className="spinner"/></div>}

      {!loading && (
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

          {/* Gallery grid */}
          <div className="gallery-grid">
            {displayFiles.map((file, idx) => (
              <GalleryItem key={file.name} file={file} onClick={() => openItem(file, idx)} />
            ))}
          </div>
        </>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={e => e.target.className === 'lightbox-overlay' && setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
          <button className="lightbox-nav prev" onClick={() => navLightbox(-1)}>‹</button>
          <button className="lightbox-nav next" onClick={() => navLightbox(1)}>›</button>
          <img className="lightbox-img" src={lightbox.url} alt={lightbox.name} />
          <div className="lightbox-toolbar">
            <span className="lightbox-name">{lightbox.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => download(displayFiles[lightbox.idx])}>⬇ Descargar</button>
          </div>
        </div>
      )}

      {/* Video player */}
      {videoFile && (
        <div className="lightbox-overlay" onClick={e => e.target === e.currentTarget && setVideoFile(null)}>
          <button className="lightbox-close" onClick={() => setVideoFile(null)}>✕</button>
          <div className="video-container" style={{ maxWidth: '90vw', width: '960px' }}>
            <video controls autoPlay src={videoFile.url}>Tu navegador no soporta video.</video>
          </div>
          <div className="lightbox-toolbar">
            <span className="lightbox-name">{videoFile.name}</span>
          </div>
        </div>
      )}
    </>
  )
}

function GalleryItem({ file, onClick }) {
  const [thumb, setThumb] = useState(null)
  const [loading, setLoading] = useState(false)
  const prefix = prefixOf(file.name)
  const ext = extOf(file.name)

  const load = async () => {
    if (thumb || loading || !isImg(file.name)) return
    setLoading(true)
    try {
      const res = await api.getSasUrl(file.path, 60)
      setThumb(res.sasUrl)
    } catch {}
    setLoading(false)
  }

  const icon = isVid(file.name) ? '▶' : isRaw(file.name) ? 'RAW' : isI360(file.name) ? '360°' : '📄'
  const typeColor = PREFIX_BADGE[prefix] || 'badge-dim'

  return (
    <div className="gallery-item" onClick={onClick} onMouseEnter={load}>
      {thumb ? (
        <img src={thumb} alt={file.name} loading="lazy" />
      ) : (
        <div className="file-icon">
          <div className="file-icon-sym">{icon}</div>
          <div className="file-icon-name">{file.name}</div>
          {loading && <div className="spinner" style={{ width: 16, height: 16 }} />}
        </div>
      )}
      <div className={`gallery-item-type badge ${typeColor}`}>{prefix}</div>
      <div className="gallery-item-label">{file.name}</div>
    </div>
  )
}
