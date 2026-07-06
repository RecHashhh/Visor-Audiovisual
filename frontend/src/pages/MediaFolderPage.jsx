// src/pages/MediaFolderPage.jsx
// Contenido de una carpeta de biblioteca (_media/<section>/<folder>/).
// - Marcas: si los archivos siguen la convención de logos, muestra galería con
//   filtros + el arquetipo (marca.json).
// - Cualquier sección: imágenes como miniaturas y el resto como archivos, con
//   subida directa para quien tenga la capacidad manageMedia.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../utils/api'
import { fetchThumb } from '../utils/thumbs'
import { useAuthz, hasCap } from '../utils/authz'
import { sectionById } from '../config/sections'

const FORMAT_LABEL = {
  centrada: 'Centrada', horizontal: 'Horizontal', simbolo: 'Símbolo',
  'tagline-centrada': 'Tagline centrada', 'tagline-horizontal': 'Tagline horizontal', 'tagline-logotipo': 'Tagline + logotipo',
}
const BACKGROUND_LABEL = { positivo: 'Positivo', negativo: 'Negativo' }
const COLOR_LABEL = { azul: 'Azul', bn: 'Blanco y negro', b: 'Blanco' }
const FORMAT_ORDER = ['centrada', 'horizontal', 'simbolo', 'tagline-centrada', 'tagline-horizontal', 'tagline-logotipo']
const VARIANT_RE = /^(tagline-centrada|tagline-horizontal|tagline-logotipo|centrada|horizontal|simbolo)-(positivo|negativo)-(azul|bn|b)$/
const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff']

const isImage = (name) => IMG_EXT.includes((name.split('.').pop() || '').toLowerCase())

function parseVariant(file) {
  if (file.name.includes('/')) return null
  const m = file.name.toLowerCase().replace(/\.[^.]+$/, '').match(VARIANT_RE)
  if (!m) return null
  return {
    ...file,
    format: m[1], formatLabel: FORMAT_LABEL[m[1]],
    background: m[2], backgroundLabel: BACKGROUND_LABEL[m[2]],
    color: m[3], colorLabel: COLOR_LABEL[m[3]],
  }
}

async function downloadFile(path, fileName) {
  const res = await api.getSasUrl(path, 15)
  const blobRes = await fetch(res.sasUrl)
  if (!blobRes.ok) throw new Error('No se pudo descargar el archivo')
  const blob = await blobRes.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
function fmtSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '' }
}

