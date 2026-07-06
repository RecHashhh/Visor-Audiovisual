// src/pages/MediaSectionPage.jsx
// Explorador genérico de una sección de biblioteca (_media/<section>/): lista sus
// carpetas y permite crear nuevas (a quien tenga la capacidad manageMedia).
// Sirve para Marcas, Documentos, Videos, Eventos y Redes.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../utils/api'
import { useAuthz, hasCap, canItem } from '../utils/authz'
import { sectionById } from '../config/sections'

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

const NEW_LABEL = {
  marcas: 'Nueva marca', documentos: 'Nueva carpeta', videos: 'Nueva carpeta',
  eventos: 'Nuevo evento', redes: 'Nueva carpeta',
}
const NEW_PLACEHOLDER = {
  marcas: 'Nombre de la marca, p. ej. GEOFORCE',
  eventos: 'Nombre del evento, p. ej. Inauguración Puente 2026',
  default: 'Nombre de la carpeta',
}

export default function MediaSectionPage({ sectionId }) {
  const section = sectionById(sectionId)
  const { me } = useAuthz()
  const canCreate = hasCap(me, 'manageMedia')
  const [folders, setFolders] = useState(null)
  const [error, setError] = useState(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState(null)
  const inputRef = useRef(null)

  function load() {
    setError(null)
    api.listMediaFolders(sectionId)
      .then(d => setFolders(Array.isArray(d?.folders) ? d.folders : []))
      .catch(e => setError(e.message))
  }
  useEffect(() => { setFolders(null); load() }, [sectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    const name = newName.trim()
    if (!name) {
      // Antes el botón quedaba deshabilitado y el clic "no hacía nada"; ahora
      // guiamos al usuario al campo en vez de fallar en silencio.
      setMsg({ ok: false, text: 'Escribe primero el nombre en el campo de la izquierda.' })
      inputRef.current?.focus()
      return
    }
    setCreating(true); setMsg(null)
    try {
      await api.createMediaFolder(sectionId, name)
      setNewName('')
      setMsg({ ok: true, text: `“${name}” creada. Ya puedes entrar y subir su contenido.` })
      load()
    } catch (e) {
      setMsg({ ok: false, text: `No se pudo crear: ${e.message}` })
    } finally { setCreating(false) }
  }

  const visible = (folders || []).filter(f => canItem(me, sectionId, f.name))

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{section?.label || 'Biblioteca'}</h1>
        <p className="page-sub">{section?.description}</p>
      </div>

      {canCreate && (
        <div className="media-add">
          <div className="media-add-row">
            <input ref={inputRef} className="search-input"
              aria-label={NEW_LABEL[sectionId] || 'Nueva carpeta'}
              placeholder={NEW_PLACEHOLDER[sectionId] || NEW_PLACEHOLDER.default}
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !creating && create()} />
            <button className="btn btn-primary" onClick={create} disabled={creating}>
              {creating ? 'Creando...' : (NEW_LABEL[sectionId] || 'Nueva carpeta')}
            </button>
          </div>
          <p className="media-add-hint">
            Escribe el nombre y crea la carpeta; luego entra en ella para subir sus archivos.
          </p>
          {msg && <span className={`media-add-msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</span>}
        </div>
      )}

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
            {canCreate ? 'Crea la primera carpeta con el campo de arriba.' : 'Todavía no se ha subido contenido a esta sección.'}
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
    </>
  )
}
