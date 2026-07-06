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

const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2']
const HTML_EXT = ['html', 'htm']
const extOf = (name) => (name.split('.').pop() || '').toLowerCase()
const isImage = (name) => IMG_EXT.includes(extOf(name))
const isFont = (name) => FONT_EXT.includes(extOf(name))
const isHtml = (name) => HTML_EXT.includes(extOf(name))

// Empareja un archivo fuente (.ai, .eps…) con la imagen de vista previa que ya
// existe en la carpeta: normaliza ambos nombres y busca la imagen cuyo nombre
// sea el sufijo más largo del nombre del fuente (p. ej. RIPCONCIV_version_
// horizontal_positivo_azul.ai ↔ horizontal-positivo-azul.png).
const normalizeName = (s) =>
  s.replace(/\.[^.]+$/, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
function findPreviewImage(docName, images) {
  const dn = normalizeName(docName)
  if (!dn) return null
  let best = null, bestLen = 0
  for (const img of images) {
    const inm = normalizeName(img.name)
    if (inm && dn.endsWith(inm) && inm.length > bestLen) { best = img; bestLen = inm.length }
  }
  return best
}

// Paleta oficial por defecto para marcas conocidas (mientras marca.json no traiga
// su propio `colors`). Clave = nombre de carpeta en minúsculas.
const DEFAULT_BRAND_COLORS = {
  ripconciv: [
    { hex: '#1E3FAA', name: 'Ripconciv Blue', role: 'Color primario' },
    { hex: '#0E1F5C', name: 'Deep Navy', role: 'Fondos y soportes' },
    { hex: '#EAEEF8', name: 'Blanco', role: 'Superficies suaves' },
  ],
}

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
  const fontFiles = otherFiles.filter(f => isFont(f.name))
  const htmlFiles = otherFiles.filter(f => isHtml(f.name))
  // "Archivos" = lo que no es imagen, ni fuente (→ Tipografía), ni html (→ Firmas).
  const otherDocs = otherFiles.filter(f => !isImage(f.name) && !isFont(f.name) && !isHtml(f.name))

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
  // Paleta de la marca (solo en Marcas): de marca.json (meta.colors) o, si no
  // hay, la paleta oficial por defecto para marcas conocidas (p. ej. RIPCONCIV).
  const brandColors = useMemo(() => {
    if (!isMarcas) return []
    if (Array.isArray(meta?.colors) && meta.colors.length) return meta.colors
    return DEFAULT_BRAND_COLORS[(meta?.name || folder).toLowerCase()] || []
  }, [isMarcas, meta, folder])

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

      {brandColors.length > 0 && <BrandColors colors={brandColors} />}

      {fontFiles.length > 0 && <Typography fonts={fontFiles} />}

      {htmlFiles.length > 0 && <HtmlPreviews files={htmlFiles} />}

      {otherDocs.length > 0 && (
        <section className="logo-group">
          <h2 className="logo-group-title">Archivos<span className="logo-group-count">{otherDocs.length}</span></h2>
          <div className="media-img-grid">
            {otherDocs.map(f => <FileTile key={f.path} file={f} previewPath={findPreviewImage(f.name, imageFiles)?.path} />)}
          </div>
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
          alt={`${brandName}: ${v.formatLabel}, ${v.backgroundLabel}, ${v.colorLabel}`}
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

// Paleta de la marca: swatches con hex, clic para copiar.
function BrandColors({ colors }) {
  const [copied, setCopied] = useState(null)
  function copy(hex) {
    navigator.clipboard?.writeText(hex).then(() => {
      setCopied(hex)
      setTimeout(() => setCopied(c => (c === hex ? null : c)), 1200)
    }).catch(() => {})
  }
  return (
    <section className="brand-colors">
      <h2 className="logo-group-title">Colores de marca<span className="logo-group-count">{colors.length}</span></h2>
      <div className="brand-color-grid">
        {colors.map(c => (
          <button key={c.hex} type="button" className="brand-color-card" onClick={() => copy(c.hex)}
            title={`Copiar ${c.hex}`}>
            <span className="brand-color-swatch" style={{ background: c.hex }} aria-hidden="true" />
            <span className="brand-color-info">
              <span className="brand-color-hex">{copied === c.hex ? '¡Copiado!' : c.hex}</span>
              {c.name && <span className="brand-color-name">{c.name}</span>}
              {c.role && <span className="brand-color-role">{c.role}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// Tipo de archivo no-imagen → monograma + color, para que se vea como miniatura.
const FILE_KINDS = {
  ai:   { badge: 'AI',   glyph: 'Ai',  tint: '#ff7a00', bg: '#2a1a06' },
  eps:  { badge: 'EPS',  glyph: 'Ai',  tint: '#ff7a00', bg: '#2a1a06' },
  psd:  { badge: 'PSD',  glyph: 'Ps',  tint: '#31a8ff', bg: '#001e36' },
  pdf:  { badge: 'PDF',  glyph: 'PDF', tint: '#ff5b5b', bg: '#2a0d0d' },
  indd: { badge: 'INDD', glyph: 'Id',  tint: '#ff3f8b', bg: '#2a0a1a' },
  zip:  { badge: 'ZIP',  glyph: '',    tint: '#d6b24a', bg: '#211d10' },
  rar:  { badge: 'RAR',  glyph: '',    tint: '#d6b24a', bg: '#211d10' },
  '7z': { badge: '7Z',   glyph: '',    tint: '#d6b24a', bg: '#211d10' },
  ttf:  { badge: 'TTF',  glyph: 'Aa',  tint: '#8ab4ff', bg: '#0e1230' },
  otf:  { badge: 'OTF',  glyph: 'Aa',  tint: '#8ab4ff', bg: '#0e1230' },
  woff: { badge: 'WOFF', glyph: 'Aa',  tint: '#8ab4ff', bg: '#0e1230' },
  woff2:{ badge: 'WOFF', glyph: 'Aa',  tint: '#8ab4ff', bg: '#0e1230' },
}
function fileKind(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return FILE_KINDS[ext] || { badge: (ext || 'FILE').toUpperCase().slice(0, 4), glyph: '', tint: '#9aa3b8', bg: '#161821' }
}

function FileTile({ file: f, previewPath }) {
  const name = f.name.split('/').pop()
  const k = fileKind(name)
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!previewPath) return
    let alive = true
    fetchThumb(previewPath, { w: 480, mode: 'logo' }).then(u => { if (alive) setSrc(u) }).catch(() => {})
    return () => { alive = false }
  }, [previewPath])
  return (
    <div className="media-img-tile">
      <div className="file-tile-preview" style={{ background: src ? '#f2f3f7' : k.bg }}>
        {src
          ? <img className="file-tile-img" src={src} alt={name} />
          : k.glyph
            ? <span className="file-tile-glyph" style={{ color: k.tint }}>{k.glyph}</span>
            : <DocIcon color={k.tint} />}
        <span className="file-tile-badge" style={{ background: k.tint }}>{k.badge}</span>
      </div>
      <div className="media-img-caption">
        <div className="media-img-info">
          <span className="media-img-name" title={name}>{name}</span>
          <span className="media-img-date">{fmtSize(f.size)}{f.lastModified ? ` · ${fmtDate(f.lastModified)}` : ''}</span>
        </div>
        <button className="icon-btn" onClick={() => downloadFile(f.path, name).catch(() => {})} title="Descargar" aria-label={`Descargar ${name}`}>
          <DownloadIcon />
        </button>
      </div>
    </div>
  )
}

function DocIcon({ color }) {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
    </svg>
  )
}

// ── Tipografía: especímenes de fuente en vivo (carga la fuente del blob) ──────
function Typography({ fonts }) {
  return (
    <section className="typo-section">
      <h2 className="logo-group-title">Tipografía<span className="logo-group-count">{fonts.length}</span></h2>
      {fonts.map(f => <FontSpecimen key={f.path} file={f} />)}
    </section>
  )
}

const TYPO_WEIGHTS = [
  { w: 300, l: 'Light' }, { w: 400, l: 'Regular' }, { w: 500, l: 'Medium' },
  { w: 600, l: 'SemiBold' }, { w: 700, l: 'Bold' }, { w: 800, l: 'ExtraBold' },
]
const TYPO_SAMPLE = 'Construcción e ingeniería civil'

function FontSpecimen({ file: f }) {
  const name = f.name.split('/').pop().replace(/\.[^.]+$/, '')
  const [family, setFamily] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { sasUrl } = await api.getSasUrl(f.path, 30)
        const fam = `mediafont-${f.path.replace(/[^a-z0-9]/gi, '')}`
        const face = new FontFace(fam, `url("${sasUrl}")`)
        await face.load()
        if (!alive) return
        document.fonts.add(face)
        setFamily(fam)
      } catch { if (alive) setFailed(true) }
    })()
    return () => { alive = false }
  }, [f.path])
  const style = family ? { fontFamily: `"${family}", var(--font-body)` } : {}
  return (
    <div className="typo-card">
      <div className="typo-head">
        <span className="typo-aa" style={style}>Aa</span>
        <div className="typo-meta">
          <span className="typo-name">{name}</span>
          <span className="typo-sub">{extOf(f.name).toUpperCase()} · {fmtSize(f.size)}{f.lastModified ? ` · ${fmtDate(f.lastModified)}` : ''}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadFile(f.path, f.name.split('/').pop()).catch(() => {})}>Descargar</button>
      </div>
      {failed
        ? <p className="typo-fail">No se pudo cargar la vista previa de esta fuente. Puedes descargarla.</p>
        : (
          <div className="typo-lines">
            {TYPO_WEIGHTS.map(wt => (
              <div key={wt.w} className="typo-line">
                <span className="typo-weight">{wt.l} {wt.w}</span>
                <span className="typo-sample" style={{ ...style, fontWeight: wt.w }}>{TYPO_SAMPLE}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

// ── Firmas / vista previa de HTML en un iframe aislado ────────────────────────
function HtmlPreviews({ files }) {
  return (
    <section className="html-section">
      <h2 className="logo-group-title">Vista previa<span className="logo-group-count">{files.length}</span></h2>
      <div className="html-grid">{files.map(f => <HtmlPreview key={f.path} file={f} />)}</div>
    </section>
  )
}

function HtmlPreview({ file: f }) {
  const name = f.name.split('/').pop()
  const [html, setHtml] = useState(null)
  const [failed, setFailed] = useState(false)
  const frameRef = useRef(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { sasUrl } = await api.getSasUrl(f.path, 15)
        const res = await fetch(sasUrl)
        if (!res.ok) throw new Error('fetch')
        const text = await res.text()
        if (alive) setHtml(text)
      } catch { if (alive) setFailed(true) }
    })()
    return () => { alive = false }
  }, [f.path])
  // Ajusta la altura del iframe al contenido para que la firma se vea COMPLETA
  // (sin scroll). Se remide tras cargar por si el logo tarda en llegar.
  function fit() {
    const el = frameRef.current
    if (!el) return
    try {
      const doc = el.contentDocument
      if (doc && doc.body) {
        const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight)
        if (h) el.style.height = `${h + 8}px`
      }
    } catch { /* origen opaco: se deja la altura por defecto */ }
  }
  function onFrameLoad() { fit(); setTimeout(fit, 400); setTimeout(fit, 1200) }
  return (
    <div className="html-card">
      <div className="html-card-head">
        <span className="media-img-name" title={name}>{name}</span>
        <button className="icon-btn" onClick={() => downloadFile(f.path, name).catch(() => {})} title="Descargar" aria-label={`Descargar ${name}`}>
          <DownloadIcon />
        </button>
      </div>
      <div className="html-frame-wrap">
        {failed
          ? <p className="typo-fail">No se pudo cargar la vista previa. Puedes descargar el archivo.</p>
          : html === null
            ? <div className="spinner" />
            : <iframe ref={frameRef} className="html-frame" sandbox="allow-same-origin" srcDoc={html} title={name} onLoad={onFrameLoad} />}
      </div>
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
