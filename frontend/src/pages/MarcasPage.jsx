// src/pages/MarcasPage.jsx
// Raíz de Marcas: cada carpeta de _media/marcas/ en el blob es un espacio de
// marca (RIPCONCIV, GEOFORCE, ...). El admin crea marcas nuevas desde aquí.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../utils/api'
import { useAuthz } from '../utils/authz'

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

export default function MarcasPage() {
  const { me } = useAuthz()
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState(null)

  function load() {
    setLoading(true)
    setError(null)
    api.listMediaFolders('marcas')
      .then(data => setFolders(Array.isArray(data?.folders) ? data.folders : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function createBrand() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setCreateMsg(null)
    try {
      await api.createMediaFolder('marcas', name)
      setNewName('')
      setCreateMsg({ ok: true, text: `Marca “${name}” creada. Ya puedes entrar y subir su contenido.` })
      load()
    } catch (e) {
      setCreateMsg({ ok: false, text: `No se pudo crear: ${e.message}` })
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Marcas</h1>
        <p className="page-sub">
          Un espacio por cada marca del grupo: su identidad, logos y material gráfico.
        </p>
      </div>

      {me?.isAdmin && (
        <div className="media-add">
          <input
            className="search-input"
            placeholder="Nombre de la nueva marca, p. ej. GEOFORCE"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !creating && createBrand()}
          />
          <button className="btn btn-primary" onClick={createBrand} disabled={creating || !newName.trim()}>
            {creating ? 'Creando...' : 'Nueva marca'}
          </button>
          {createMsg && (
            <span className={`media-add-msg ${createMsg.ok ? 'ok' : 'error'}`}>{createMsg.text}</span>
          )}
        </div>
      )}

      {loading && (
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
      {error && (
        <div className="loading" style={{ color: 'var(--red)' }}>
          No se pudieron cargar las marcas: {error}. Si acabas de actualizar, reinicia el backend.
        </div>
      )}

      {!loading && !error && folders.length === 0 && (
        <div className="empty">
          <div className="empty-text">Aún no hay marcas</div>
          <p className="access-empty-hint">
            {me?.isAdmin
              ? 'Crea la primera con el campo de arriba: se creará su carpeta en el almacenamiento.'
              : 'La persona administradora aún no ha creado espacios de marca.'}
          </p>
        </div>
      )}

      {!loading && !error && folders.length > 0 && (
        <div className="media-folder-grid">
          {folders.map(f => (
            <Link key={f.name} to={`/marcas/${encodeURIComponent(f.name)}`} className="media-folder-card">
              <div className="media-folder-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8A2 2 0 0 1 21 9.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
              </div>
              <div className="media-folder-name">{f.name}</div>
              <div className="media-folder-meta">
                {f.fileCount} archivo{f.fileCount !== 1 ? 's' : ''}
                {f.lastModified ? ` · ${timeAgo(f.lastModified)}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
