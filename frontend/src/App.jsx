// src/App.jsx
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage    from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import WeeksPage    from './pages/WeeksPage'
import GalleryPage  from './pages/GalleryPage'
import SharePage    from './pages/SharePage'
import TopBar       from './components/TopBar'

// Guard que espera a que MSAL termine de procesar antes de decidir
function RequireAuth({ children }) {
  const isAuth = useIsAuthenticated()
  const { inProgress } = useMsal()

  // MSAL todavía está procesando el redirect — mostrar loader, NO redirigir
  if (inProgress !== InteractionStatus.None) {
    return (
      <div className="loading" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span>Verificando sesión...</span>
      </div>
    )
  }

  if (!isAuth) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const isAuth = useIsAuthenticated()
  const { inProgress } = useMsal()

  useEffect(() => {
    if (!isAuth || inProgress !== InteractionStatus.None) return

    const ping = () => {
      fetch('/api/health', { cache: 'no-store' }).catch(() => {})
    }

    ping()
    const id = setInterval(ping, 2 * 60 * 1000)
    return () => clearInterval(id)
  }, [isAuth, inProgress])

  return (
    <Routes>
      {/* Rutas públicas — sin layout */}
      <Route path="/login"        element={<LoginPage />} />
      <Route path="/share/:token" element={<SharePage />} />

      {/* Rutas autenticadas — con TopBar y layout */}
      <Route path="/" element={
        <RequireAuth>
          <div className="layout">
            <TopBar />
            <main className="main">
              <ProjectsPage />
            </main>
          </div>
        </RequireAuth>
      } />

      <Route path="/project/:id" element={
        <RequireAuth>
          <div className="layout">
            <TopBar />
            <main className="main">
              <WeeksPage />
            </main>
          </div>
        </RequireAuth>
      } />

      <Route path="/project/:id/week/:week" element={
        <RequireAuth>
          <div className="layout">
            <TopBar />
            <main className="main">
              <GalleryPage />
            </main>
          </div>
        </RequireAuth>
      } />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
