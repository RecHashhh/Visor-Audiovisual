// src/App.jsx
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage      from './pages/LoginPage'
import AppShell       from './components/AppShell'
import { SECTIONS }   from './config/sections'
import { AuthzProvider, RequireSection, RequireAdmin } from './utils/authz'

// Code splitting por página: la carga inicial solo trae el shell + login;
// cada sección baja su chunk la primera vez que se visita.
const HomePage       = lazy(() => import('./pages/HomePage'))
const ProjectsPage   = lazy(() => import('./pages/ProjectsPage'))
const MarcasPage     = lazy(() => import('./pages/MarcasPage'))
const BrandPage      = lazy(() => import('./pages/BrandPage'))
const WeeksPage      = lazy(() => import('./pages/WeeksPage'))
const GalleryPage    = lazy(() => import('./pages/GalleryPage'))
const SharePage      = lazy(() => import('./pages/SharePage'))
const UploadPage     = lazy(() => import('./pages/UploadPage'))
const AccessPage     = lazy(() => import('./pages/AccessPage'))
const SharesPage     = lazy(() => import('./pages/SharesPage'))
const ComingSoonPage = lazy(() => import('./pages/ComingSoonPage'))

function PageLoader() {
  return (
    <div className="loading" style={{ minHeight: '40vh' }}>
      <div className="spinner" />
    </div>
  )
}

// Guard que espera a que MSAL termine de procesar antes de decidir
function RequireAuth({ children }) {
  const isAuth = useIsAuthenticated()
  const { inProgress } = useMsal()

  // Bypass SOLO en desarrollo (import.meta.env.DEV se elimina en el build de
  // producción): permite capturar pantallas con Playwright sin login MSAL,
  // con las APIs simuladas por el interceptor del script de screenshots.
  if (import.meta.env.DEV && typeof window !== 'undefined'
      && window.localStorage.getItem('ripcon-dev-preview') === '1') {
    return children
  }

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

const soonSections = SECTIONS.filter(s => s.status === 'soon')

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
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Rutas públicas — sin layout */}
        <Route path="/login"        element={<LoginPage />} />
        <Route path="/share/:token" element={<SharePage />} />

        {/* Rutas autenticadas — un solo shell (sidebar + topbar) para todas las secciones */}
        <Route
          element={
            <RequireAuth>
              <AuthzProvider>
                <AppShell />
              </AuthzProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<HomePage />} />

          <Route path="/proyectos" element={
            <RequireSection section="material"><ProjectsPage /></RequireSection>
          } />
          <Route path="/proyectos/project/:id" element={
            <RequireSection section="material"><WeeksPage /></RequireSection>
          } />
          <Route path="/proyectos/project/:id/week/:week" element={
            <RequireSection section="material"><GalleryPage /></RequireSection>
          } />
          {/* Redirect de la ruta antigua (marcadores guardados) */}
          <Route path="/material"   element={<Navigate to="/proyectos" replace />} />
          <Route path="/material/*" element={<Navigate to="/proyectos" replace />} />

          <Route path="/marcas" element={
            <RequireSection section="marcas"><MarcasPage /></RequireSection>
          } />
          <Route path="/marcas/:brandId" element={
            <RequireSection section="marcas"><BrandPage /></RequireSection>
          } />

          <Route path="/upload"  element={<RequireAdmin><UploadPage /></RequireAdmin>} />
          <Route path="/accesos" element={<RequireAdmin><AccessPage /></RequireAdmin>} />
          <Route path="/enlaces" element={<RequireAdmin><SharesPage /></RequireAdmin>} />

          {soonSections.map(s => (
            <Route
              key={s.id}
              path={s.path}
              element={<RequireSection section={s.id}><ComingSoonPage section={s} /></RequireSection>}
            />
          ))}
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
