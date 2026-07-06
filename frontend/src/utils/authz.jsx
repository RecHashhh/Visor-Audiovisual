// src/utils/authz.jsx
// Contexto de permisos: consulta /api/me una vez por sesión y expone helpers
// para que el shell, las rutas y las páginas decidan qué mostrar/permitir.
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api'

// Si /api/me falla (backend viejo o caído) degradamos a "todo permitido" para
// no dejar la app inutilizable — el backend nuevo es la fuente real de verdad.
const ALL_CAPS = { upload: true, manageMedia: true, share: true, refreshIndex: true, manageAccess: true }
const DEGRADED = {
  allowed: true, role: 'admin', isAdmin: true, isManager: true,
  caps: ALL_CAPS, sections: '*', scopes: {}, degraded: true,
}

const AuthzContext = createContext(null)

export function AuthzProvider({ children }) {
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    return api.getMe()
      .then(data => setMe(data))
      .catch(() => setMe(DEGRADED))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <AuthzContext.Provider value={{ me, loading, refresh }}>
      {children}
    </AuthzContext.Provider>
  )
}

export function useAuthz() {
  return useContext(AuthzContext) || { me: DEGRADED, loading: false, refresh: () => {} }
}

// ── Helpers de permiso ──────────────────────────────────────────────────────
export function hasCap(me, cap) {
  return Boolean(me && me.allowed !== false && me.caps && me.caps[cap])
}

export function canSection(me, sectionId) {
  if (!me || me.allowed === false) return false
  if (me.isManager || me.sections === '*') return true
  return Array.isArray(me.sections) && me.sections.includes(sectionId)
}

// ¿Puede ver un ítem concreto (proyecto, carpeta de marca…) dentro de una sección?
export function canItem(me, sectionId, itemId) {
  if (!canSection(me, sectionId)) return false
  if (me.isManager) return true
  const scope = me.scopes && me.scopes[sectionId]
  if (!scope || !Array.isArray(scope) || scope.length === 0) return true
  return scope.includes(itemId)
}

function AccessDenied({ title, text }) {
  return (
    <div className="coming-soon">
      <h1 className="coming-soon-title">{title}</h1>
      <p className="coming-soon-text">{text}</p>
    </div>
  )
}

export function RequireSection({ section, children }) {
  const { me, loading } = useAuthz()
  if (loading) return <div className="loading"><div className="spinner" /></div>
  if (!canSection(me, section)) {
    return <AccessDenied
      title="Sin acceso a esta sección"
      text="Tu cuenta no tiene permisos para ver este contenido. Pídeselo a quien administra el hub." />
  }
  return children
}

export function RequireCap({ cap, children }) {
  const { me, loading } = useAuthz()
  if (loading) return <div className="loading"><div className="spinner" /></div>
  if (!hasCap(me, cap)) {
    return <AccessDenied
      title="Sin permiso para esta acción"
      text="Tu cuenta no tiene esta capacidad habilitada. Pídeselo a quien administra el hub." />
  }
  return children
}

// Retrocompatibilidad: RequireAdmin ahora exige la capacidad de gestionar accesos.
export function RequireAdmin({ children }) {
  return <RequireCap cap="manageAccess">{children}</RequireCap>
}
