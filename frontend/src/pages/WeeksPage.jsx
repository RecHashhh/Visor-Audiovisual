// src/pages/WeeksPage.jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../utils/api'

const TYPE_BADGE = {
  DRN: 'badge-orange', FOT: 'badge-blue', VID: 'badge-red',
  E360: 'badge-accent', I360: 'badge-dim',
}

export default function WeeksPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [browse, setBrowse] = useState({ folders: [], files: [] })
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getBrowse(id, ''), api.getProjects()])
      .then(([tree, projects]) => {
        setBrowse(tree || { folders: [], files: [] })
        setProject(projects.find(p => p.code === id))
      })
      .finally(() => setLoading(false))
  }, [id])

  return (
    <>
      <div className="breadcrumb">
        <Link to="/proyectos">Proyectos</Link>
        <span className="sep">›</span>
        <span className="current">{project?.name || id}</span>
      </div>

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
          <h1 className="page-title project-code-title" style={{ fontSize: '1.3rem' }}>
            <span>{id}</span>
          </h1>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text)' }}>
            {project?.name}
          </span>
        </div>
        <p className="page-sub">
          {browse.folders.length} carpetas · {browse.files.length} archivos directos
          {project?.status && ` · ${project.status}`}
        </p>
      </div>

      {loading && <div className="loading"><div className="spinner"/></div>}
      {!loading && browse.folders.length === 0 && browse.files.length === 0 && (
        <div className="empty">
          
          <div className="empty-text">Sin carpetas registradas en BLOB</div>
        </div>
      )}

      {!loading && (browse.folders.length > 0 || browse.files.length > 0) && (
        <div className="week-list">
          {browse.folders.map(folder => (
            <div key={folder.path} className="week-row" onClick={() => nav(`/proyectos/project/${id}/week/${encodeURIComponent(folder.path)}`)}>
              <div className="week-label">{folder.name}</div>
              <div className="week-badges">
                {(folder.types || []).map(t => (
                  <span key={t} className={`badge ${TYPE_BADGE[t] || 'badge-dim'}`}>{t}</span>
                ))}
              </div>
              <div className="week-count">{folder.count} archivos</div>
              <div className="week-arrow">›</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
