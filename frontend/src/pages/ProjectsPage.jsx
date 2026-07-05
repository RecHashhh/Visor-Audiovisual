// src/pages/ProjectsPage.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../utils/api'
import { fetchThumb } from '../utils/thumbs'

const PREFIX_COLORS = {
  DRN: 'badge-orange', FOT: 'badge-blue', VID: 'badge-red',
  E360: 'badge-accent', I360: 'badge-dim',
}
const STATUS_INFO = {
  completo:  { cls: 'badge-green',  label: 'Completo' },
  subiendo:  { cls: 'badge-orange', label: 'Subiendo' },
  pendiente: { cls: 'badge-red',    label: 'Pendiente' },
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
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [refreshMsgIsError, setRefreshMsgIsError] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const nav = useNavigate()

  async function loadProjects({ silent = false } = {}) {
    if (!silent) {
      setLoading(true)
      setError(null)
    }

    try {
      const data = await api.getProjects()
      setProjects(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  async function handleRefreshIndex() {
    setRefreshing(true)
    setRefreshMsg('')
    setRefreshMsgIsError(false)

    try {
      const result = await api.refreshIndex()
      const stats = result?.stats || {}
      const projectsCount = Number(stats.projects || 0)
      const weeksCount = Number(stats.weeksIndexes || 0)
      const filesCount = Number(stats.filesIndexes || 0)
      setRefreshMsg(`Indice actualizado: ${projectsCount} proyectos, ${weeksCount} semanas, ${filesCount} archivos.`)
      await loadProjects({ silent: true })
    } catch (e) {
      setRefreshMsgIsError(true)
      setRefreshMsg(`No se pudo actualizar el indice: ${e.message}`)
    } finally {
      setRefreshing(false)
    }
  }

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
        <h1 className="page-title">Proyectos</h1>
        <p className="page-sub">Todo el material audiovisual de cada obra, organizado por proyecto y semana</p>
      </div>

      <div className="stats-bar">
        <div className="stat-box">
          <div className="stat-num">{counts.all}</div>
          <div className="stat-lbl">Proyectos</div>
        </div>
        <div className="stat-box">
          <div className="stat-num" style={{ color: 'var(--green)' }}>{counts.done}</div>
          <div className="stat-lbl">Completos</div>
        </div>
        <div className="stat-box">
          <div className="stat-num" style={{ color: 'var(--orange)' }}>{counts.uploading}</div>
          <div className="stat-lbl">Subiendo</div>
        </div>
        <div className="stat-box">
          <div className="stat-num" style={{ color: 'var(--red)' }}>{counts.pending}</div>
          <div className="stat-lbl" title={pendingNames || 'No hay proyectos pendientes'}>Pendientes</div>
        </div>
        <div className="index-refresh-box">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleRefreshIndex}
            disabled={refreshing}
            title="Forzar reconstruccion de indices ahora"
          >
            {refreshing ? 'Actualizando indice...' : 'Actualizar indice ahora'}
          </button>
          {refreshMsg && (
            <div className={`index-refresh-msg ${refreshMsgIsError ? 'error' : 'ok'}`}>
              {refreshMsg}
            </div>
          )}
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
          { key: 'done',     label: `Completos (${counts.done})` },
          { key: 'uploading',label: `Subiendo (${counts.uploading})` },
          { key: 'pending',  label: `Pendientes (${counts.pending})` },
        ].map(f => (
          <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`}
            title={f.key === 'pending' ? (pendingNames || 'No hay proyectos pendientes') : undefined}
            onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="project-grid" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="project-card-skel">
              <div className="skel skel-cover" />
              <div className="skel skel-line" style={{ width: '38%' }} />
              <div className="skel skel-line" style={{ width: '72%' }} />
            </div>
          ))}
        </div>
      )}
      {error   && <div className="alert alert-error" role="alert">No se pudieron cargar los proyectos: {error}</div>}

      {!loading && !error && (
        filtered.length === 0
          ? <div className="empty"><div className="empty-text">Sin resultados</div></div>
          : <div className="project-grid">
              {filtered.map(p => <ProjectCard key={p.code} project={p} onClick={() => nav(`/proyectos/project/${p.code}`)} />)}
            </div>
      )}
    </>
  )
}

function ProjectCard({ project: p, onClick }) {
  const si = statusInfo(p.status)
  const types = (p.types || '').split('+').filter(Boolean)
  const [cover, setCover] = useState(null)
  const [coverLoaded, setCoverLoaded] = useState(false)

  useEffect(() => {
    if (!p.coverPath) return
    let alive = true
    fetchThumb(p.coverPath, { w: 480, q: 62 })
      .then(url => { if (alive) setCover(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [p.coverPath])

  return (
    <div className="project-card" onClick={onClick}>
      {p.coverPath && (
        <div className="project-card-cover">
          {cover && (
            <img
              className={`img-fade ${coverLoaded ? 'is-loaded' : ''}`}
              src={cover}
              alt={`Portada de ${p.name || p.code}`}
              loading="lazy"
              onLoad={() => setCoverLoaded(true)}
            />
          )}
        </div>
      )}
      <div className="project-card-body">
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
    </div>
  )
}