export default function MediaFolderPage({ sectionId }) {
  const section = sectionById(sectionId)
  const { folder } = useParams()
  const { me } = useAuthz()
  const canUpload = hasCap(me, 'manageMedia')
  const isMarcas = sectionId === 'marcas'

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [format, setFormat] = useState('all')
  const [background, setBackground] = useState('all')
  const [color, setColor] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const fileInputRef = useRef(null)

  function load() {
    setLoading(true); setError(null)
    api.getMediaFolder(sectionId, folder).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [sectionId, folder]) // eslint-disable-line react-hooks/exhaustive-deps

  const files = data?.files || []
  const variants = useMemo(() => (isMarcas ? files.map(parseVariant).filter(Boolean) : []), [files, isMarcas])
  const variantPaths = useMemo(() => new Set(variants.map(v => v.path)), [variants])
  const otherFiles = files.filter(f => !variantPaths.has(f.path))
  const otherImages = otherFiles.filter(f => isImage(f.name))
  const otherDocs = otherFiles.filter(f => !isImage(f.name))

  // Lista maestra de imágenes de la carpeta (variantes + otras imágenes) para el
  // visor grande: al abrir una, las flechas recorren TODAS en orden alfabético.
  const imageFiles = useMemo(
    () => files.filter(f => isImage(f.name)).map(f => ({ ...f, isLogo: variantPaths.has(f.path) })),
    [files, variantPaths]
  )
  const [viewer, setViewer] = useState(-1)
  const openViewer = (path) => {
    const i = imageFiles.findIndex(f => f.path === path)
    if (i >= 0) setViewer(i)
  }
  const moveViewer = (delta) => setViewer(i => {
    const n = i + delta
    return n >= 0 && n < imageFiles.length ? n : i
  })
  const meta = data?.meta
  const hasFilters = format !== 'all' || background !== 'all' || color !== 'all'

  const filtered = variants.filter(v =>
    (format === 'all' || v.format === format) &&
    (background === 'all' || v.background === background) &&
    (color === 'all' || v.color === color))

  async function onUploadFiles(e) {
    const chosen = e.target.files
    if (!chosen || chosen.length === 0) return
    setUploading(true); setUploadMsg(null)
    try {
      const res = await api.uploadMediaFiles(sectionId, folder, chosen)
      const okCount = res?.uploaded?.length || 0
      const failCount = res?.failed?.length || 0
      setUploadMsg({
        ok: failCount === 0,
        text: failCount === 0
          ? `${okCount} archivo${okCount !== 1 ? 's' : ''} subido${okCount !== 1 ? 's' : ''}.`
          : `${okCount} subidos, ${failCount} con error (${res.failed.map(f => f.name).join(', ')}).`,
      })
      load()
    } catch (err2) {
      setUploadMsg({ ok: false, text: `No se pudo subir: ${err2.message}` })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const Crumb = () => (
    <div className="breadcrumb">
      <Link to={section.path}>{section.label}</Link>
      <span className="sep">›</span>
      <span className="current">{meta?.name || folder}</span>
    </div>
  )

  if (loading) return <div className="loading"><div className="spinner" /><span>Cargando {folder}...</span></div>
  if (error) return <><Crumb /><div className="alert alert-error" role="alert">No se pudo cargar: {error}</div></>

  return (
    <>
      <Crumb />
      <div className="page-header brand-page-header">
        <div>
          <h1 className="page-title">{meta?.name || folder}</h1>
          <p className="page-sub">{meta?.tagline || `${files.length} archivo${files.length !== 1 ? 's' : ''}`}</p>
        </div>
        {canUpload && (
          <div className="brand-upload">
            <input ref={fileInputRef} type="file" multiple hidden onChange={onUploadFiles} />
            <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Subiendo...' : 'Subir archivos'}
            </button>
            {uploadMsg && <span className={`media-add-msg ${uploadMsg.ok ? 'ok' : 'error'}`}>{uploadMsg.text}</span>}
          </div>
        )}
      </div>

      {isMarcas && meta?.archetype && (
        <div className="brand-archetype">
          <div className="brand-archetype-showcase">
            <BrandShowcase variants={variants} brandName={meta?.name || folder} />
          </div>
          <div className="brand-archetype-body">
            <div className="brand-archetype-eyebrow">Arquetipo de marca</div>
            <h2 className="brand-archetype-name">{meta.archetype.name}</h2>
            <p className="brand-archetype-summary">{meta.archetype.summary}</p>
            <p className="brand-archetype-desc">{meta.archetype.description}</p>
          </div>
        </div>
      )}

      {files.length === 0 && (
        <div className="empty">
          <div className="empty-text">Esta carpeta aún no tiene archivos</div>
          <p className="access-empty-hint">
            {canUpload ? 'Usa "Subir archivos" para agregar contenido.' : 'Todavía no se ha subido contenido aquí.'}
          </p>
        </div>
      )}

      {variants.length > 0 && (
        <>
          <div className="toolbar">
            <label className="field-select">
              <span className="field-select-label">Formato</span>
              <select className="select" value={format} onChange={e => setFormat(e.target.value)}>
                <option value="all">Todos los formatos</option>
                {FORMAT_ORDER.filter(f => variants.some(v => v.format === f)).map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
              </select>
            </label>
            <label className="field-select">
              <span className="field-select-label">Fondo</span>
              <select className="select" value={background} onChange={e => setBackground(e.target.value)}>
                <option value="all">Cualquier fondo</option>
                <option value="positivo">Positivo (fondo claro)</option>
                <option value="negativo">Negativo (fondo oscuro)</option>
              </select>
            </label>
            <label className="field-select">
              <span className="field-select-label">Color</span>
              <select className="select" value={color} onChange={e => setColor(e.target.value)}>
                <option value="all">Cualquier color</option>
                <option value="azul">Azul</option>
                <option value="bn">Blanco y negro</option>
                <option value="b">Blanco</option>
              </select>
            </label>
            <div className="toolbar-spacer" />
            <span className="toolbar-count">{filtered.length} de {variants.length} variantes</span>
            {hasFilters && <button className="btn btn-ghost btn-sm" onClick={() => { setFormat('all'); setBackground('all'); setColor('all') }}>Limpiar filtros</button>}
          </div>

          {filtered.length === 0
            ? <div className="empty"><div className="empty-text">Ninguna variante coincide con esos filtros</div></div>
            : FORMAT_ORDER.map(fo => {
                const group = filtered.filter(v => v.format === fo)
                if (group.length === 0) return null
                return (
                  <section key={fo} className="logo-group">
                    <h2 className="logo-group-title">{FORMAT_LABEL[fo]}<span className="logo-group-count">{group.length}</span></h2>
                    <div className="logo-grid">{group.map(v => <LogoTile key={v.path} variant={v} brandName={meta?.name || folder} onOpen={openViewer} />)}</div>
                  </section>
                )
              })}
        </>
      )}

      {otherImages.length > 0 && (
        <section className="logo-group">
          <h2 className="logo-group-title">{variants.length > 0 ? 'Otras imágenes' : 'Imágenes'}<span className="logo-group-count">{otherImages.length}</span></h2>
          <div className="media-img-grid">{otherImages.map(f => <ImageTile key={f.path} file={f} onOpen={openViewer} />)}</div>
        </section>
      )}

      {otherDocs.length > 0 && (
        <section className="logo-group">
          <h2 className="logo-group-title">Archivos<span className="logo-group-count">{otherDocs.length}</span></h2>
          <div className="media-file-list">{otherDocs.map(f => <MediaFileRow key={f.path} file={f} />)}</div>
        </section>
      )}

      {viewer >= 0 && imageFiles[viewer] && (
        <Lightbox images={imageFiles} index={viewer} onClose={() => setViewer(-1)} onMove={moveViewer} />
      )}
    </>
  )
}

function Lightbox({ images, index, onClose, onMove }) {
  const img = images[index]
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!img) return
    let alive = true
    setSrc(null)
    fetchThumb(img.path, { w: 1600, mode: img.isLogo ? 'logo' : '' })
      .then(url => { if (alive) setSrc(url) }).catch(() => {})
    return () => { alive = false }
  }, [img?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onMove(-1)
      else if (e.key === 'ArrowRight') onMove(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onMove])
  if (!img) return null
  const name = img.name.split('/').pop()
  const hasPrev = index > 0
  const hasNext = index < images.length - 1
  return (
    <div className="media-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={name}>
      <button className="media-lightbox-close" onClick={onClose} aria-label="Cerrar (Esc)">×</button>
      <button className="media-lightbox-nav prev" onClick={e => { e.stopPropagation(); onMove(-1) }}
        disabled={!hasPrev} aria-label="Anterior (←)">‹</button>
      <figure className="media-lightbox-stage" onClick={e => e.stopPropagation()}>
        <div className="media-lightbox-img">
          {src ? <img src={src} alt={name} /> : <div className="spinner" />}
        </div>
        <figcaption className="media-lightbox-caption">
          <span className="media-lightbox-name">{name}</span>
          <span className="media-lightbox-meta">
            {img.lastModified && <span>Subido el {fmtDate(img.lastModified)}</span>}
            <button className="media-lightbox-download" onClick={() => downloadFile(img.path, name).catch(() => {})}>
              Descargar original
            </button>
          </span>
        </figcaption>
      </figure>
      <button className="media-lightbox-nav next" onClick={e => { e.stopPropagation(); onMove(1) }}
        disabled={!hasNext} aria-label="Siguiente (→)">›</button>
      <div className="media-lightbox-counter">{index + 1} / {images.length}</div>
    </div>
  )
}

function BrandShowcase({ variants, brandName }) {
  const pick = variants.find(v => v.format === 'horizontal' && v.background === 'positivo' && v.color === 'azul')
    || variants.find(v => v.background === 'positivo') || variants[0]
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!pick) return
    let alive = true
    fetchThumb(pick.path, { w: 560, mode: 'logo' }).then(url => { if (alive) setSrc(url) }).catch(() => {})
    return () => { alive = false }
  }, [pick?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!pick) return null
  return src ? <img src={src} alt={`Logo de ${brandName}`} /> : <div className="spinner" />
}

