import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../utils/api'

const PREFIX_BADGE = {
  DRN: 'badge-orange', FOT: 'badge-blue', VID: 'badge-red',
  E360: 'badge-accent', I360: 'badge-dim',
}
const IMG_EXTS  = ['jpg','jpeg','png','tiff','tif','webp']
const VID_EXTS  = ['mp4','mov','avi']

function extOf(name)   { return name.split('.').pop().toLowerCase() }
function prefixOf(name){ return name.split('_')[0].toUpperCase() }
function isImg(name)   { return IMG_EXTS.includes(extOf(name)) }
function isVid(name)   { return VID_EXTS.includes(extOf(name)) }

export default function GalleryPage() {
  const { id, week } = useParams()
  const [files, setFiles] = useState([])
  const [sasUrls, setSasUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [lightbox, setLightbox] = useState(null)

  // --- CORRECCIÓN DE INICIALIZACIÓN (Mover esto arriba) ---
  const prefixes = useMemo(() => {
    return [...new Set(files.map(f => prefixOf(f.name)))].filter(Boolean)
  }, [files])

  const displayFiles = useMemo(() => {
    return filter === 'all' ? files : files.filter(f => prefixOf(f.name) === filter)
  }, [files, filter])

  // --- CARGA DE DATOS (Mantiene tu lógica de SAS batch) ---
  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getFiles(id, week)
        setFiles(data)
        const paths = data.map(f => f.path)
        if (paths.length > 0) {
          const { urls } = await api.getSasBatch(paths, 120)
          setSasUrls(urls)
        }
      } catch (err) {
        console.error("Error cargando archivos:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, week])

  // --- EVENTOS DE TECLADO ---
  useEffect(() => {
    const handler = (e) => {
      if (!lightbox) return
      if (e.key === 'ArrowRight') navLightbox(1)
      if (e.key === 'ArrowLeft') navLightbox(-1)
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, displayFiles])

  const navLightbox = (dir) => {
    const idx = displayFiles.findIndex(f => f.path === lightbox.path)
    const next = displayFiles[(idx + dir + displayFiles.length) % displayFiles.length]
    setLightbox(next)
  }

  const handleShare = async () => {
    try {
      const res = await api.createShare(id, week, 7)
      const url = `${window.location.origin}/share/${res.token}`
      await navigator.clipboard.writeText(url)
      alert("Link de acceso (7 días) copiado al portapapeles")
    } catch (err) {
      alert("Error al crear link: " + err.message)
    }
  }

  if (loading) return <div className="loading"><div className="spinner" /><span>Cargando galería...</span></div>

  return (
    <>
      <div className="header-actions">
        <div className="breadcrumb">
          <Link to="/">Proyectos</Link> / <Link to={`/project/${id}`}>{id}</Link> / {week}
        </div>
        <div className="btn-group">
          <button className="btn btn-outline" onClick={handleShare}>
            <span>🔗 Compartir Semana</span>
          </button>
        </div>
      </div>

      <div className="stats-bar">
        <div 
          className={`badge ${filter === 'all' ? 'badge-blue' : 'badge-dim'}`}
          style={{ cursor: 'pointer' }}
          onClick={() => setFilter('all')}
        >
          TODOS ({files.length})
        </div>
        {prefixes.map(p => (
          <div 
            key={p}
            className={`badge ${filter === p ? (PREFIX_BADGE[p] || 'badge-blue') : 'badge-dim'}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setFilter(p)}
          >
            {p} ({files.filter(f => prefixOf(f.name) === p).length})
          </div>
        ))}
      </div>

      <div className="gallery-grid">
        {displayFiles.map((file) => (
          <GalleryItem 
            key={file.path} 
            file={file} 
            sasUrl={sasUrls[file.path]} 
            onClick={() => (isImg(file.name) || isVid(file.name)) && setLightbox(file)} 
          />
        ))}
      </div>

      {lightbox && (
        <div className="lightbox-overlay" onClick={e => e.target === e.currentTarget && setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
          
          <div className="lightbox-content">
            {isImg(lightbox.name) ? (
              <img src={sasUrls[lightbox.path]} alt="" />
            ) : (
              <video src={sasUrls[lightbox.path]} controls autoPlay />
            )}
          </div>

          <div className="lightbox-toolbar">
            <div className="lightbox-info">
              <span className="lightbox-name">{lightbox.name}</span>
            </div>
            <div className="lightbox-btns">
              <a href={sasUrls[lightbox.path]} download={lightbox.name} className="btn-icon" title="Descargar">
                📥
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function GalleryItem({ file, sasUrl, onClick }) {
  const prefix = prefixOf(file.name)
  const typeColor = PREFIX_BADGE[prefix] || 'badge-dim'
  const canPreview = isImg(file.name)
  const icon = isVid(file.name) ? '▶' : '📄'

  return (
    <div className="gallery-item" onClick={onClick}>
      <div className="file-icon">
        {canPreview && sasUrl ? (
          <img src={sasUrl} alt={file.name} loading="lazy" />
        ) : (
          <div className="file-icon-sym">{icon}</div>
        )}
      </div>
      <div className="file-info-mini">
        <span className={`badge-dot ${typeColor}`}></span>
        <span className="file-name-text">{file.name}</span>
      </div>
    </div>
  )
}
