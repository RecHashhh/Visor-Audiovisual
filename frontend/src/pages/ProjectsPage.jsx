// src/pages/ProjectsPage.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../utils/api'

const PREFIX_COLORS = {
  DRN: 'badge-orange', FOT: 'badge-blue', VID: 'badge-red',
  E360: 'badge-accent', I360: 'badge-dim',
}
const STATUS_INFO = {
  completo:  { cls: 'badge-green',  label: '✅ Completo' },
  subiendo:  { cls: 'badge-orange', label: '⏳ Subiendo' },
  pendiente: { cls: 'badge-red',    label: '🔴 Pendiente' },
}

function statusInfo(s = '') {
  const sl = s.toLowerCase()
  if (sl.includes('completo') || sl.includes('complete')) return STATUS_INFO.completo
  if (sl.includes('subiendo') || sl.includes('uploading')) return STATUS_INFO.subiendo
  return STATUS_INFO.pendiente
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const nav = useNavigate()

  useEffect(() => {
    api.getProjects()
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const visibleProjects = projects.filter(p => p.hasContent !== false)
  const pendingProjects = projects.filter(p => statusInfo(p.status) === STATUS_INFO.pendiente)
  const pendingNames = pendingProjects.map(p => p.name || p.code).join(' • ')

  const filtered = visibleProjects.filter(p => {
    const q = search.toLowerCase()
    const match = p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q)
    if (!match) return false
    if (filter === 'all') return true
    const si = statusInfo(p.status)
    if (filter === 'done') return si === STATUS_INFO.completo
    if (filter === 'pending') return si === STATUS_INFO.pendiente
    if (filter === 'uploading') return si === STATUS_INFO.subiendo
    return true
  })

  const counts = {
    all: projects.length,
    done: projects.filter(p => statusInfo(p.status) === STATUS_INFO.completo).length,
    uploading: projects.filter(p => statusInfo(p.status) === STATUS_INFO.subiendo).length,
    pending: pendingProjects.length,
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Proyectos <span>Audiovisuales</span></h1>
        <p className="page-sub">Azure Blob Storage · container audiovisual</p>
      </div>

      <div className="stats-bar">
        <div className="stat-box">
          <div className="stat-num">{counts.all}</div>
          <div className="stat-lbl">Total proyectos</div>
        </div>
        <div className="stat-box">
          <div className="stat-num" style={{ color: 'var(--green)' }}>{counts.done}</div>
          <div className="stat-lbl">En BLOB ✅</div>
        </div>
        <div className="stat-box">
          <div className="stat-num" style={{ color: 'var(--orange)' }}>{counts.uploading}</div>
          <div className="stat-lbl">Subiendo ⏳</div>
        </div>
        <div className="stat-box">
          <div className="stat-num" style={{ color: 'var(--red)' }}>{counts.pending}</div>
          <div className="stat-lbl" title={pendingNames || 'No hay proyectos pendientes'}>Pendientes 🔴</div>
        </div>
      </div>

      <div className="search-row">
        <input
          className="search-input"
          placeholder="Buscar por código o nombre..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {[
          { key: 'all',      label: `Todos (${counts.all})` },
          { key: 'done',     label: `✅ En BLOB (${counts.done})` },
          { key: 'uploading',label: `⏳ Subiendo (${counts.uploading})` },
          { key: 'pending',  label: `🔴 Pendiente (${counts.pending})` },
        ].map(f => (
          <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`}
            title={f.key === 'pending' ? (pendingNames || 'No hay proyectos pendientes') : undefined}
            onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="loading"><div className="spinner" /><span>Cargando proyectos...</span></div>}
      {error   && <div className="loading" style={{ color: 'var(--red)' }}>⚠ {error}</div>}

      {!loading && !error && (
        filtered.length === 0
          ? <div className="empty"><div className="empty-icon">📂</div><div className="empty-text">Sin resultados</div></div>
          : <div className="project-grid">
              {filtered.map(p => <ProjectCard key={p.code} project={p} onClick={() => nav(`/project/${p.code}`)} />)}
            </div>
      )}
    </>
  )
}

function ProjectCard({ project: p, onClick }) {
  const si = statusInfo(p.status)
  const types = (p.types || '').split('+').filter(Boolean)

  return (
    <div className="project-card" onClick={onClick}>
      <div className="project-card-code">{p.code}</div>
      <div className="project-card-name">{p.name}</div>
      <div className="project-card-meta">
        <span className={`badge ${si.cls}`}>{si.label}</span>
        {types.map(t => (
          <span key={t} className={`badge ${PREFIX_COLORS[t] || 'badge-dim'}`}>{t}</span>
        ))}
        {p.weeks > 0 && <span className="badge badge-dim">{p.weeks}w</span>}
      </div>
    </div>
  )
}