function sampleCornerColor(imgEl) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 4; canvas.height = 4
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgEl, 0, 0)
    const d = ctx.getImageData(1, 1, 1, 1).data
    if (d[3] < 250) return null
    return `rgb(${d[0]},${d[1]},${d[2]})`
  } catch { return null }
}

function LogoTile({ variant: v, brandName, onOpen }) {
  const [src, setSrc] = useState(null)
  const [bg, setBg] = useState(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    fetchThumb(v.path, { w: 560, mode: 'logo' }).then(url => { if (alive) setSrc(url) }).catch(() => {})
    return () => { alive = false }
  }, [v.path])
  const stageBg = bg || (v.color === 'b' ? '#14161f' : null)
  return (
    <div className="logo-tile">
      <button type="button" className="logo-tile-preview media-open" style={stageBg ? { background: stageBg } : undefined}
        onClick={() => onOpen?.(v.path)} aria-label={`Ver ${v.formatLabel} en grande`}>
        {src && <img className={`img-fade ${loaded ? 'is-loaded' : ''}`} src={src}
          alt={`${brandName} — ${v.formatLabel}, ${v.backgroundLabel}, ${v.colorLabel}`}
          onLoad={e => { setBg(sampleCornerColor(e.target)); setLoaded(true) }} />}
      </button>
      <div className="logo-tile-caption">
        <div className="logo-tile-info">
          <span className="logo-tile-name">{v.backgroundLabel} · {v.colorLabel}</span>
          <span className="logo-tile-meta">{v.lastModified ? `PNG · ${fmtDate(v.lastModified)}` : 'PNG · alta resolución'}</span>
        </div>
        <button className="icon-btn" onClick={() => downloadFile(v.path, v.name).catch(() => {})} title="Descargar original" aria-label={`Descargar ${v.formatLabel}`}>
          <DownloadIcon />
        </button>
      </div>
    </div>
  )
}

