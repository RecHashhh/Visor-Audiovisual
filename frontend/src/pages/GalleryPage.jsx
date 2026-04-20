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

function extOf(name)   { return name.split('.').pop().toLowerCase() }
function prefixOf(name){ return name.split('_')[0].toUpperCase() }
function isImg(name)   { return IMG_EXTS.includes(extOf(name)) }
function isVid(name)   { return VID_EXTS.includes(extOf(name)) }
function isRaw(name)   { return RAW_EXTS.includes(extOf(name)) }

export default function GalleryPage() {
  const { id, week } = useParams()
  const [files,      setFiles]      = useState([])
  const [sasUrls,    setSasUrls]    = useState({})  // path → sasUrl
  const [loading,    setLoading]    = useState(true)
  const [loadingSas, setLoadingSas] = useState(false)
  const [filter,     setFilter]     = useState('all')
  const [lightbox,   setLightbox]   = useState(null)
  const [videoFile,  setVideoFile]  = useState(null)
  const [shareLink,  setShareLink]  = useState(null)
  const [sharingDays,setSharingDays]= useState(7)
  const [showShare,  setShowShare]  = useState(false)
  const [copied,     setCopied]     = useState(false)

  // 1. Cargar lista de archivos
  useEffect(() => {
    setLoading(true)
    api.getFiles(id, week)
      .then(data => {
        setFiles(data)
        // 2. Cargar SAS de imágenes en batch automáticamente
        const imgPaths = data.filter(f => isImg(f.name)).map(f => f.path)
        if (imgPaths.length > 0) {
          setLoadingSas(true)
          api.getSasBatch(imgPaths, 120)
            .then(res => setSasUrls(res.urls || {}))
            .catch(e => console.warn('SAS batch error:', e))
            .finally(() => setLoadingSas(false))
        }
      })
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [id, week])

  // SAS individual para videos (bajo demanda)
  const getVideoSas = useCallback(async (file) => {
    if (sasUrls[file.path]) return sasUrls[file.path]
    const res = await api.getSasUrl(file.path, 60)
    setSasUrls(prev => ({ ...prev, [file.path]: res.sasUrl }))
    return res.sasUrl
  }, [sasUrls])

  const openItem = async (file, idx) => {
    if (isVid(file.name)) {
      const url = await getVideoSas(file)
      setVideoFile({ url, name: file.name })
      return
    }
    if (isImg(file.name) && sasUrls[file.path]) {
      setLightbox({ idx, url: sasUrls[file.path], name: file.name, file })
    }
  }

  const navLightbox = (dir) => {
    const imgs = displayFiles.filter(f => isImg(f.name) && sasUrls[f.path])
    const cur  = imgs.findIndex(f => f.path === lightbox?.file?.path)
    const next = imgs[(cur + dir + imgs.length) % imgs.length]
    if (next) setLightbox({ idx: displayFiles.indexOf(next), url: sasUrls[next.path], name: next.name, file: next })
  }

  const download = (file) => {
    const url = sasUrls[file.path]
    if (!url) return
    const a = document.createElement('a')
    a.href = url; a.download = file.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const generateShare = async () => {
    try {
      const res = await api.createShare(id, week, sharingDays)
      setShareLink(`${window.location.origin}/share/${res.token}`)
    } catch(e) { console.error(e) }
  }

  const copyLink = () => {
    if (!shareLink) return
    navigator.clipboard.writeText(shareLink)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const handler = (e) => {
      if (!lightbox) return
      if (e.key === 'ArrowRight') navLightbox(1)
      if (e.key === 'ArrowLeft')  navLightbox(-1)
      if (e.key === 'Escape')     setLightbox(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, displayFiles])

  const prefixes     = [...new Set(files.map(f => prefixOf(f.name)))].filter(Boolean)
  const displayFiles = filter === 'all' ? files : files.filter(f => prefixOf(f.name) === filter)
  const imgCount     = files.filter(f => isImg(f.name)).length
  const vidCount     = files.filter(f => isVid(f.name)).length
  const rawCount     = files.filter(f => isRaw(f.name)).length
  const sasLoaded    = Object.keys(sasUrls).length

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Proyectos</Link><span className="sep">›</span>
        <Link to={`/project/${id}`}>{id}</Link><span className="sep">›</span>
        <span className="current">{week}</span>
      </div>

      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 className="page-title" style={{ fontSize:'1.2rem' }}>
            {id} <span>/ {week}</span>
          </h1>
          <p className="page-sub">
            {files.length} archivos · {imgCount} imágenes · {vidCount} videos · {rawCount} RAW
            {loadingSas && ` · cargando previews...`}
            {!loadingSas && imgCount > 0 && ` · ${sasLoaded}/${imgCount} previews listos`}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowShare(s => !s)}>
          🔗 Compartir semana
        </button>
      </div>

      {/* Panel compartir */}
      {showShare && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:16, marginBottom:16 }}>
          <div style={{ fontFamily:'var(--font-display)', fontWeight:700, marginBottom:10, fontSize:'0.9rem' }}>
            🔗 Generar enlace externo (sin login)
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontSize:'0.8rem', color:'var(--text-dim)' }}>Expira en:</span>
            {[7,14,30].map(d => (
              <button key={d} className={`filter-chip ${sharingDays===d?'active':''}`}
                onClick={() => setSharingDays(d)}>{d} días</button>
            ))}
            <button className="btn btn-primary btn-sm" onClick={generateShare}>Generar link</button>
          </div>
          {shareLink && (
            <div style={{ marginTop:10, display:'flex', gap:8, alignItems:'center', background:'var(--bg3)', padding:'10px 12px', borderRadius:'var(--radius)', flexWrap:'wrap' }}>
              <code style={{ flex:1, fontSize:'0.75rem', wordBreak:'break-all' }}>{shareLink}</code>
              <button className="btn btn-primary btn-sm" onClick={copyLink}>
                {copied ? '✅ Copiado' : 'Copiar'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading && <div className="loading"><div className="spinner"/><span>Cargando archivos...</span></div>}

      {!loading && (
        <>
          <div className="gallery-toolbar">
            <button className={`filter-chip ${filter==='all'?'active':''}`} onClick={() => setFilter('all')}>
              Todos ({files.length})
            </button>
            {prefixes.map(p => (
              <button key={p} className={`filter-chip ${filter===p?'active':''}`} onClick={() => setFilter(p)}>
                {p} ({files.filter(f => prefixOf(f.name)===p).length})
              </button>
            ))}
          </div>

          <div className="gallery-grid">
            {displayFiles.map((file, idx) => (
              <GalleryItem
                key={file.name}
                file={file}
                sasUrl={sasUrls[file.path]}
                onClick={() => openItem(file, idx)}
              />
            ))}
          </div>
        </>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={e => e.target===e.currentTarget && setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
          <button className="lightbox-nav prev" onClick={() => navLightbox(-1)}>‹</button>
          <button className="lightbox-nav next" onClick={() => navLightbox(1)}>›</button>
          <img className="lightbox-img" src={lightbox.url} alt={lightbox.name} />
          <div className="lightbox-toolbar">
            <span className="lightbox-name">{lightbox.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => download(lightbox.file)}>⬇ Descargar</button>
          </div>
        </div>
      )}

      {/* Video */}
      {videoFile && (
        <div className="lightbox-overlay" onClick={e => e.target===e.currentTarget && setVideoFile(null)}>
          <button className="lightbox-close" onClick={() => setVideoFile(null)}>✕</button>
          <div className="video-container" style={{ maxWidth:'90vw', width:960 }}>
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

function GalleryItem({ file, sasUrl, onClick }) {
  const prefix    = prefixOf(file.name)
  const typeColor = PREFIX_BADGE[prefix] || 'badge-dim'
  const canPreview= isImg(file.name)
  const icon      = isVid(file.name) ? '▶' : isRaw(file.name) ? 'RAW' : file.name.endsWith('.insv') ? '360°' : '📄'

  return (
    <div className="gallery-item" onClick={onClick}
      style={{ cursor: canPreview || isVid(file.name) ? 'pointer' : 'default' }}>
      {canPreview && sasUrl ? (
        <img src={sasUrl} alt={file.name} loading="lazy" />
      ) : (
        <div className="file-icon">
          <div className="file-icon-sym">{icon}</div>
          <div className="file-icon-name">{file.name}</div>
          {canPreview && !sasUrl && <div className="spinner" style={{ width:16, height:16 }}/>}
        </div>
      )}
      <div className={`gallery-item-type badge ${typeColor}`}>{prefix}</div>
      <div className="gallery-item-label">{file.name}</div>
    </div>
  )
}
