// src/pages/AccessPage.jsx
// Administración de accesos: quién entra, con qué rol/capacidades y qué puede
// VER (por sección y, dentro de cada sección, qué ítems concretos).
import { useEffect, useMemo, useState } from 'react'
import { api } from '../utils/api'
import { useAuthz } from '../utils/authz'
import { useSections } from '../utils/sections'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Presets de capacidades por rol (espejo del backend). Los roles son atajos:
// después se puede activar/desactivar cada capacidad manualmente.
const ROLE_CAPS = {
  admin:    { upload: true,  manageMedia: true,  deleteMedia: true,  share: true,  refreshIndex: true,  manageAccess: true },
  operador: { upload: true,  manageMedia: true,  deleteMedia: false, share: true,  refreshIndex: true,  manageAccess: false },
  viewer:   { upload: false, manageMedia: false, deleteMedia: false, share: false, refreshIndex: false, manageAccess: false },
}
const ROLE_LABEL = { admin: 'Administrador', operador: 'Operador', viewer: 'Visualizador' }
const CAP_META = [
  { key: 'upload',       label: 'Subir material a proyectos' },
  { key: 'manageMedia',  label: 'Crear y subir en Marcas, Documentos y demás secciones' },
  { key: 'deleteMedia',  label: 'Eliminar archivos y carpetas de esas secciones (no aplica a Proyectos)' },
  { key: 'share',        label: 'Generar y revocar enlaces externos' },
  { key: 'refreshIndex', label: 'Refrescar el índice de proyectos' },
  { key: 'manageAccess', label: 'Gestionar accesos (usuarios, roles y permisos)' },
]
const SECTION_ALIAS = { material: 'proyectos' }
const canon = (s) => SECTION_ALIAS[s] || s

function capsMatch(caps, role) {
  return CAP_META.every(c => Boolean(caps[c.key]) === ROLE_CAPS[role][c.key])
}
function roleLabelFor(u) {
  const preset = ['admin', 'operador', 'viewer'].find(r => capsMatch(u.caps, r))
  return preset ? ROLE_LABEL[preset] : 'Personalizado'
}

function normalizeUser(u) {
  const role = u.role === 'admin' ? 'admin' : u.role === 'operador' ? 'operador' : 'viewer'
  const caps = { ...ROLE_CAPS[role], ...(u.caps && typeof u.caps === 'object' ? u.caps : {}) }
  let sections = u.sections === '*' ? '*' : (Array.isArray(u.sections) ? u.sections.map(canon) : [])
  const scopes = {}
  const rawScopes = (u.scopes && typeof u.scopes === 'object') ? u.scopes : {}
  Object.entries(rawScopes).forEach(([k, v]) => { if (Array.isArray(v) && v.length) scopes[canon(k)] = v })
  // compat: 'projects' viejo → scope de proyectos
  if (Array.isArray(u.projects) && u.projects.length && !scopes.proyectos) scopes.proyectos = u.projects
  return { email: u.email || '', name: u.name || '', role, enabled: u.enabled !== false, caps, sections, scopes }
}

function normalizeConfig(raw) {
  return {
    restricted: Boolean(raw?.restricted),
    users: Array.isArray(raw?.users) ? raw.users.map(normalizeUser) : [],
  }
}

