// src/components/Sidebar.jsx
import { NavLink } from 'react-router-dom'
import { useSections } from '../utils/sections'
import { sectionIcon } from '../config/sectionIcons'
import { useAuthz, canSection, hasCap } from '../utils/authz'

export default function Sidebar({ open, onNavigate }) {
  const { me } = useAuthz()
  const { sections } = useSections()
  const visibleSections = sections.filter(s => canSection(me, s.id))
  const canUpload = hasCap(me, 'upload')
  const canAccess = hasCap(me, 'manageAccess')
  const canShare = hasCap(me, 'share')
  const showAdmin = canUpload || canAccess || canShare

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <img
          className="sidebar-logo only-light"
          src="/brands/ripconciv/centrada-positivo-azul.png"
          alt="RIPCONCIV"
        />
        <img
          className="sidebar-logo only-dark"
          src="/brands/ripconciv/centrada-blanco.png"
          alt="RIPCONCIV"
        />
        <span className="sidebar-brand-caption">Hub Audiovisual</span>
      </div>

      <nav className="sidebar-nav">
        <NavLink
          to="/"
          end
          onClick={onNavigate}
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        >
          <span className="sidebar-link-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11.5 12 4l8 7.5" />
              <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
            </svg>
          </span>
          <span className="sidebar-link-label">Inicio</span>
        </NavLink>

        {canSection(me, 'proyectos') && (
          <NavLink to="/favoritos" onClick={onNavigate} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
            <span className="sidebar-link-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
              </svg>
            </span>
            <span className="sidebar-link-label">Favoritos</span>
          </NavLink>
        )}

        <div className="sidebar-divider" />

        {visibleSections.map(s => (
          <NavLink
            key={s.id}
            to={s.path}
            onClick={onNavigate}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className="sidebar-link-icon">{sectionIcon(s)}</span>
            <span className="sidebar-link-label">{s.label}</span>
          </NavLink>
        ))}
      </nav>

      {showAdmin && (
        <div className="sidebar-footer">
          <div className="sidebar-group-label">Administración</div>
          {canUpload && (
            <NavLink to="/upload" onClick={onNavigate} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <span className="sidebar-link-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4M8 8l4-4 4 4" />
                  <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                </svg>
              </span>
              <span className="sidebar-link-label">Subir material</span>
            </NavLink>
          )}
          {canShare && (
            <NavLink to="/enlaces" onClick={onNavigate} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <span className="sidebar-link-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 14.5 14.5 9.5" />
                  <path d="M11 6.5 12.8 4.7a3.8 3.8 0 0 1 5.4 5.4L16.4 12" />
                  <path d="M13 17.5l-1.8 1.8a3.8 3.8 0 0 1-5.4-5.4L7.6 12" />
                </svg>
              </span>
              <span className="sidebar-link-label">Enlaces compartidos</span>
            </NavLink>
          )}
          {canAccess && (
            <NavLink to="/accesos" onClick={onNavigate} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <span className="sidebar-link-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8.5" r="3.2" />
                  <path d="M3.5 19c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7" />
                  <path d="M16.5 8h4M18.5 6v4" />
                </svg>
              </span>
              <span className="sidebar-link-label">Accesos</span>
            </NavLink>
          )}
          {canAccess && (
            <NavLink to="/secciones" onClick={onNavigate} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
              <span className="sidebar-link-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h10M4 12h16M4 18h7" />
                  <circle cx="18.5" cy="6" r="1.6" />
                  <circle cx="14" cy="18" r="1.6" />
                </svg>
              </span>
              <span className="sidebar-link-label">Secciones</span>
            </NavLink>
          )}
        </div>
      )}
    </aside>
  )
}
