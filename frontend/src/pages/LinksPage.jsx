// src/pages/LinksPage.jsx
// Sección de enlaces (Redes Sociales): NO tiene carpetas. Es una lista de links
// oficiales de la empresa, cada uno con su tarjeta de preview (icono + color de
// la red). Quien tenga manageMedia puede agregar, editar y quitar.
import { useEffect, useMemo, useState } from 'react'
import { api } from '../utils/api'
import { useAuthz, hasCap } from '../utils/authz'
import { sectionById } from '../config/sections'
import Modal from '../components/Modal'

// ── Iconos de marca (blancos, sobre el color de la red) ──────────────────────
const IgIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" />
    <circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)
const FbIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5H17V4c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2V10H8v3h2.5v8z" /></svg>
)
const LiIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.94 6.5A1.94 1.94 0 1 1 5 4.56 1.94 1.94 0 0 1 6.94 6.5zM5.3 8.4h3.3V21H5.3zM10.6 8.4h3.16v1.72h.05c.44-.83 1.5-1.72 3.1-1.72 3.3 0 3.9 2.17 3.9 5V21h-3.3v-4.45c0-1.06 0-2.42-1.48-2.42s-1.7 1.15-1.7 2.34V21h-3.3z" /></svg>
)
const YtIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.2-.4-4.7a2.5 2.5 0 0 0-1.76-1.77C19.24 5.1 12 5.1 12 5.1s-7.24 0-8.84.43A2.5 2.5 0 0 0 1.4 7.3C1 8.8 1 12 1 12s0 3.2.4 4.7a2.5 2.5 0 0 0 1.76 1.77c1.6.43 8.84.43 8.84.43s7.24 0 8.84-.43a2.5 2.5 0 0 0 1.76-1.77C23 15.2 23 12 23 12zM9.75 15.02V8.98L15 12z" /></svg>
)
const TkIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 3c.3 2.3 1.6 3.7 3.8 3.85V9.4c-1.3.13-2.44-.3-3.77-1.1v4.87c0 4.9-5.34 6.43-7.48 2.92-1.38-2.26-.53-6.22 3.9-6.38v2.66c-.34.05-.7.14-1.03.25-1 .34-1.56 1-1.4 2.1.3 2.13 4.2 2.76 3.88-1.42V3z" /></svg>
)
const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.3 8.3L23 22h-6.5l-5.1-6.6L5.6 22H2.5l7.8-8.9L1.5 2h6.7l4.6 6.1zm-1.1 18.2h1.7L7.1 3.7H5.3z" /></svg>
)
const WaIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.25-.13-1.47-.72-1.7-.8-.23-.09-.4-.13-.56.13s-.64.8-.79.97-.29.19-.54.06a6.7 6.7 0 0 1-2-1.23 7.4 7.4 0 0 1-1.36-1.7c-.14-.24 0-.37.11-.5l.37-.44c.12-.15.16-.25.25-.42a.46.46 0 0 0 0-.44c-.06-.13-.56-1.35-.77-1.85s-.4-.42-.56-.43h-.48a.92.92 0 0 0-.66.31 2.78 2.78 0 0 0-.87 2.07 4.83 4.83 0 0 0 1 2.56 11 11 0 0 0 4.2 3.7c.59.26 1.05.41 1.4.52a3.4 3.4 0 0 0 1.55.1c.47-.07 1.47-.6 1.68-1.18s.2-1.08.14-1.18-.22-.16-.47-.28z" /></svg>
)
const TgIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.7 19.4c-.24 1.06-.87 1.32-1.76.82l-4.86-3.58-2.35 2.26c-.26.26-.48.48-.98.48l.35-4.94L18.02 6.4c.4-.35-.08-.55-.6-.2L6.28 13.3l-4.8-1.5c-1.04-.33-1.06-1.04.22-1.54l18.76-7.23c.87-.32 1.63.2 1.44 1.27z" /></svg>
)
const WebIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
)

