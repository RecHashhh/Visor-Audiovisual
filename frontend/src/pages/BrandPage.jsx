// src/pages/BrandPage.jsx
// Espacio de una marca: archivos que viven en _media/marcas/<marca>/ del blob.
// Si los archivos siguen la convención de logos (formato-fondo-color) aparece
// la galería con filtros; el resto se lista como archivos descargables.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../utils/api'
import { fetchThumb } from '../utils/thumbs'
import { useAuthz } from '../utils/authz'

const FORMAT_LABEL = {
  centrada: 'Centrada',
  horizontal: 'Horizontal',
  simbolo: 'Símbolo',
  'tagline-centrada': 'Tagline centrada',
  'tagline-horizontal': 'Tagline horizontal',
  'tagline-logotipo': 'Tagline + logotipo',
}
const BACKGROUND_LABEL = { positivo: 'Positivo', negativo: 'Negativo' }
// _b = versión BLANCA (logo blanco con transparencia); _bn = monocromo negro
const COLOR_LABEL = { azul: 'Azul', bn: 'Blanco y negro', b: 'Blanco' }
const FORMAT_ORDER = ['centrada', 'horizontal', 'simbolo', 'tagline-centrada', 'tagline-horizontal', 'tagline-logotipo']
const VARIANT_RE = /^(tagline-centrada|tagline-horizontal|tagline-logotipo|centrada|horizontal|simbolo)-(positivo|negativo)-(azul|bn|b)$/

