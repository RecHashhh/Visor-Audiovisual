// src/pages/SharesPage.jsx
// Administración de enlaces externos: ver qué enlaces compartidos siguen
// vivos, copiarlos y revocarlos. Solo administradores.
import { useEffect, useState } from 'react'
import { api } from '../utils/api'

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SharesPage() {
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copiedToken, setCopiedToken] = useState(null)
  const [revoking, setRevoking] = useState(null)

  function load() {
    setLoading(true)
    setError(null)
    api.listShares()
      .then(data => setShares(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function copyLink(token) {
    const url = `${window.location.origin}/share/${token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(t => (t === token ? null : t)), 2500)
    } catch {
      window.prompt('Copia el enlace:', url)
    }
  }

  async function revoke(token) {
    if (!window.confirm('¿Revocar este enlace? Quien lo tenga dejará de poder abrirlo.')) return
    setRevoking(token)
    try {
      await api.revokeShare(token)
      setShares(prev => prev.filter(s => s.token !== token))
    } catch (e) {
      alert(`No se pudo revocar: ${e.message}`)
    } finally {
      setRevoking(null)
    }
  }

  const active = shares.filter(s => !s.expired && s.active !== false)
  const inactive = shares.filter(s => s.expired || s.active === false)

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Enlaces compartidos</h1>
        <p className="page-sub">
          Enlaces externos (sin login) generados desde las semanas de proyecto.
          Revoca los que ya no deban circular.
        </p>
      </div>

      {loading && <div className="loading"><div className="spinner" /><span>Cargando enlaces...</span></div>}
      {error && <div className="loading" style={{ color: 'var(--red)' }}>No se pudieron cargar los enlaces: {error}</div>}

      {!loading && !error && shares.length === 0 && (
        <div className="empty">
          <div className="empty-text">No hay enlaces compartidos</div>
          <p className="access-empty-hint">
            Se crean desde una semana de proyecto con "Compartir semana".
          </p>
        </div>
      )}

      {active.length > 0 && (
        <section className="logo-group">
          <h2 className="logo-group-title">Activos <span className="logo-group-count">{active.length}</span></h2>
          <div className="media-file-list">
            {active.map(s => (
              <div key={s.token} className="media-file-row">
                <div className="share-info">
                  <span className="media-file-name">{s.projectId}{s.week ? ` · ${s.week}` : ''}</span>
                  <span className="share-expiry">Expira {fmtDate(s.expiresAt)}</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => copyLink(s.token)}>
                  {copiedToken === s.token ? 'Copiado ✓' : 'Copiar enlace'}
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => revoke(s.token)}
                  disabled={revoking === s.token}
                >
                  {revoking === s.token ? 'Revocando...' : 'Revocar'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {inactive.length > 0 && (
        <section className="logo-group">
          <h2 className="logo-group-title">Expirados o revocados <span className="logo-group-count">{inactive.length}</span></h2>
          <div className="media-file-list">
            {inactive.map(s => (
              <div key={s.token} className="media-file-row share-row-inactive">
                <div className="share-info">
                  <span className="media-file-name">{s.projectId}{s.week ? ` · ${s.week}` : ''}</span>
                  <span className="share-expiry">Expiró {fmtDate(s.expiresAt)}</span>
                </div>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => revoke(s.token)}
                  disabled={revoking === s.token}
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
