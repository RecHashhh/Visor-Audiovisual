// src/components/AppShell.jsx
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import CommandPalette from './CommandPalette'
import { useAuthz } from '../utils/authz'

const ROUTE_TITLES = [
  ['/proyectos', 'Proyectos'],
  ['/marcas', 'Marcas'],
  ['/documentos', 'Documentos y Plantillas'],
  ['/videos-corporativos', 'Videos Corporativos'],
  ['/fotografia-eventos', 'Fotografía de Eventos'],
  ['/redes-sociales', 'Redes Sociales'],
  ['/upload', 'Subir material'],
  ['/accesos', 'Accesos'],
  ['/enlaces', 'Enlaces compartidos'],
]

function NoAccessScreen({ email }) {
  const { instance } = useMsal()
  return (
    <div className="noaccess">
      <div className="noaccess-card">
        <img src="/brands/ripconciv/thumbs/simbolo-positivo-azul.png" alt="RIPCONCIV" className="noaccess-logo only-light" />
        <img src="/brands/ripconciv/symbol-white.png" alt="RIPCONCIV" className="noaccess-logo only-dark" />
        <h1 className="noaccess-title">No tienes acceso al hub</h1>
        <p className="noaccess-text">
          Tu cuenta <strong>{email}</strong> inició sesión correctamente, pero no está
          en la lista de accesos. Pide acceso a la persona que administra el hub.
        </p>
        <button className="btn btn-ghost" onClick={() => instance.logoutRedirect()}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { me, loading } = useAuthz()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const hit = ROUTE_TITLES.find(([p]) => location.pathname.startsWith(p))
    document.title = hit ? `${hit[1]} · RIPCON Hub` : 'RIPCON · Hub Audiovisual'
  }, [location.pathname])

  if (loading) {
    return (
      <div className="loading" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span>Cargando permisos...</span>
      </div>
    )
  }

  if (me && me.allowed === false) {
    return <NoAccessScreen email={me.email} />
  }

  return (
    <div className="shell">
      <CommandPalette />
      <Sidebar open={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      {mobileOpen && <div className="shell-backdrop" onClick={() => setMobileOpen(false)} />}
      <div className="shell-main">
        <TopBar onMenuClick={() => setMobileOpen(v => !v)} />
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