function parseVariant(file) {
  if (file.name.includes('/')) return null
  const base = file.name.toLowerCase().replace(/\.[^.]+$/, '')
  const m = base.match(VARIANT_RE)
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
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export default function BrandPage() {
  const { brandId } = useParams()
  const { me } = useAuthz()
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
    setLoading(true)
    setError(null)
    api.getMediaFolder('marcas', brandId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [brandId]) // eslint-disable-line react-hooks/exhaustive-deps

  const files = data?.files || []
  const variants = useMemo(() => files.map(parseVariant).filter(Boolean), [files])
  const variantPaths = useMemo(() => new Set(variants.map(v => v.path)), [variants])
  const otherFiles = files.filter(f => !variantPaths.has(f.path))
  const meta = data?.meta
  const hasFilters = format !== 'all' || background !== 'all' || color !== 'all'

  const filtered = variants.filter(v =>
    (format === 'all' || v.format === format) &&
    (background === 'all' || v.background === background) &&
    (color === 'all' || v.color === color)
  )

  async function onUploadFiles(e) {
    const chosen = e.target.files
    if (!chosen || chosen.length === 0) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const res = await api.uploadMediaFiles('marcas', brandId, chosen)
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

  if (loading) return <div className="loading"><div className="spinner" /><span>Cargando {brandId}...</span></div>
  if (error) {
    return (
      <>
        <div className="breadcrumb">
          <Link to="/marcas">Marcas</Link>
          <span className="sep">›</span>
          <span className="current">{brandId}</span>
        </div>
        <div className="loading" style={{ color: 'var(--red)' }}>No se pudo cargar la marca: {error}</div>
      </>
    )
  }

  return (
    <>
      <div className="breadcrumb">
        <Link to="/marcas">Marcas</Link>
        <span className="sep">›</span>
        <span className="current">{meta?.name || brandId}</span>
      </div>

      <div className="page-header brand-page-header">
        <div>
          <h1 className="page-title">{meta?.name || brandId}</h1>
          <p className="page-sub">
            {meta?.tagline || `${files.length} archivo${files.length !== 1 ? 's' : ''} en esta marca`}
          </p>
        </div>
        {me?.isAdmin && (
          <div className="brand-upload">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={onUploadFiles}
            />
            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Subiendo...' : 'Subir archivos'}
            </button>
            {uploadMsg && (
              <span className={`media-add-msg ${uploadMsg.ok ? 'ok' : 'error'}`}>{uploadMsg.text}</span>
            )}
          </div>
        )}
      </div>

      {meta?.archetype && (
        <div className="brand-archetype">
          <div className="brand-archetype-showcase">
            <BrandShowcase variants={variants} brandName={meta?.name || brandId} />
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
          <div className="empty-text">Esta marca aún no tiene archivos</div>
          <p className="access-empty-hint">
            {me?.isAdmin
              ? 'Usa "Subir archivos" para agregar logos, plantillas o material gráfico.'
              : 'Todavía no se ha subido contenido a este espacio.'}
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
                {FORMAT_ORDER.filter(f => variants.some(v => v.format === f)).map(f => (
                  <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
                ))}
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
            {hasFilters && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setFormat('all'); setBackground('all'); setColor('all') }}
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {filtered.length === 0
            ? (
              <div className="empty">
                <div className="empty-text">Ninguna variante coincide con esos filtros</div>
              </div>
            )
            : FORMAT_ORDER.map(fo => {
                const group = filtered.filter(v => v.format === fo)
                if (group.length === 0) return null
                return (
                  <section key={fo} className="logo-group">
                    <h2 className="logo-group-title">
                      {FORMAT_LABEL[fo]}
                      <span className="logo-group-count">{group.length}</span>
                    </h2>
                    <div className="logo-grid">
                      {group.map(v => <LogoTile key={v.path} variant={v} brandName={meta?.name || brandId} />)}
                    </div>
                  </section>
                )
              })}
        </>
      )}

      {otherFiles.length > 0 && (
        <section className="logo-group">
          <h2 className="logo-group-title">
            {variants.length > 0 ? 'Otros archivos' : 'Archivos'}
            <span className="logo-group-count">{otherFiles.length}</span>
          </h2>
          <div className="media-file-list">
            {otherFiles.map(f => <MediaFileRow key={f.path} file={f} />)}
          </div>
        </section>
      )}
    </>
  )
}

/* Muestra el logo horizontal (o el primero disponible) en el panel del arquetipo */
function BrandShowcase({ variants, brandName }) {
  const pick =
    variants.find(v => v.format === 'horizontal' && v.background === 'positivo' && v.color === 'azul') ||
    variants.find(v => v.background === 'positivo') ||
    variants[0]
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (!pick) return
    let alive = true
    fetchThumb(pick.path, { w: 560, mode: 'logo' })
      .then(url => { if (alive) setSrc(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [pick?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pick) return null
  return src ? <img src={src} alt={`Logo de ${brandName}`} /> : <div className="spinner" />
}

function sampleCornerColor(imgEl) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgEl, 0, 0)
    const d = ctx.getImageData(1, 1, 1, 1).data
    if (d[3] < 250) return null // transparente: usa el escenario claro por defecto
    return `rgb(${d[0]},${d[1]},${d[2]})`
  } catch {
    return null
  }
}

function LogoTile({ variant: v, brandName }) {
  const [src, setSrc] = useState(null)
  const [bg, setBg] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    fetchThumb(v.path, { w: 560, mode: 'logo' })
      .then(url => { if (alive) setSrc(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [v.path])

  // Fondo del escenario: el color exacto muestreado del arte (opacos) o,
  // para logos blancos transparentes (_b), un escenario oscuro fijo.
  const stageBg = bg || (v.color === 'b' ? '#14161f' : null)

  return (
    <div className="logo-tile">
      <div className="logo-tile-preview" style={stageBg ? { background: stageBg } : undefined}>
        {src && (
          <img
            className={`img-fade ${loaded ? 'is-loaded' : ''}`}
            src={src}
            alt={`${brandName} — ${v.formatLabel}, ${v.backgroundLabel}, ${v.colorLabel}`}
            onLoad={e => { setBg(sampleCornerColor(e.target)); setLoaded(true) }}
          />
        )}
      </div>
      <div className="logo-tile-caption">
        <div className="logo-tile-info">
          <span className="logo-tile-name">{v.backgroundLabel} · {v.colorLabel}</span>
          <span className="logo-tile-meta">PNG · alta resolución</span>
        </div>
        <button
          className="icon-btn"
          onClick={() => downloadFile(v.path, v.name).catch(() => {})}
          aria-label={`Descargar ${brandName} ${v.formatLabel} ${v.backgroundLabel} ${v.colorLabel}`}
          title="Descargar original"
        >
          <DownloadIcon />
        </button>
      </div>
    </div>
  )
}

function MediaFileRow({ file: f }) {
  const sizeMb = f.size > 1024 * 1024
    ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(f.size / 1024))} KB`

  return (
    <div className="media-file-row">
      <span className="media-file-name">{f.name}</span>
      <span className="media-file-meta">{sizeMb}</span>
      <button
        className="icon-btn"
        onClick={() => downloadFile(f.path, f.name.split('/').pop()).catch(() => {})}
        aria-label={`Descargar ${f.name}`}
        title="Descargar"
      >
        <DownloadIcon />
      </button>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11" />
      <path d="M4.5 19.5h15" />
    </svg>
  )
}
