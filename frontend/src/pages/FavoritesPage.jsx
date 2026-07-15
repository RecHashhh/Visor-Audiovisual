// src/pages/FavoritesPage.jsx
// Favoritos del usuario: sus colecciones con nombre. Ve las fotos que marcó,
// comparte cada colección como link (sin login) y puede renombrar/eliminar.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../utils/api'
import { fetchThumb } from '../utils/thumbs'
import { useFavorites } from '../utils/favorites'
import Modal from '../components/Modal'

const IMG_EXTS = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp', 'gif']
const isImg = (n) => IMG_EXTS.includes((n.split('.').pop() || '').toLowerCase())

function Thumb({ item }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    if (!isImg(item.name)) return
    fetchThumb(item.path, { w: 360, q: 66 })
      .then(u => { if (alive) setSrc(u) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [item.path, item.name])

  if (isImg(item.name) && src) return <img src={src} alt={item.name} loading="lazy" />
  return (
    <div className="fav-thumb-icon">
      <span>{isImg(item.name) ? (failed ? '🖼️' : '') : '▶'}</span>
    </div>
  )
}

export default function FavoritesPage() {
  const { collections, loaded, renameCollection, deleteCollection, removeFromCollection, refresh } = useFavorites()
  const [activeId, setActiveId] = useState(null)
  const [share, setShare] = useState(null)         // { cid, days, url, loading, error }
  const [copied, setCopied] = useState(false)
  const [renaming, setRenaming] = useState(null)   // { cid, name }

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeId && collections.length) setActiveId(collections[0].id)
    if (activeId && !collections.some(c => c.id === activeId)) setActiveId(collections[0]?.id || null)
  }, [collections, activeId])

  const active = useMemo(() => collections.find(c => c.id === activeId) || null, [collections, activeId])

  const openShare = (cid) => setShare({ cid, days: 30, url: null, loading: false, error: null })
  const setDays = (days) => setShare(s => ({ ...s, days, url: null }))   // cambiar el plazo limpia el link previo
  const generate = async () => {
    setShare(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await api.shareFavCollection(share.cid, share.days)
      setShare(s => ({ ...s, url: res.shareUrl || `${window.location.origin}/share/${res.token}`, loading: false }))
    } catch (e) {
      setShare(s => ({ ...s, loading: false, error: e.message }))
    }
  }
  const copy = (url) => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  const doRename = async () => {
    const name = renaming.name.trim()
    if (!name) return
    await renameCollection(renaming.cid, name)
    setRenaming(null)
  }

  const doDelete = async (c) => {
    if (!window.confirm(`¿Eliminar la colección “${c.name}”? (no borra las fotos, solo la colección)`)) return
    await deleteCollection(c.id)
  }

  return (
    <>
      <div className="page-header brand-page-header">
        <div>
          <h1 className="page-title">⭐ Favoritos</h1>
          <p className="page-sub">Tus colecciones de fotos favoritas. Solo tú las ves. Compártelas como enlace cuando quieras.</p>
        </div>
      </div>

      {!loaded && <div className="loading"><div className="spinner" /></div>}

      {loaded && collections.length === 0 && (
        <div className="empty">
          <div className="empty-text">Aún no tienes favoritos</div>
          <p className="access-empty-hint">
            Entra a un proyecto, pasa el mouse por una foto y toca el ♥ para guardarla en una colección.
            Luego aparecerán aquí.
          </p>
          <Link className="btn btn-primary" to="/proyectos" style={{ marginTop: 12 }}>Ir a Proyectos</Link>
        </div>
      )}

      {loaded && collections.length > 0 && (
        <>
          <div className="fav-col-tabs">
            {collections.map(c => (
              <button key={c.id} className={`fav-col-tab ${c.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
                {c.name} <span className="fav-col-tab-count">{(c.items || []).length}</span>
              </button>
            ))}
          </div>

          {active && (
            <>
              <div className="fav-col-bar">
                <div className="fav-col-bar-title">{active.name} · {(active.items || []).length} fotos</div>
                <div className="fav-col-bar-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => openShare(active.id)} disabled={!(active.items || []).length}>
                    Compartir
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRenaming({ cid: active.id, name: active.name })}>Renombrar</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => doDelete(active)}>Eliminar</button>
                </div>
              </div>

              {share && share.cid === active.id && (
                <div className="fav-share-box">
                  <div className="fav-share-hint">¿Cuánto quieres que dure el enlace?</div>
                  <div className="fav-share-exp">
                    {[7, 30, 90].map(d => (
                      <button key={d} className={`filter-chip ${share.days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d} días</button>
                    ))}
                    <button className="btn btn-primary btn-sm" onClick={generate} disabled={share.loading}>
                      {share.loading ? 'Generando…' : (share.url ? 'Generar otro' : 'Generar enlace')}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShare(null)} disabled={share.loading}>Cancelar</button>
                  </div>
                  {share.error && <div className="field-error" style={{ marginTop: 8 }}>{share.error}</div>}
                  {share.url && (
                    <div className="fav-share-row" style={{ marginTop: 10 }}>
                      <div className="fav-share-linkrow">
                        <code>{share.url}</code>
                        <button className="btn btn-primary btn-sm" onClick={() => copy(share.url)}>{copied ? 'Copiado ✓' : 'Copiar'}</button>
                      </div>
                      <span className="fav-share-hint">Enlace público (sin login) · caduca en {share.days} días</span>
                    </div>
                  )}
                </div>
              )}

              {(active.items || []).length === 0 ? (
                <div className="empty"><div className="empty-text">Esta colección está vacía</div>
                  <p className="access-empty-hint">Agrega fotos tocando el ♥ dentro de los proyectos.</p></div>
              ) : (
                <div className="gallery-grid fav-grid">
                  {(active.items || []).map(item => (
                    <div key={item.path} className="gallery-item fav-item">
                      <Thumb item={item} />
                      <button
                        className="gallery-fav-btn is-fav fav-remove"
                        title="Quitar de esta colección"
                        aria-label="Quitar de esta colección"
                        onClick={() => removeFromCollection(active.id, item.path).catch(() => {})}
                      >×</button>
                      <div className="gallery-item-label">
                        {item.projectCode ? `${item.projectCode} · ` : ''}{item.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Renombrar colección"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setRenaming(null)}>Cancelar</button>
          <button className="btn btn-primary" onClick={doRename} disabled={!renaming?.name.trim()}>Guardar</button>
        </>}
      >
        {renaming && (
          <label className="field">
            <span className="field-label">Nuevo nombre</span>
            <input className="field-input" autoFocus value={renaming.name}
              onChange={e => setRenaming({ ...renaming, name: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && renaming.name.trim()) doRename() }} />
          </label>
        )}
      </Modal>
    </>
  )
}