const NETWORKS = {
  instagram: { label: 'Instagram', color: 'linear-gradient(135deg,#833AB4,#E1306C 55%,#FCB045)', Icon: IgIcon },
  facebook:  { label: 'Facebook',  color: '#1877F2', Icon: FbIcon },
  linkedin:  { label: 'LinkedIn',  color: '#0A66C2', Icon: LiIcon },
  youtube:   { label: 'YouTube',   color: '#FF0000', Icon: YtIcon },
  tiktok:    { label: 'TikTok',    color: '#111827', Icon: TkIcon },
  x:         { label: 'X',         color: '#111827', Icon: XIcon },
  whatsapp:  { label: 'WhatsApp',  color: '#25D366', Icon: WaIcon },
  telegram:  { label: 'Telegram',  color: '#26A5E4', Icon: TgIcon },
  website:   { label: 'Sitio web', color: '#334155', Icon: WebIcon },
}
const NET_ORDER = ['website', 'instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'x', 'whatsapp', 'telegram']

function detectNetwork(url) {
  const u = (url || '').toLowerCase()
  if (u.includes('instagram.com')) return 'instagram'
  if (u.includes('facebook.com') || u.includes('fb.com') || u.includes('fb.me')) return 'facebook'
  if (u.includes('linkedin.com')) return 'linkedin'
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  if (u.includes('tiktok.com')) return 'tiktok'
  if (u.includes('twitter.com') || u.includes('x.com')) return 'x'
  if (u.includes('wa.me') || u.includes('whatsapp.com')) return 'whatsapp'
  if (u.includes('t.me') || u.includes('telegram')) return 'telegram'
  return 'website'
}

// Reduce una imagen local a un JPEG pequeño (data URL) para guardarla junto al
// enlace sin depender de SAS ni de que la red permita leer su foto.
function fileToThumb(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')) }
    img.src = url
  })
}

// "instagram.com/ripconciv/" → "@ripconciv"; si no hay handle, el dominio.
function handleFrom(url, net) {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean)[0]
    if (seg && net !== 'website') return '@' + decodeURIComponent(seg).replace(/^@/, '')
    return u.hostname.replace(/^www\./, '')
  } catch { return url }
}

