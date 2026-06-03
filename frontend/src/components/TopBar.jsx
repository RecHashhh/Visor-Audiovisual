// src/components/TopBar.jsx
import { useMsal } from '@azure/msal-react'
import { Link } from 'react-router-dom'

export default function TopBar() {
  const { instance, accounts } = useMsal()
  const user = accounts[0]
  const initials = user?.name?.split(' ').map(n => n[0]).slice(0,2).join('') || 'U'

  return (
    <header className="topbar">
      <Link to="/" style={{ textDecoration: 'none' }}>
        <div className="topbar-logo">
          VISOR<span>/</span>AUDIOVISUAL
        </div>
      </Link>
      <nav style={{ marginLeft: 12 }}>
        <Link to="/upload" style={{ marginRight: 12 }}>Subir</Link>
      </nav>
      <div className="topbar-sep" />
      <div className="topbar-user">
        <span style={{ display: 'none', gap: '6px' }}></span>
        <span>{user?.username || user?.name}</span>
        <div className="topbar-avatar">{initials}</div>
        <button className="btn-logout" onClick={() => instance.logoutRedirect()}>
          Salir
        </button>
      </div>
    </header>
  )
}
