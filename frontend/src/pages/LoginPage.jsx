// src/pages/LoginPage.jsx
import { useMsal, useIsAuthenticated } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { Navigate } from 'react-router-dom'
import { loginRequest } from '../authConfig'

export default function LoginPage() {
  const { instance, inProgress } = useMsal()
  const isAuth = useIsAuthenticated()

  // Esperando que MSAL procese el redirect — no hacer nada todavía
  if (inProgress !== InteractionStatus.None) {
    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            Verificando sesión...
          </div>
        </div>
      </div>
    )
  }

  // Ya autenticado — ir a proyectos
  if (isAuth) return <Navigate to="/" replace />

  return (
    <div className="login-screen">
      <div className="login-card">
        <img
          className="login-logo-img only-light"
          src="/brands/ripconciv/thumbs/horizontal-positivo-azul.png"
          alt="RIPCONCIV"
        />
        <img
          className="login-logo-img only-dark"
          src="/brands/ripconciv/wordmark-white.png"
          alt="RIPCONCIV"
        />
        <div className="login-subtitle">
          Hub Audiovisual — material de obra, marcas y contenido de la empresa
        </div>

        <button
          className="login-btn"
          onClick={() => instance.loginRedirect(loginRequest)}
          disabled={inProgress !== InteractionStatus.None}
        >
          <MsIcon />
          Iniciar sesión con Microsoft
        </button>

        <div className="login-note">
          Requiere cuenta corporativa Microsoft 365
        </div>
      </div>
    </div>
  )
}

function MsIcon() {
  return (
    <svg style={{ width: 20, height: 20, flexShrink: 0 }} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  )
}

