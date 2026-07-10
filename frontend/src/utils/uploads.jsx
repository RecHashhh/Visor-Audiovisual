// src/utils/uploads.jsx
// Gestor GLOBAL de subidas: las subidas viven aquí (sobre el router), así siguen
// corriendo mientras navegas entre secciones. Un widget abajo a la derecha
// muestra el progreso. Avisa antes de recargar/cerrar si hay algo en curso.
//
// Límite honesto del navegador: una subida NO sobrevive a un F5/cerrar pestaña
// (se pierde el File en memoria). Por eso el beforeunload avisa.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { uploadFileToBlob } from './blobUpload'

const UploadsCtx = createContext(null)
let _seq = 0

export function UploadsProvider({ children }) {
  const [tasks, setTasks] = useState([])

  const patch = useCallback((id, p) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...p } : t)))
  }, [])

  const enqueue = useCallback((files, ctx) => {
    const arr = Array.from(files || [])
    if (!arr.length || !ctx?.sectionId || !ctx?.folder) return
    const batch = arr.map(f => ({
      id: ++_seq, file: f, name: f.name, size: f.size,
      sectionId: ctx.sectionId, sectionLabel: ctx.sectionLabel || ctx.sectionId, folder: ctx.folder,
      pct: 0, status: 'queued', error: null,
    }))
    setTasks(prev => [...batch, ...prev])

    ;(async () => {
      let planned = []
      try {
        const plan = await api.postMediaUploadPlan(ctx.sectionId, ctx.folder, arr.map(f => ({ name: f.name, size: f.size })))
        planned = plan.files || []
      } catch (e) {
        batch.forEach(t => patch(t.id, { status: 'error', error: e.message }))
        return
      }
      for (let i = 0; i < batch.length; i++) {
        const t = batch[i]
        const p = planned[i]
        if (!p || p.status === 'omitido' || !p.sasUrl) {
          patch(t.id, { status: 'error', error: p?.reason || 'No se pudo preparar' })
          continue
        }
        patch(t.id, { status: 'uploading', pct: 0 })
        let lastPct = -1
        try {
          await uploadFileToBlob(p.sasUrl, t.file, p.contentType, loaded => {
            const pct = Math.min(100, Math.round((loaded / (t.size || 1)) * 100))
            if (pct !== lastPct) { lastPct = pct; patch(t.id, { pct }) }
          })
          patch(t.id, { status: 'done', pct: 100 })
          // Avisar a la página de esa carpeta para que recargue su contenido.
          window.dispatchEvent(new CustomEvent('ripcon:upload-done', { detail: { sectionId: t.sectionId, folder: t.folder } }))
        } catch (e) {
          patch(t.id, { status: 'error', error: e.message })
        }
      }
    })()
  }, [patch])

  const dismiss = useCallback(id => setTasks(prev => prev.filter(t => t.id !== id)), [])
  const clearFinished = useCallback(() => setTasks(prev => prev.filter(t => t.status === 'uploading' || t.status === 'queued')), [])

  // Avisar antes de recargar/cerrar si hay subidas activas.
  useEffect(() => {
    const active = tasks.some(t => t.status === 'uploading' || t.status === 'queued')
    if (!active) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [tasks])

  const value = useMemo(() => ({ tasks, enqueue, dismiss, clearFinished }), [tasks, enqueue, dismiss, clearFinished])
  return <UploadsCtx.Provider value={value}>{children}</UploadsCtx.Provider>
}

export function useUploads() {
  return useContext(UploadsCtx) || { tasks: [], enqueue: () => {}, dismiss: () => {}, clearFinished: () => {} }
}

function fmtSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Widget flotante abajo a la derecha.
export function UploadTray() {
  const { tasks, dismiss, clearFinished } = useUploads()
  const [open, setOpen] = useState(true)
  if (!tasks.length) return null

  const active = tasks.filter(t => t.status === 'uploading' || t.status === 'queued')
  const done = tasks.filter(t => t.status === 'done')
  const failed = tasks.filter(t => t.status === 'error')
  const busy = active.length > 0

  const title = busy
    ? `Subiendo ${active.length} archivo${active.length !== 1 ? 's' : ''}…`
    : failed.length
      ? `${done.length} subido${done.length !== 1 ? 's' : ''}, ${failed.length} con error`
      : `${done.length} subido${done.length !== 1 ? 's' : ''}`

  return (
    <div className="uptray" role="status" aria-live="polite">
      <div className="uptray-head" onClick={() => setOpen(o => !o)}>
        <span className="uptray-title">
          {busy ? <span className="uptray-spin" aria-hidden="true" /> : <span className="uptray-check" aria-hidden="true">✓</span>}
          {title}
        </span>
        <div className="uptray-head-actions" onClick={e => e.stopPropagation()}>
          {!busy && <button className="uptray-clear" onClick={clearFinished}>Limpiar</button>}
          <button className="uptray-toggle" onClick={() => setOpen(o => !o)} aria-label={open ? 'Minimizar' : 'Expandir'}>{open ? '▾' : '▴'}</button>
        </div>
      </div>
      {open && (
        <div className="uptray-body">
          {tasks.map(t => (
            <div key={t.id} className={`uptray-item ${t.status}`}>
              <div className="uptray-item-top">
                <span className="uptray-item-name" title={t.name}>{t.name}</span>
                <span className="uptray-item-meta">
                  {t.status === 'error' ? 'Error' : t.status === 'done' ? 'Listo' : t.status === 'queued' ? 'En cola' : `${t.pct}%`}
                </span>
                {(t.status === 'done' || t.status === 'error') && (
                  <button className="uptray-item-x" onClick={() => dismiss(t.id)} aria-label="Quitar">×</button>
                )}
              </div>
              {(t.status === 'uploading' || t.status === 'queued' || t.status === 'done') && (
                <div className="uptray-bar"><div className="uptray-fill" style={{ transform: `scaleX(${t.pct / 100})` }} /></div>
              )}
              <div className="uptray-item-dest">{t.status === 'error' ? (t.error || 'Error') : `${t.sectionLabel} · ${t.folder} · ${fmtSize(t.size)}`}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
