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
  const [weeks, setWeeks] = useState([])
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getWeeks(id), api.getProjects()])
      .then(([w, projects]) => {
        setWeeks(w)
        setProject(projects.find(p => p.code === id))
      })
      .finally(() => setLoading(false))
  }, [id])

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Proyectos</Link>
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
          {weeks.length} semanas registradas
          {project?.status && ` · ${project.status}`}
        </p>
      </div>

      {loading && <div className="loading"><div className="spinner"/></div>}
      {!loading && weeks.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📅</div>
          <div className="empty-text">Sin semanas registradas en BLOB</div>
        </div>
      )}

      {!loading && weeks.length > 0 && (
        <div className="week-list">
          {weeks.map(w => (
            <div key={w.week} className="week-row" onClick={() => nav(`/project/${id}/week/${w.week}`)}>
              <div className="week-label">{w.week}</div>
              <div className="week-badges">
                {(w.types || []).map(t => (
                  <span key={t} className={`badge ${TYPE_BADGE[t] || 'badge-dim'}`}>{t}</span>
                ))}
              </div>
              <div className="week-count">{w.count} archivos</div>
              <div className="week-arrow">›</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
