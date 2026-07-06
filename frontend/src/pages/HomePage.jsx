// src/pages/HomePage.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../utils/api'
import { SECTIONS } from '../config/sections'
import { SECTION_ICONS } from '../config/sectionIcons'
import { useAuthz, canSection } from '../utils/authz'

function statusOf(s = '') {
  const sl = s.toLowerCase()
  if (sl.includes('completo') || sl.includes('complete')) return 'done'
  if (sl.includes('subiendo') || sl.includes('uploading')) return 'uploading'
  return 'pending'
}

function timeAgo(iso) {
  if (!iso) return null
  const diffMs = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diffMs / 86400000)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) return `Hace ${days} días`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  return `Hace ${months} mes${months > 1 ? 'es' : ''}`
}

const material = SECTIONS.find(s => s.id === 'proyectos')
const marcas = SECTIONS.find(s => s.id === 'marcas')
const compactSections = SECTIONS.filter(s => s.id !== 'proyectos' && s.id !== 'marcas')

export default function HomePage() {
  const { me } = useAuthz()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [brandFolders, setBrandFolders] = useState(null) // null = cargando

  const showMaterial = canSection(me, 'proyectos')
  const showMarcas = canSection(me, 'marcas')

  useEffect(() => {
    if (!showMaterial) {
      setLoading(false)
      return
    }
    api.getProjects()
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [showMaterial])

  useEffect(() => {
    if (!showMarcas) return
    api.listMediaFolders('marcas')
      .then(d => setBrandFolders(Array.isArray(d?.folders) ? d.folders : []))
      .catch(() => setBrandFolders([]))
  }, [showMarcas])

  const visible = projects.filter(p => p.hasContent !== false)
  const counts = {
    total: visible.length,
    done: visible.filter(p => statusOf(p.status) === 'done').length,
    pending: visible.filter(p => statusOf(p.status) === 'pending').length,
  }
  const recent = [...visible]
    .filter(p => p.lastModified)
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
    .slice(0, 6)
  const visibleCompact = compactSections.filter(s => canSection(me, s.id))

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-photo" aria-hidden="true" />
        <img
          className="home-hero-logo"
          src="/brands/ripconciv/wordmark-white.png"
          alt="RIPCONCIV"
        />
        <h1 className="home-hero-title">El hub de contenido audiovisual y de marca</h1>
        <p className="home-hero-text">
          Fotos de dron, video de obra, logos, plantillas y todo lo demás que produce la
          empresa, organizado para encontrarlo en segundos.
        </p>
        <div className="home-hero-actions">
          {showMaterial && <Link to="/proyectos" className="home-hero-btn">Buscar material</Link>}
          {showMarcas && (
            <Link to="/marcas" className={showMaterial ? 'home-hero-btn-ghost' : 'home-hero-btn'}>
              Ver marcas y logos
            </Link>
          )}
        </div>
      </section>

      {showMaterial && recent.length > 0 && (
        <section className="home-recent">
          <div className="home-recent-header">
            <h2 className="home-recent-title">Actualizado recientemente</h2>
            <Link to="/proyectos" className="home-recent-link">Ver todo</Link>
          </div>
          <div className="home-recent-row">
            {recent.map(p => (
              <Link key={p.code} to={`/proyectos/project/${p.code}`} className="home-recent-card">
                <span className="home-recent-code">{p.code}</span>
                <span className="home-recent-name">{p.name}</span>
                <span className="home-recent-time">{timeAgo(p.lastModified)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="home-grid">
        {showMaterial && (
          <Link to={material.path} className="home-card home-card-featured">
            <div className="home-card-icon">{SECTION_ICONS.proyectos}</div>
            <div className="home-card-title">{material.label}</div>
            <p className="home-card-desc">{material.description}</p>
            <div className="stats-bar home-featured-stats">
              <div className="stat-box">
                <div className="stat-num">{loading ? '…' : counts.total}</div>
                <div className="stat-lbl">Proyectos</div>
              </div>
              <div className="stat-box">
                <div className="stat-num" style={{ color: 'var(--green)' }}>{loading ? '…' : counts.done}</div>
                <div className="stat-lbl">Completos</div>
              </div>
              <div className="stat-box">
                <div className="stat-num" style={{ color: 'var(--red)' }}>{loading ? '…' : counts.pending}</div>
                <div className="stat-lbl">Pendientes</div>
              </div>
            </div>
            <span className="home-card-cta">Ver todo el material</span>
          </Link>
        )}

        {showMarcas && (
          <Link to={marcas.path} className="home-card home-card-brand">
            <div className="home-card-icon">{SECTION_ICONS.marcas}</div>
            <div className="home-card-title">{marcas.label}</div>
            <p className="home-card-desc">{marcas.description}</p>
            {brandFolders && brandFolders.length > 0 && (
              <div className="home-brand-folders">
                {brandFolders.slice(0, 4).map(f => (
                  <span key={f.name} className="home-brand-folder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8A2 2 0 0 1 21 9.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                    </svg>
                    {f.name}
                    <em>{f.fileCount} archivo{f.fileCount !== 1 ? 's' : ''}</em>
                  </span>
                ))}
                {brandFolders.length > 4 && (
                  <span className="home-brand-more">+{brandFolders.length - 4} más</span>
                )}
              </div>
            )}
            <span className="home-card-cta">Explorar marcas</span>
          </Link>
        )}

        {visibleCompact.map(s => (
          <Link key={s.id} to={s.path} className="home-card">
            <div className="home-card-icon">{SECTION_ICONS[s.id]}</div>
            <div className="home-card-title">{s.label}</div>
            <p className="home-card-desc">{s.description}</p>
            <span className="home-card-cta">Explorar</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