export default function AccessPage() {
  const { me, refresh } = useAuthz()
  const [cfg, setCfg] = useState(null)
  const [origJson, setOrigJson] = useState('')
  const [meta, setMeta] = useState({ bootstrap: false, envAdmins: [] })
  const [sectionItems, setSectionItems] = useState({})   // { sectionId: [{id,label}] }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [newEmail, setNewEmail] = useState('')
  const { sections, mediaSections } = useSections()

  useEffect(() => {
    Promise.all([
      api.getAccessConfig(),
      api.getProjects().catch(() => []),
      ...mediaSections.map(s => api.listMediaFolders(s.id).then(d => [s.id, d?.folders || []]).catch(() => [s.id, []])),
    ])
      .then(([accessData, projectsData, ...mediaResults]) => {
        const normalized = normalizeConfig(accessData?.config)
        setCfg(normalized)
        setOrigJson(JSON.stringify(normalized))
        setMeta({ bootstrap: Boolean(accessData?.bootstrap), envAdmins: accessData?.envAdmins || [] })
        const items = {
          proyectos: (Array.isArray(projectsData) ? projectsData : [])
            .filter(p => p.hasContent !== false)
            .map(p => ({ id: p.code, label: p.name ? `${p.code} — ${p.name}` : p.code })),
        }
        mediaResults.forEach(([sid, folders]) => {
          items[sid] = folders.map(f => ({ id: f.name, label: f.name }))
        })
        setSectionItems(items)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const dirty = cfg !== null && JSON.stringify(cfg) !== origJson

  function patchUser(idx, patch) {
    setCfg(c => ({ ...c, users: c.users.map((u, i) => (i === idx ? { ...u, ...patch } : u)) }))
    setSaveMsg(null)
  }

  function setRole(idx, role) {
    // Preset rápido: fija capacidades y, para roles de gestión, vista completa.
    const patch = { role, caps: { ...ROLE_CAPS[role] } }
    if (role === 'admin' || role === 'operador') { patch.sections = '*'; patch.scopes = {} }
    else if (cfg.users[idx].sections === '*') { patch.sections = [] }
    patchUser(idx, patch)
  }

  function toggleCap(idx, cap) {
    const u = cfg.users[idx]
    patchUser(idx, { caps: { ...u.caps, [cap]: !u.caps[cap] } })
  }

  function addUser() {
    const email = newEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) { setSaveMsg({ ok: false, text: 'Escribe un correo válido, p. ej. nombre@ripconciv.com' }); return }
    if (cfg.users.some(u => u.email === email)) { setSaveMsg({ ok: false, text: 'Ese correo ya está en la lista.' }); return }
    setCfg(c => ({
      ...c,
      users: [...c.users, { email, name: '', role: 'viewer', enabled: true, caps: { ...ROLE_CAPS.viewer }, sections: ['proyectos'], scopes: {} }],
    }))
    setNewEmail(''); setSaveMsg(null)
  }

  function removeUser(idx) {
    setCfg(c => ({ ...c, users: c.users.filter((_, i) => i !== idx) }))
    setSaveMsg(null)
  }

  async function save() {
    setSaving(true); setSaveMsg(null)
    try {
      const res = await api.saveAccessConfig(cfg)
      const normalized = normalizeConfig(res?.config)
      setCfg(normalized); setOrigJson(JSON.stringify(normalized))
      setMeta(m => ({ ...m, bootstrap: false }))
      setSaveMsg({ ok: true, text: 'Cambios guardados. Los permisos aplican en menos de un minuto.' })
      refresh()
    } catch (e) {
      setSaveMsg({ ok: false, text: `No se pudo guardar: ${e.message}` })
    } finally { setSaving(false) }
  }

  const selfEmail = (me?.email || '').toLowerCase()

  if (loading) return <div className="loading"><div className="spinner" /><span>Cargando accesos...</span></div>
  if (error) return <div className="alert alert-error" role="alert">No se pudieron cargar los accesos: {error}</div>
  if (!cfg) return null

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Accesos</h1>
        <p className="page-sub">Decide quién entra, qué puede hacer y qué puede ver, hasta el nivel de cada proyecto o marca.</p>
      </div>

      {meta.bootstrap && (
        <div className="access-banner">
          Aún no existe configuración de accesos. Al guardar por primera vez, tu cuenta queda como
          administradora y podrás gestionar el resto.
        </div>
      )}

      <section className="access-card">
        <div className="access-card-head">
          <div>
            <div className="access-card-title">Modo de acceso</div>
            <p className="access-card-desc">
              {cfg.restricted
                ? 'Restringido: solo las personas de la lista pueden usar el hub.'
                : 'Abierto: cualquiera de la organización que inicie sesión ve todo. Actívalo cuando la lista esté completa.'}
            </p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={cfg.restricted}
              onChange={e => { setCfg(c => ({ ...c, restricted: e.target.checked })); setSaveMsg(null) }} />
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
              Elige un rol como punto de partida y luego ajusta manualmente cada capacidad y qué puede ver.
            </p>
          </div>
        </div>

        <div className="access-add">
          <input className="search-input" type="email" placeholder="correo@ripconciv.com"
            value={newEmail} onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addUser()} />
          <button className="btn btn-primary" onClick={addUser}>Agregar persona</button>
        </div>

        {meta.envAdmins.length > 0 && (
          <p className="access-envnote">Administradores permanentes (fijados en el servidor): {meta.envAdmins.join(', ')}</p>
        )}

        {cfg.users.length === 0 && (
          <div className="empty">
            <div className="empty-text">Aún no hay personas en la lista</div>
            <p className="access-empty-hint">Agrega el primer correo arriba. Mientras el modo sea Abierto, nadie pierde acceso.</p>
          </div>
        )}

        <div className="access-users">
          {cfg.users.map((u, idx) => (
            <UserRow
              key={u.email}
              user={u}
              isSelf={u.email === selfEmail}
              sectionItems={sectionItems}
              onPatch={patch => patchUser(idx, patch)}
              onSetRole={role => setRole(idx, role)}
              onToggleCap={cap => toggleCap(idx, cap)}
              onRemove={() => removeUser(idx)}
            />
          ))}
        </div>
      </section>

      {(dirty || saveMsg) && (
        <div className="access-savebar">
          {saveMsg && <span className={`access-savemsg ${saveMsg.ok ? 'ok' : 'error'}`}>{saveMsg.text}</span>}
          {dirty && (
            <>
              <button className="btn btn-ghost" onClick={() => { setCfg(JSON.parse(origJson)); setSaveMsg(null) }} disabled={saving}>Descartar</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button>
            </>
          )}
        </div>
      )}
    </>
  )
}

function Chevron({ open, small }) {
  const sz = small ? 14 : 16
  return (
    <svg className={`chevron ${open ? 'open' : ''}`} width={sz} height={sz} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function UserRow({ user: u, isSelf, sectionItems, onPatch, onSetRole, onToggleCap, onRemove }) {
  const canManageAll = u.caps.manageAccess
  const [open, setOpen] = useState(false)
  const [openSecs, setOpenSecs] = useState(() => new Set())

  function toggleSection(sectionId) {
    const current = Array.isArray(u.sections) ? u.sections : []
    const next = current.includes(sectionId) ? current.filter(s => s !== sectionId) : [...current, sectionId]
    onPatch({ sections: next })
  }
  function setScope(sectionId, itemIds) {
    const scopes = { ...u.scopes }
    if (!itemIds || itemIds.length === 0) delete scopes[sectionId]
    else scopes[sectionId] = itemIds
    onPatch({ scopes })
  }
  function toggleSec(id) {
    setOpenSecs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const summary = canManageAll || u.sections === '*'
    ? 'Todas las secciones'
    : (Array.isArray(u.sections) && u.sections.length
        ? `${u.sections.length} sección${u.sections.length !== 1 ? 'es' : ''}`
        : 'Sin secciones')

  return (
    <div className={`access-user ${u.enabled ? '' : 'is-disabled'} ${open ? 'is-open' : ''}`}>
      <div className="access-user-head" role="button" tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <div className="access-user-id">
          <Chevron open={open} />
          <span className="access-user-email">{u.email}</span>
          {isSelf && <span className="badge badge-accent">Tú</span>}
          <span className="access-user-role">{roleLabelFor(u)}</span>
          {!open && <span className="access-user-sum">· {summary}</span>}
        </div>
        <div className="access-user-controls" onClick={e => e.stopPropagation()}>
          <label className="switch switch-sm" title={u.enabled ? 'Acceso activo' : 'Acceso pausado'}>
            <input type="checkbox" checked={u.enabled} onChange={e => onPatch({ enabled: e.target.checked })} />
            <span className="switch-slider" aria-hidden="true" />
          </label>
          <button className="icon-btn icon-btn-danger" onClick={onRemove} aria-label={`Quitar a ${u.email}`} title="Quitar de la lista">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12M10 11v5M14 11v5" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="access-user-body">
          <div className="access-field">
            <span className="access-field-label">Rol (punto de partida)</span>
            <div className="segmented">
              {['admin', 'operador', 'viewer'].map(r => (
                <button key={r} className={`segmented-btn ${capsMatch(u.caps, r) && ((r !== 'viewer') === (u.sections === '*')) ? 'active' : ''}`}
                  onClick={() => onSetRole(r)}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
          </div>

          <div className="access-field">
            <span className="access-field-label">Qué puede hacer</span>
            <div className="access-caps">
              {CAP_META.map(c => (
                <label key={c.key} className="access-cap">
                  <input type="checkbox" checked={Boolean(u.caps[c.key])} onChange={() => onToggleCap(c.key)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="access-field">
            <span className="access-field-label">Qué puede ver</span>
            {canManageAll ? (
              <p className="access-hint">Con “gestionar accesos” activo, ve todas las secciones y todo su contenido.</p>
            ) : (
              <div className="access-view">
                <label className="access-allsections">
                  <input type="checkbox" checked={u.sections === '*'}
                    onChange={e => onPatch({ sections: e.target.checked ? '*' : [] })} />
                  <span>Ver <strong>todas</strong> las secciones</span>
                </label>

                {u.sections === '*' ? (
                  <p className="access-hint">Esta persona ve todas las secciones. Desmarca la casilla para elegir solo algunas.</p>
                ) : (
                  <>
                    <p className="access-hint">
                      Marca la casilla de cada sección que <strong>sí</strong> puede ver. Haz clic en el nombre para elegir carpetas concretas.
                    </p>
                    <div className="access-seclist">
                      {sections.map(s => {
                        const active = Array.isArray(u.sections) && u.sections.includes(s.id)
                        const scope = u.scopes[s.id]
                        const items = sectionItems[s.id] || []
                        const isOpen = openSecs.has(s.id)
                        return (
                          <div key={s.id} className={`access-sec ${active ? 'active' : ''}`}>
                            <div className="access-sec-head">
                              <input type="checkbox" className="access-sec-check" checked={active}
                                onChange={() => toggleSection(s.id)} aria-label={`Dar acceso a ${s.label}`} />
                              <button type="button" className="access-sec-name" onClick={() => toggleSec(s.id)}>
                                <span className="access-sec-title">{s.label}</span>
                                <span className="access-sec-meta">
                                  <span>{active ? (scope ? `${scope.length} carpeta${scope.length !== 1 ? 's' : ''}` : 'Todo') : 'Sin acceso'}</span>
                                  <Chevron open={isOpen} small />
                                </span>
                              </button>
                            </div>
                            {isOpen && (
                              <div className={`access-scope ${active ? '' : 'blocked'}`}>
                                {items.length === 0 ? (
                                  <span className="access-scope-empty">Aún no hay carpetas en esta sección.</span>
                                ) : !active ? (
                                  <span className="access-scope-empty">Marca la casilla de la izquierda para dar acceso y elegir carpetas.</span>
                                ) : (
                                  <>
                                    <span className="access-scope-label">Solo:</span>
                                    <button className={`chip-mini ${!scope ? 'active' : ''}`} onClick={() => setScope(s.id, [])}>Todo</button>
                                    {items.map(it => {
                                      const on = Array.isArray(scope) && scope.includes(it.id)
                                      return (
                                        <button key={it.id} className={`chip-mini ${on ? 'active' : ''}`} title={it.label}
                                          onClick={() => {
                                            const cur = Array.isArray(scope) ? scope : []
                                            setScope(s.id, on ? cur.filter(x => x !== it.id) : [...cur, it.id])
                                          }}>
                                          {it.id}
                                        </button>
                                      )
                                    })}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
