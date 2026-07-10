// src/pages/MediaSectionPage.jsx
// Explorador genérico de una sección de biblioteca (_media/<section>/): lista sus
// carpetas y permite crear nuevas (a quien tenga la capacidad manageMedia).
// Sirve para Marcas, Documentos, Videos, Eventos y Redes.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../utils/api'
import { useAuthz, hasCap, canItem } from '../utils/authz'
import { sectionById } from '../config/sections'
import Modal from '../components/Modal'

function timeAgo(iso) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) return `Hace ${days} días`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  return `Hace ${months} mes${months > 1 ? 'es' : ''}`
}

// Qué pide el modal de "crear" según la sección.
const NEW_FIELDS = {
  marcas:     { btn: 'Nueva marca',   title: 'Nueva marca',   label: 'Nombre de la marca',   placeholder: 'p. ej. GEOFORCE',                 help: 'Se crea una carpeta para los logos y el material de esta marca.' },
  eventos:    { btn: 'Nuevo evento',  title: 'Nuevo evento',  label: 'Nombre del evento',    placeholder: 'p. ej. Inauguración Puente 2026', help: 'Agrupa las fotos y videos de un evento.' },
  documentos: { btn: 'Nueva carpeta', title: 'Nueva carpeta', label: 'Nombre de la carpeta', placeholder: 'p. ej. Plantillas de correo',     help: 'Agrupa documentos o plantillas.' },
  videos:     { btn: 'Nueva carpeta', title: 'Nueva carpeta', label: 'Nombre de la carpeta', placeholder: 'p. ej. Institucional 2026',       help: 'Agrupa videos por tema o campaña.' },
  redes:      { btn: 'Nueva carpeta', title: 'Nueva carpeta', label: 'Nombre de la carpeta', placeholder: 'p. ej. Campaña julio',            help: 'Agrupa piezas para redes sociales.' },
  politicas:  { btn: 'Nueva carpeta', title: 'Nueva carpeta', label: 'Nombre de la carpeta', placeholder: 'p. ej. Seguridad y salud',       help: 'Agrupa políticas, normativas y reglamentos.' },
}
const DEFAULT_FIELDS = { btn: 'Nueva carpeta', title: 'Nueva carpeta', label: 'Nombre de la carpeta', placeholder: 'Nombre de la carpeta', help: '' }

export default function MediaSectionPage({ sectionId }) {
  const section = sectionById(sectionId)
  const cfg = NEW_FIELDS[sectionId] || DEFAULT_FIELDS
  const navigate = useNavigate()
  const { me } = useAuthz()
  const canCreate = hasCap(me, 'manageMedia')
  const [folders, setFolders] = useState(null)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [addFicha, setAddFicha] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  function load() {
    setError(null)
    api.listMediaFolders(sectionId)
      .then(d => setFolders(Array.isArray(d?.folders) ? d.folders : []))
      .catch(e => setError(e.message))
  }
  useEffect(() => { setFolders(null); load() }, [sectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  function openModal() { setNewName(''); setAddFicha(false); setErr(null); setModalOpen(true) }

  async function create() {
    const name = newName.trim()
    if (!name) { setErr('Escribe un nombre.'); return }
    setCreating(true); setErr(null)
    try {
      const res = await api.createMediaFolder(sectionId, name)
      setModalOpen(false)
      if (addFicha) {
        navigate(`${section.path}/${encodeURIComponent(res?.path || name)}?ficha=1`)
        return
      }
      setMsg({ ok: true, text: `“${name}” creada. Entra en ella para subir su contenido.` })
      load()
    } catch (e) {
      setErr(`No se pudo crear: ${e.message}`)
    } finally { setCreating(false) }
  }

  const visible = (folders || []).filter(f => canItem(me, sectionId, f.name))

  return (
    <>
      <div className="page-header brand-page-header">
        <div>
          <h1 className="page-title">{section?.label || 'Biblioteca'}</h1>
          <p className="page-sub">{section?.description}</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={openModal}>{cfg.btn}</button>
        )}
      </div>

      {msg && <div className={`media-add-msg ${msg.ok ? 'ok' : 'error'}`} style={{ display: 'block', marginBottom: 16 }}>{msg.text}</div>}

      {folders === null && !error && (
        <div className="media-folder-grid" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="media-folder-skel">
              <div className="skel skel-icon" />
              <div className="skel skel-line" style={{ width: '55%' }} />
              <div className="skel skel-line" style={{ width: '38%' }} />
            </div>
          ))}
        </div>
      )}
      {error && <div className="alert alert-error" role="alert">No se pudo cargar: {error}. Si acabas de actualizar, reinicia el backend.</div>}

      {folders !== null && !error && visible.length === 0 && (
        <div className="empty">
          <div className="empty-text">Aún no hay contenido</div>
          <p className="access-empty-hint">
            {canCreate ? `Crea la primera con el botón “${cfg.btn}”.` : 'Todavía no se ha subido contenido a esta sección.'}
          </p>
        </div>
      )}

      {folders !== null && visible.length > 0 && (
        <div className="media-folder-grid">
          {visible.map(f => (
            <Link key={f.name} to={`${section.path}/${encodeURIComponent(f.name)}`} className="media-folder-card">
              <div className="media-folder-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8A2 2 0 0 1 21 9.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
              </div>
              <div className="media-folder-name">{f.name}</div>
              <div className="media-folder-meta">
                {f.fileCount} archivo{f.fileCount !== 1 ? 's' : ''}{f.lastModified ? ` · ${timeAgo(f.lastModified)}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !creating && setModalOpen(false)}
        title={cfg.title}
        subtitle={`En ${section?.label}`}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setModalOpen(false)} disabled={creating}>Cancelar</button>
          <button className="btn btn-primary" onClick={create} disabled={creating || !newName.trim()}>
            {creating ? 'Creando...' : 'Crear'}
          </button>
        </>}
      >
        <label className="field">
          <span className="field-label">{cfg.label}</span>
          <input
            className="field-input"
            autoFocus
            value={newName}
            placeholder={cfg.placeholder}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !creating && newName.trim()) create() }}
          />
          {cfg.help && <span className="field-help">{cfg.help}</span>}
          {err && <span className="field-error">{err}</span>}
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" checked={addFicha} onChange={e => setAddFicha(e.target.checked)} />
          <span>Agregar ficha (descripción, colores{sectionId === 'marcas' ? ', arquetipo' : ''}…) al crear</span>
        </label>
      </Modal>
    </>
  )
}