function ImageTile({ file: f, onOpen }) {
  const [src, setSrc] = useState(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    fetchThumb(f.path, { w: 400, q: 66 }).then(url => { if (alive) setSrc(url) }).catch(() => {})
    return () => { alive = false }
  }, [f.path])
  return (
    <div className="media-img-tile">
      <button type="button" className="media-img-preview media-open" onClick={() => onOpen?.(f.path)} aria-label={`Ver ${f.name.split('/').pop()} en grande`}>
        {src && <img className={`img-fade ${loaded ? 'is-loaded' : ''}`} src={src} alt={f.name} loading="lazy" onLoad={() => setLoaded(true)} />}
      </button>
      <div className="media-img-caption">
        <div className="media-img-info">
          <span className="media-img-name" title={f.name}>{f.name.split('/').pop()}</span>
          {f.lastModified && <span className="media-img-date">{fmtDate(f.lastModified)}</span>}
        </div>
        <button className="icon-btn" onClick={() => downloadFile(f.path, f.name.split('/').pop()).catch(() => {})} title="Descargar" aria-label={`Descargar ${f.name}`}>
          <DownloadIcon />
        </button>
      </div>
    </div>
  )
}

function MediaFileRow({ file: f }) {
  return (
    <div className="media-file-row">
      <span className="media-file-name">{f.name}</span>
      <span className="media-file-meta">{fmtSize(f.size)}{f.lastModified ? ` · ${fmtDate(f.lastModified)}` : ''}</span>
      <button className="icon-btn" onClick={() => downloadFile(f.path, f.name.split('/').pop()).catch(() => {})} title="Descargar" aria-label={`Descargar ${f.name}`}>
        <DownloadIcon />
      </button>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11" /><path d="M4.5 19.5h15" />
    </svg>
  )
}
