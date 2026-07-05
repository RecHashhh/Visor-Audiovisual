// src/components/TopBar.jsx
import { useState } from 'react'
import { useMsal } from '@azure/msal-react'

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export default function TopBar({ onMenuClick }) {
  const { instance, accounts } = useMsal()
  const user = accounts[0]
  const initials = user?.name?.split(' ').map(n => n[0]).slice(0,2).join('') || 'U'
  const [theme, setTheme] = useState(currentTheme)

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('ripcon-theme', next) } catch { /* almacenamiento bloqueado: solo esta sesión */ }
    setTheme(next)
  }

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar-menu-btn"
        onClick={onMenuClick}
        aria-label="Abrir menú de secciones"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="topbar-sep" />
      <div className="topbar-user">
        <button
          type="button"
          className="icon-btn"
          onClick={() => window.dispatchEvent(new Event('ripcon:cmdk'))}
          aria-label="Buscar (Ctrl+K)"
          title="Buscar (Ctrl+K)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
            </svg>
          )}
        </button>
        <span>{user?.username || user?.name}</span>
        <div className="topbar-avatar">{initials}</div>
        <button className="btn-logout" onClick={() => instance.logoutRedirect()}>
          Salir
        </button>
      </div>
    </header>
  )
}
