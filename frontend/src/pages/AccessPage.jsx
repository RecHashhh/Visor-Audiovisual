// src/pages/AccessPage.jsx
// Administración de accesos: quién entra al hub, qué secciones ve y qué
// proyectos puede abrir. Guarda todo en una sola configuración (blob JSON).
import { useEffect, useMemo, useState } from 'react'
import { api } from '../utils/api'
import { useAuthz } from '../utils/authz'
import { SECTIONS } from '../config/sections'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeConfig(raw) {
  return {
    restricted: Boolean(raw?.restricted),
    users: Array.isArray(raw?.users) ? raw.users.map(u => ({
      email: u.email || '',
      name: u.name || '',
      role: u.role === 'admin' ? 'admin' : 'viewer',
      enabled: u.enabled !== false,
      sections: u.sections === '*' ? '*' : (Array.isArray(u.sections) ? u.sections : []),
      projects: u.projects === '*' ? '*' : (Array.isArray(u.projects) ? u.projects : []),
    })) : [],
  }
}

export default function AccessPage() {
  const { me, refresh } = useAuthz()
  const [cfg, setCfg] = useState(null)
  const [origJson, setOrigJson] = useState('')
  const [meta, setMeta] = useState({ bootstrap: false, envAdmins: [], exists: false })
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [newEmail, setNewEmail] = useState('')

  useEffect(() => {
    Promise.all([
      api.getAccessConfig(),
      api.getProjects().catch(() => []),
    ])
      .then(([accessData, projectsData]) => {
        const normalized = normalizeConfig(accessData?.config)
        setCfg(normalized)
        setOrigJson(JSON.stringify(normalized))
        setMeta({
          bootstrap: Boolean(accessData?.bootstrap),
          envAdmins: accessData?.envAdmins || [],
          exists: Boolean(accessData?.exists),
        })
        setProjects(Array.isArray(projectsData) ? projectsData.filter(p => p.hasContent !== false) : [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const dirty = cfg !== null && JSON.stringify(cfg) !== origJson

  function patchUser(idx, patch) {
    setCfg(c => ({ ...c, users: c.users.map((u, i) => (i === idx ? { ...u, ...patch } : u)) }))
    setSaveMsg(null)
  }

  function addUser() {
    const email = newEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      setSaveMsg({ ok: false, text: 'Escribe un correo válido, por ejemplo nombre@ripconciv.com' })
      return
    }
    if (cfg.users.some(u => u.email === email)) {
      setSaveMsg({ ok: false, text: 'Ese correo ya está en la lista.' })
      return
    }
    setCfg(c => ({
      ...c,
      users: [...c.users, {
        email, name: '', role: 'viewer', enabled: true,
        sections: ['material'], projects: '*',
      }],
    }))
    setNewEmail('')
    setSaveMsg(null)
  }

  function removeUser(idx) {
    setCfg(c => ({ ...c, users: c.users.filter((_, i) => i !== idx) }))
    setSaveMsg(null)
  }

  function toggleSection(idx, sectionId) {
    const u = cfg.users[idx]
    const current = u.sections === '*' ? SECTIONS.map(s => s.id) : u.sections
    const next = current.includes(sectionId)
      ? current.filter(s => s !== sectionId)
      : [...current, sectionId]
    patchUser(idx, { sections: next })
  }

  function toggleProject(idx, code) {
    const u = cfg.users[idx]
    const current = u.projects === '*' ? [] : u.projects
    const next = current.includes(code)
      ? current.filter(c => c !== code)
      : [...current, code]
    patchUser(idx, { projects: next })
  }

  async function save() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await api.saveAccessConfig(cfg)
      const normalized = normalizeConfig(res?.config)
      setCfg(normalized)
      setOrigJson(JSON.stringify(normalized))
      setMeta(m => ({ ...m, exists: true, bootstrap: false }))
      setSaveMsg({ ok: true, text: 'Cambios guardados. Los permisos aplican en menos de un minuto.' })
      refresh()
    } catch (e) {
      setSaveMsg({ ok: false, text: `No se pudo guardar: ${e.message}` })
    } finally {
      setSaving(false)
    }
  }

  const selfEmail = (me?.email || '').toLowerCase()

  if (loading) return <div className="loading"><div className="spinner" /><span>Cargando accesos...</span></div>
  if (error) return <div className="alert alert-error" role="alert">No se pudieron cargar los accesos: {error}</div>
  if (!cfg) return null

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Accesos</h1>
        <p className="page-sub">
          Decide quién entra al hub, qué secciones ve y qué proyectos puede abrir.
        </p>
      </div>

      {meta.bootstrap && (
        <div className="access-banner">
          Aún no existe configuración de accesos. Al guardar por primera vez, tu cuenta
          quedará como administradora y podrás restringir el resto.
        </div>
      )}

      <section className="access-card">
        <div className="access-card-head">
          <div>
            <div className="access-card-title">Modo de acceso</div>
            <p className="access-card-desc">
              {cfg.restricted
                ? 'Restringido: solo las personas de la lista pueden usar el hub.'
                : 'Abierto: cualquier persona de la organización que inicie sesión ve todo. Actívalo cuando la lista esté completa.'}
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={cfg.restricted}
              onChange={e => { setCfg(c => ({ ...c, restricted: e.target.checked })); setSaveMsg(null) }}
            />
            <span className="switch-slider" aria-hidden="true" />
            <span className="switch-label">{cfg.restricted ? 'Restringido' : 'Abierto'}</span>
          </label>
        </div>
      </section>

      <section className="access-card">
        <div className="access-card-head">
          <div>
            <div className="access-card-title">Personas ({cfg.users.length})</div>
            <p className="access-card-desc">
              Los administradores ven todo y gestionan el hub. Los visualizadores solo ven
              las secciones y proyectos que les asignes.
            </p>
          </div>
        </div>

        <div className="access-add">
          <input
            className="search-input"
            type="email"
            placeholder="correo@ripconciv.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addUser()}
          />
          <button className="btn btn-primary" onClick={addUser}>Agregar persona</button>
        </div>

        {meta.envAdmins.length > 0 && (
          <p className="access-envnote">
            Administradores permanentes (configurados en el servidor): {meta.envAdmins.join(', ')}
          </p>
        )}

        {cfg.users.length === 0 && (
          <div className="empty">
            <div className="empty-text">Aún no hay personas en la lista</div>
            <p className="access-empty-hint">
              Agrega el primer correo arriba. Mientras el modo sea Abierto, nadie pierde acceso.
            </p>
          </div>
        )}

        <div className="access-users">
          {cfg.users.map((u, idx) => (
            <UserRow
              key={u.email}
              user={u}
              isSelf={u.email === selfEmail}
              projects={projects}
              onPatch={patch => patchUser(idx, patch)}
              onToggleSection={id => toggleSection(idx, id)}
              onToggleProject={code => toggleProject(idx, code)}
              onRemove={() => removeUser(idx)}
            />
          ))}
        </div>
      </section>

      {(dirty || saveMsg) && (
        <div className="access-savebar">
          {saveMsg && (
            <span className={`access-savemsg ${saveMsg.ok ? 'ok' : 'error'}`}>{saveMsg.text}</span>
          )}
          {dirty && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => { setCfg(JSON.parse(origJson)); setSaveMsg(null) }}
                disabled={saving}
              >
                Descartar
              </button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}

function UserRow({ user: u, isSelf, projects, onPatch, onToggleSection, onToggleProject, onRemove }) {
  const [projectSearch, setProjectSearch] = useState('')
  const isViewer = u.role !== 'admin'
  const sectionsList = u.sections === '*' ? SECTIONS.map(s => s.id) : u.sections
  const hasMaterial = sectionsList.includes('material')
  const allProjects = u.projects === '*'

  const filteredProjects = useMemo(() => {
    const q = projectSearch.toLowerCase()
    if (!q) return projects
    return projects.filter(p =>
      p.code?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q)
    )
  }, [projects, projectSearch])

  return (
    <div className={`access-user ${u.enabled ? '' : 'is-disabled'}`}>
      <div className="access-user-head">
        <div className="access-user-id">
          <span className="access-user-email">{u.email}</span>
          {isSelf && <span className="badge badge-accent">Tú</span>}
          {u.name && <span className="access-user-name">{u.name}</span>}
        </div>
        <div className="access-user-controls">
          <select
            className="select"
            value={u.role}
            onChange={e => onPatch({ role: e.target.value })}
            aria-label={`Rol de ${u.email}`}
          >
            <option value="viewer">Visualizador</option>
            <option value="admin">Administrador</option>
          </select>
          <label className="switch switch-sm" title={u.enabled ? 'Acceso activo' : 'Acceso pausado'}>
            <input
              type="checkbox"
              checked={u.enabled}
              onChange={e => onPatch({ enabled: e.target.checked })}
            />
            <span className="switch-slider" aria-hidden="true" />
          </label>
          <button
            className="icon-btn icon-btn-danger"
            onClick={onRemove}
            aria-label={`Quitar a ${u.email}`}
            title="Quitar de la lista"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12M10 11v5M14 11v5" />
            </svg>
          </button>
        </div>
      </div>

      {isViewer && (
        <div className="access-user-body">
          <div className="access-field">
            <span className="access-field-label">Secciones</span>
            <div className="access-chips">
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  className={`filter-chip ${sectionsList.includes(s.id) ? 'active' : ''}`}
                  onClick={() => onToggleSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {hasMaterial && (
            <div className="access-field">
              <span className="access-field-label">Proyectos</span>
              <div className="access-projects">
                <div className="access-chips">
                  <button
                    className={`filter-chip ${allProjects ? 'active' : ''}`}
                    onClick={() => onPatch({ projects: allProjects ? [] : '*' })}
                  >
                    Todos los proyectos
                  </button>
                  {!allProjects && (
                    <span className="access-projects-count">
                      {u.projects.length} seleccionado{u.projects.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {!allProjects && (
                  <>
                    <input
                      className="search-input access-projects-search"
                      placeholder="Buscar proyecto por código o nombre..."
                      value={projectSearch}
                      onChange={e => setProjectSearch(e.target.value)}
                    />
                    <div className="access-projects-list">
                      {filteredProjects.map(p => (
                        <button
                          key={p.code}
                          className={`filter-chip ${u.projects.includes(p.code) ? 'active' : ''}`}
                          title={p.name}
                          onClick={() => onToggleProject(p.code)}
                        >
                          {p.code}
                        </button>
                      ))}
                      {filteredProjects.length === 0 && (
                        <span className="access-projects-count">Sin resultados para “{projectSearch}”</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
