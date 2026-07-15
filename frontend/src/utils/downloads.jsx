// src/utils/downloads.jsx
// Descargas con indicador: al descargar (una o varias en ZIP) aparece un toast
// abajo a la izquierda mostrando el avance, y se bloquea otra descarga mientras
// tanto (para no dar varias veces "Descargar"). Funciona en cualquier sección.
import { createContext, useContext, useState, useRef, useCallback } from 'react'
import { buildZip } from './zip'

const Ctx = createContext(null)

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function DownloadsProvider({ children }) {
  const [job, setJob] = useState(null)   // { label, mode:'single'|'zip', done, total, phase }
  const busyRef = useRef(false)

  const downloadSingle = useCallback(async (url, filename) => {
    if (busyRef.current || !url) return
    busyRef.current = true
    setJob({ label: filename, mode: 'single', done: 0, total: 1 })
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))
      saveBlob(await res.blob(), filename)
    } catch {
      // Si falla el fetch (CORS/red), al menos abrimos la URL directa.
      try { window.location.href = url } catch { /* noop */ }
    } finally {
      busyRef.current = false
      setJob(null)
    }
  }, [])

  // files: [{ name, url }]  (url ya resuelta con SAS)
  const downloadZip = useCallback(async (files, zipName = 'descarga.zip') => {
    if (busyRef.current || !files?.length) return
    busyRef.current = true
    setJob({ label: zipName, mode: 'zip', done: 0, total: files.length, phase: 'descargando' })
    try {
      const blob = await buildZip(files, (done, total, phase) => setJob(j => (j ? { ...j, done, total, phase } : j)))
      saveBlob(blob, zipName)
    } catch (e) {
      setJob({ label: zipName, mode: 'zip', error: e.message })
      await new Promise(r => setTimeout(r, 4000))
    } finally {
      busyRef.current = false
      setJob(null)
    }
  }, [])

  const isBusy = useCallback(() => busyRef.current, [])

  return (
    <Ctx.Provider value={{ job, downloadSingle, downloadZip, isBusy }}>
      {children}
      <DownloadToast job={job} />
    </Ctx.Provider>
  )
}

function DownloadToast({ job }) {
  if (!job) return null
  const pct = job.mode === 'zip' && job.total ? Math.round((job.done / job.total) * 100) : null
  return (
    <div className="dl-toast" role="status" aria-live="polite">
      {job.error ? (
        <>
          <span className="dl-toast-x">⚠️</span>
          <div className="dl-toast-body">
            <div className="dl-toast-title">No se pudo descargar</div>
            <div className="dl-toast-sub">{job.error}</div>
          </div>
        </>
      ) : (
        <>
          <span className="dl-toast-spin"><span className="spinner" /></span>
          <div className="dl-toast-body">
            <div className="dl-toast-title">
              {job.mode === 'zip'
                ? (job.phase === 'comprimiendo' ? 'Comprimiendo ZIP…' : `Descargando ${job.done}/${job.total}…`)
                : 'Descargando…'}
            </div>
            <div className="dl-toast-sub">{job.label}</div>
            {pct != null && <div className="dl-toast-bar"><span style={{ width: `${pct}%` }} /></div>}
          </div>
        </>
      )}
    </div>
  )
}

export function useDownloads() {
  return useContext(Ctx) || {
    job: null, downloadSingle: async () => {}, downloadZip: async () => {}, isBusy: () => false,
  }
}
