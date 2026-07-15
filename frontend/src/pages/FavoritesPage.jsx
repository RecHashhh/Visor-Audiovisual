// src/pages/FavoritesPage.jsx
// Favoritos del usuario: sus colecciones con nombre, una debajo de otra. Cada
// una muestra una tira de fotos (se desplaza a la derecha) y "Ver todas" abre
// esa colección sola en grande. Comparte cada colección como link (sin login).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../utils/api'
import { fetchThumb } from '../utils/thumbs'
import { useFavorites } from '../utils/favorites'
import { useDownloads } from '../utils/downloads'
import Modal from '../components/Modal'

const IMG_EXTS = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp', 'gif']
const isImg = (n) => IMG_EXTS.includes((n.split('.').pop() || '').toLowerCase())
const STRIP_LIMIT = 12   // cuántas fotos se ven en la tira antes de "Ver todas"

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
  return <div className="fav-thumb-icon"><span>{isImg(item.name) ? (failed ? '🖼️' : '') : '▶'}</span></div>
}

function PhotoTile({ item, onRemove }) {
  return (
    <div className="gallery-item fav-item">
      <Thumb item={item} />
      <button className="gallery-fav-btn is-fav fav-remove" title="Quitar de esta colección"
        aria-label="Quitar de esta colección" onClick={onRemove}>×</button>
      <div className="gallery-item-label">{item.projectCode ? `${item.projectCode} · ` : ''}{item.name}</div>
    </div>
  )
}

export default function FavoritesPage() {
  const { collections, loaded, renameCollection, deleteCollection, removeFromCollection, refresh } = useFavorites()
  const { downloadZip, isBusy } = useDownloads()
  const [viewingId, setViewingId] = useState(null)   // colección abierta en grande (o null = lista)
  const [share, setShare] = useState(null)           // { cid, days, url, loading, error }
  const [copied, setCopied] = useState(false)
  const [renaming, setRenaming] = useState(null)     // { cid, name }

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const viewing = useMemo(() => collections.find(c => c.id === viewingId) || null, [collections, viewingId])
  useEffect(() => {
    if (viewingId && !collections.some(c => c.id === viewingId)) setViewingId(null)
  }, [collections, viewingId])

  const openShare = (cid) => setShare({ cid, days: 30, url: null, loading: false, error: null })
  const setDays = (days) => setShare(s => ({ ...s, days, url: null }))
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
    if (viewingId === c.id) setViewingId(null)
  }

  const downloadCollection = async (c) => {
    const items = c.items || []
    if (!items.length || isBusy()) return
    const resolved = await Promise.all(items.map(async it => ({ name: it.name, url: (await api.getSasUrl(it.path, 120)).sasUrl })))
    downloadZip(resolved, `${c.name || 'favoritos'}.zip`)
  }

  // Barra de acciones + panel de compartir, reutilizable en lista y en detalle.
  const Actions = ({ c }) => (
    <div className="fav-col-bar-actions">
      <button className="btn btn-primary btn-sm" onClick={() => openShare(c.id)} disabled={!(c.items || []).length}>Compartir</button>
      <button className="btn btn-ghost btn-sm" onClick={() => downloadCollection(c)} disabled={!(c.items || []).length || isBusy()}>Descargar ZIP</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setRenaming({ cid: c.id, name: c.name })}>Renombrar</button>
      <button className="btn btn-ghost btn-sm" onClick={() => doDelete(c)}>Eliminar</button>
    </div>
  )
  const SharePanel = ({ c }) => (share && share.cid === c.id) ? (
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
  ) : null

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
            Entra a un proyecto, pasa el mouse por una foto y toca el ♥ para guardarla en una colección. Luego aparecerán aquí.
          </p>
          <Link className="btn btn-primary" to="/proyectos" style={{ marginTop: 12 }}>Ir a Proyectos</Link>
        </div>
      )}

      {/* DETALLE: una colección sola, en grilla completa */}
      {loaded && viewing && (
        <div className="fav-detail">
          <button className="btn btn-ghost btn-sm fav-back" onClick={() => setViewingId(null)}>‹ Todas las colecciones</button>
          <div className="fav-col-bar">
            <div className="fav-col-bar-title">{viewing.name} · {(viewing.items || []).length} fotos</div>
            <Actions c={viewing} />
          </div>
          <SharePanel c={viewing} />
          {(viewing.items || []).length === 0 ? (
            <div className="empty"><div className="empty-text">Esta colección está vacía</div></div>
          ) : (
            <div className="gallery-grid fav-grid">
              {(viewing.items || []).map(item => (
                <PhotoTile key={item.path} item={item} onRemove={() => removeFromCollection(viewing.id, item.path).catch(() => {})} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* LISTA: colecciones una debajo de otra, con tira horizontal */}
      {loaded && !viewing && collections.length > 0 && (
        <div className="fav-sections">
          {collections.map(c => {
            const items = c.items || []
            const strip = items.slice(0, STRIP_LIMIT)
            const rest = items.length - strip.length
            return (
              <section key={c.id} className="fav-section">
                <div className="fav-col-bar">
                  <button className="fav-section-title" onClick={() => setViewingId(c.id)} title="Ver todas">
                    {c.name} <span className="fav-section-count">{items.length} fotos</span>
                  </button>
                  <Actions c={c} />
                </div>
                <SharePanel c={c} />
                {items.length === 0 ? (
                  <div className="fav-section-empty">Colección vacía. Agrega fotos tocando el ♥ dentro de los proyectos.</div>
                ) : (
                  <div className="fav-strip">
                    {strip.map(item => (
                      <div key={item.path} className="fav-strip-item">
                        <PhotoTile item={item} onRemove={() => removeFromCollection(c.id, item.path).catch(() => {})} />
                      </div>
                    ))}
                    {rest > 0 && (
                      <button className="fav-strip-more" onClick={() => setViewingId(c.id)}>
                        <span className="fav-strip-more-plus">+{rest}</span>
                        <span>Ver todas</span>
                      </button>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
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