export default function LinksPage({ sectionId }) {
  const section = sectionById(sectionId)
  const { me } = useAuthz()
  const canManage = hasCap(me, 'manageMedia')

  const [links, setLinks] = useState(null)     // null = cargando
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState(null) // { idx, url, title, network } | null
  const [formErr, setFormErr] = useState(null)

  function load() {
    setError(null)
    api.getSectionLinks(sectionId)
      .then(d => setLinks(Array.isArray(d?.links) ? d.links : []))
      .catch(e => setError(e.message))
  }
  useEffect(() => { setLinks(null); load() }, [sectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setFormErr(null); setEditing({ idx: -1, url: '', title: '', network: 'auto', image: '' }) }
  function openEdit(i) {
    const l = links[i]
    setFormErr(null)
    setEditing({ idx: i, url: l.url, title: l.title || '', network: l.network || 'auto', image: l.image || '' })
  }

  async function onPickImage(e) {
    const f = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!f) return
    setFormErr(null)
    try {
      const data = await fileToThumb(f)
      setEditing(ed => (ed ? { ...ed, image: data } : ed))
    } catch { setFormErr('No se pudo leer la imagen.') }
  }

  async function persist(next) {
    setSaving(true); setFormErr(null)
    try {
      const res = await api.saveSectionLinks(sectionId, next)
      setLinks(Array.isArray(res?.links) ? res.links : next)
      setEditing(null)
    } catch (e) {
      setFormErr(`No se pudo guardar: ${e.message}`)
    } finally { setSaving(false) }
  }

  function saveForm() {
    const url = editing.url.trim()
    if (!/^https?:\/\//i.test(url)) { setFormErr('Pega un enlace válido que empiece por http:// o https://'); return }
    const net = editing.network === 'auto' ? detectNetwork(url) : editing.network
    const item = { url, title: editing.title.trim(), network: net, image: editing.image || '' }
    const next = editing.idx >= 0
      ? links.map((l, i) => (i === editing.idx ? { ...l, ...item } : l))
      : [...(links || []), item]
    persist(next)
  }

  function remove(i) {
    const l = links[i]
    if (!window.confirm(`¿Quitar el enlace de ${NETWORKS[l.network]?.label || 'esta red'}?`)) return
    persist(links.filter((_, idx) => idx !== i))
  }

  const detected = editing ? (editing.network === 'auto' ? detectNetwork(editing.url) : editing.network) : 'website'

  return (
    <>
      <div className="page-header brand-page-header">
        <div>
          <h1 className="page-title">{section?.label || 'Redes Sociales'}</h1>
          <p className="page-sub">{section?.description}</p>
        </div>
        {canManage && <button className="btn btn-primary" onClick={openNew}>Agregar enlace</button>}
      </div>

      {links === null && !error && (
        <div className="links-grid" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="link-card link-card-skel">
              <div className="skel skel-banner" />
              <div className="link-card-body">
                <div className="skel skel-line" style={{ width: '50%' }} />
                <div className="skel skel-line" style={{ width: '70%' }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div className="alert alert-error" role="alert">No se pudo cargar: {error}. Si acabas de actualizar, reinicia el backend.</div>}

      {links !== null && !error && links.length === 0 && (
        <div className="empty">
          <div className="empty-text">Aún no hay redes sociales</div>
          <p className="access-empty-hint">
            {canManage ? 'Agrega el primer enlace con el botón “Agregar enlace”.' : 'Todavía no se han publicado las redes de la empresa.'}
          </p>
        </div>
      )}

      {links !== null && links.length > 0 && (
        <div className="links-grid">
          {links.map((l, i) => {
            const net = NETWORKS[l.network] || NETWORKS.website
            const Icon = net.Icon
            return (
              <div key={l.id || i} className="link-card">
                <a className="link-card-hit" href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.image ? (
                    <div className="link-card-banner has-img" style={{ backgroundImage: `url(${l.image})` }}>
                      <span className="link-card-badge" style={{ background: net.color }}><Icon /></span>
                    </div>
                  ) : (
                    <div className="link-card-banner" style={{ background: net.color }}>
                      <span className="link-card-glyph"><Icon /></span>
                    </div>
                  )}
                  <div className="link-card-body">
                    <div className="link-card-title">{l.title || net.label}</div>
                    <div className="link-card-handle">{handleFrom(l.url, l.network)}</div>
                  </div>
                </a>
                {canManage && (
                  <div className="link-card-actions">
                    <button className="link-card-btn" title="Editar" onClick={() => openEdit(i)} aria-label="Editar enlace">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    </button>
                    <button className="link-card-btn" title="Quitar" onClick={() => remove(i)} aria-label="Quitar enlace">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => !saving && setEditing(null)}
        title={editing?.idx >= 0 ? 'Editar enlace' : 'Agregar enlace'}
        subtitle={`En ${section?.label}`}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={saveForm} disabled={saving || !editing?.url.trim()}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </>}
      >
        {editing && (
          <>
            <div className="link-preview">
              <span className="link-preview-glyph"
                style={editing.image
                  ? { backgroundImage: `url(${editing.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: NETWORKS[detected]?.color }}>
                {!editing.image && (() => { const P = NETWORKS[detected]?.Icon || WebIcon; return <P /> })()}
              </span>
              <div>
                <div className="link-preview-net">{NETWORKS[detected]?.label}</div>
                <div className="link-preview-handle">{editing.url ? handleFrom(editing.url, detected) : 'vista previa'}</div>
              </div>
            </div>
            <label className="field">
              <span className="field-label">Enlace (URL)</span>
              <input
                className="field-input" autoFocus value={editing.url}
                placeholder="https://instagram.com/ripconciv"
                onChange={e => setEditing({ ...editing, url: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' && editing.url.trim()) saveForm() }}
              />
              <span className="field-help">La red se detecta sola por el enlace.</span>
            </label>
            <label className="field">
              <span className="field-label">Nombre a mostrar <span className="field-opt">(opcional)</span></span>
              <input
                className="field-input" value={editing.title}
                placeholder={NETWORKS[detected]?.label}
                onChange={e => setEditing({ ...editing, title: e.target.value })}
              />
            </label>
            <div className="field">
              <span className="field-label">Imagen propia <span className="field-opt">(opcional)</span></span>
              <div className="link-img-row">
                {editing.image
                  ? <img className="link-img-thumb" src={editing.image} alt="" />
                  : <div className="link-img-thumb link-img-empty">Sin imagen</div>}
                <div className="link-img-btns">
                  <label className="btn btn-ghost btn-sm">
                    {editing.image ? 'Cambiar imagen' : 'Subir imagen'}
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
                  </label>
                  {editing.image && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...editing, image: '' })}>Quitar</button>
                  )}
                </div>
              </div>
              <span className="field-help">Si subes una, reemplaza el icono de la red en la tarjeta.</span>
            </div>
            <label className="field">
              <span className="field-label">Red</span>
              <select className="field-input" value={editing.network}
                onChange={e => setEditing({ ...editing, network: e.target.value })}>
                <option value="auto">Detectar automáticamente</option>
                {NET_ORDER.map(k => <option key={k} value={k}>{NETWORKS[k].label}</option>)}
              </select>
            </label>
            {formErr && <div className="field-error" style={{ marginTop: 4 }}>{formErr}</div>}
          </>
        )}
      </Modal>
    </>
  )
}
