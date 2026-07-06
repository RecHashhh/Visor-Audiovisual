// src/App.jsx
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { lazy, Suspense, useEffect, Fragment } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage      from './pages/LoginPage'
import AppShell       from './components/AppShell'
import { SECTIONS }   from './config/sections'
import { AuthzProvider, RequireSection, RequireCap } from './utils/authz'

// Code splitting por página: la carga inicial solo trae el shell + login;
// cada sección baja su chunk la primera vez que se visita.
const HomePage         = lazy(() => import('./pages/HomePage'))
const ProjectsPage     = lazy(() => import('./pages/ProjectsPage'))
const WeeksPage        = lazy(() => import('./pages/WeeksPage'))
const GalleryPage      = lazy(() => import('./pages/GalleryPage'))
const MediaSectionPage = lazy(() => import('./pages/MediaSectionPage'))
const MediaFolderPage  = lazy(() => import('./pages/MediaFolderPage'))
const SharePage        = lazy(() => import('./pages/SharePage'))
const UploadPage       = lazy(() => import('./pages/UploadPage'))
const AccessPage       = lazy(() => import('./pages/AccessPage'))
const SharesPage       = lazy(() => import('./pages/SharesPage'))

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
  // producción): permite capturar pantallas con Playwright sin login MSAL.
  if (import.meta.env.DEV && typeof window !== 'undefined'
      && window.localStorage.getItem('ripcon-dev-preview') === '1') {
    return children
  }

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

const mediaSections = SECTIONS.filter(s => s.kind === 'media')

export default function App() {
  const isAuth = useIsAuthenticated()
  const { inProgress } = useMsal()

  useEffect(() => {
    if (!isAuth || inProgress !== InteractionStatus.None) return
    const ping = () => { fetch('/api/health', { cache: 'no-store' }).catch(() => {}) }
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

        {/* Rutas autenticadas — un solo shell para todas las secciones */}
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
            <RequireSection section="proyectos"><ProjectsPage /></RequireSection>
          } />
          <Route path="/proyectos/project/:id" element={
            <RequireSection section="proyectos"><WeeksPage /></RequireSection>
          } />
          <Route path="/proyectos/project/:id/week/:week" element={
            <RequireSection section="proyectos"><GalleryPage /></RequireSection>
          } />
          {/* Redirect de la ruta antigua (marcadores guardados) */}
          <Route path="/material"   element={<Navigate to="/proyectos" replace />} />
          <Route path="/material/*" element={<Navigate to="/proyectos" replace />} />

          {/* Secciones de biblioteca (Marcas, Documentos, Videos, Eventos, Redes) */}
          {mediaSections.map(s => (
            <Fragment key={s.id}>
              <Route path={s.path} element={
                <RequireSection section={s.id}><MediaSectionPage sectionId={s.id} /></RequireSection>
              } />
              <Route path={`${s.path}/:folder`} element={
                <RequireSection section={s.id}><MediaFolderPage sectionId={s.id} /></RequireSection>
              } />
            </Fragment>
          ))}
          {/* Redirect de la ruta de video antigua */}
          <Route path="/videos-corporativos"   element={<Navigate to="/videos" replace />} />
          <Route path="/fotografia-eventos"     element={<Navigate to="/eventos" replace />} />
          <Route path="/redes-sociales"         element={<Navigate to="/redes" replace />} />

          <Route path="/upload"  element={<RequireCap cap="upload"><UploadPage /></RequireCap>} />
          <Route path="/accesos" element={<RequireCap cap="manageAccess"><AccessPage /></RequireCap>} />
          <Route path="/enlaces" element={<RequireCap cap="share"><SharesPage /></RequireCap>} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
