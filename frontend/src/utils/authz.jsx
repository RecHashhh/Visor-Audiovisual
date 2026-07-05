// src/utils/authz.jsx
// Contexto de permisos: consulta /api/me una vez por sesión y expone helpers
// para que el shell, las rutas y las páginas decidan qué mostrar.
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api'

// Si /api/me no existe (backend antiguo aún desplegado) o falla, no bloqueamos:
// el backend viejo tampoco restringía nada, así que degradamos al comportamiento previo.
const DEGRADED = { allowed: true, isAdmin: true, sections: '*', projects: '*', degraded: true }

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

export function canSection(me, sectionId) {
  if (!me || me.allowed === false) return false
  if (me.isAdmin || me.sections === '*') return true
  return Array.isArray(me.sections) && me.sections.includes(sectionId)
}

function SectionDenied() {
  return (
    <div className="coming-soon">
      <h1 className="coming-soon-title">Sin acceso a esta sección</h1>
      <p className="coming-soon-text">
        Tu cuenta no tiene permisos para ver este contenido. Si lo necesitas,
        pídeselo a la persona que administra el hub.
      </p>
    </div>
  )
}

export function RequireSection({ section, children }) {
  const { me, loading } = useAuthz()
  if (loading) return <div className="loading"><div className="spinner" /></div>
  if (!canSection(me, section)) return <SectionDenied />
  return children
}

export function RequireAdmin({ children }) {
  const { me, loading } = useAuthz()
  if (loading) return <div className="loading"><div className="spinner" /></div>
  if (!me?.isAdmin) return <SectionDenied />
  return children
}
