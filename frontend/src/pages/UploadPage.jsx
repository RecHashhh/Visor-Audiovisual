// src/pages/UploadPage.jsx
// Subida unificada. Primero eliges DESTINO:
//   • Proyecto de obra → renombrado por prefijo/fecha, con fuentes "Mi equipo"
//     (directo navegador→blob), SharePoint u OneDrive (migración por lotes con
//     conteo y progreso, sin depender del timeout de la Function).
//   • Biblioteca (Marcas, Documentos, etc.) → carpeta libre, nombres originales.
import { useState, useRef, useEffect, useMemo } from 'react'
import { api } from '../utils/api'
import { uploadFileToBlob } from '../utils/blobUpload'
import { useUploads } from '../utils/uploads'
import { useAuthz, hasCap, canItem } from '../utils/authz'
import { SECTIONS } from '../config/sections'

const PREFIJOS = ['FOT', 'DRN', 'VID', 'I360', 'E360']
const LOCAL_CONCURRENCY = 3
const REMOTE_CHUNK = 200
const STATUS_CLS = { completo: 'badge-green', subiendo: 'badge-orange', pendiente: 'badge-red' }
const MEDIA_SECTIONS = SECTIONS.filter(s => s.kind === 'media')

function fmtSize(b) {
  if (!b) return '0 B'
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function UploadPage() {
  const { me } = useAuthz()
  const [destination, setDestination] = useState('proyecto') // 'proyecto' | 'biblioteca'
  const canProjects = hasCap(me, 'upload')
  const manageableMedia = MEDIA_SECTIONS.filter(() => hasCap(me, 'manageMedia'))

  useEffect(() => {
    if (!canProjects && manageableMedia.length) setDestination('biblioteca')
  }, [canProjects, manageableMedia.length])

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Subir material</h1>
        <p className="page-sub">Elige a dónde va el contenido y desde dónde lo tomas.</p>
      </div>

      <div className="up-dest">
        {canProjects && (
          <button className={`up-dest-btn ${destination === 'proyecto' ? 'active' : ''}`} onClick={() => setDestination('proyecto')}>
            <strong>Proyecto de obra</strong>
            <span>Fotos, dron y video por proyecto y semana (renombrado por prefijo y fecha).</span>
          </button>
        )}
        {manageableMedia.length > 0 && (
          <button className={`up-dest-btn ${destination === 'biblioteca' ? 'active' : ''}`} onClick={() => setDestination('biblioteca')}>
            <strong>Biblioteca</strong>
            <span>Marcas, documentos, plantillas y demás: carpeta libre con nombres originales.</span>
          </button>
        )}
      </div>

      {destination === 'proyecto' ? <ProjectUpload /> : <LibraryUpload sections={manageableMedia} me={me} />}
    </>
  )
}

/* ═══════════════════════════ DESTINO: PROYECTO ═══════════════════════════ */
function ProjectUpload() {
  const [projectMode, setProjectMode] = useState('existing')
  const [projects, setProjects] = useState([])
  const [projLoading, setProjLoading] = useState(true)
  const [projError, setProjError] = useState(null)
  const [selectedCode, setSelectedCode] = useState('')
  const [search, setSearch] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')

  const [prefijo, setPrefijo] = useState('FOT')
  const [keepNames, setKeepNames] = useState(false)
  const [refreshIndex, setRefreshIndex] = useState(true)
  const [recursive, setRecursive] = useState(true)

  const [source, setSource] = useState('local') // 'local' | 'sharepoint' | 'onedrive'
  const [result, setResult] = useState(null)

  const selected = projects.find(p => p.code === selectedCode)
  const activeCode = projectMode === 'existing' ? selectedCode : newCode.trim()
  const activeName = projectMode === 'existing' ? (selected?.name || '') : newName.trim()
  const ready = Boolean(activeCode && activeName)

  const filtered = projects.filter(p => {
    const t = search.trim().toLowerCase()
    return !t || p.code.toLowerCase().includes(t) || (p.name || '').toLowerCase().includes(t)
  })

  function loadProjects() {
    setProjLoading(true); setProjError(null)
    api.getProjects()
      .then(data => {
        const arr = Array.isArray(data) ? data : []
        setProjects(arr)
        if (arr.length === 0) setProjectMode('new')
        else if (!arr.some(p => p.code === selectedCode)) setSelectedCode(arr[0]?.code || '')
      })
      .catch(e => setProjError(e.message))
      .finally(() => setProjLoading(false))
  }
  useEffect(() => { loadProjects() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="up-root">
      <div className="up-left">
        <div className="up-left-header">
          <h2>Proyecto destino</h2>
          <p>Elige uno existente o crea uno nuevo</p>
        </div>
        <div className="up-proj-tabs">
          <button type="button" className={`up-tab ${projectMode === 'existing' ? 'active' : ''}`} onClick={() => setProjectMode('existing')}>Existente</button>
          <button type="button" className={`up-tab ${projectMode === 'new' ? 'active' : ''}`} onClick={() => setProjectMode('new')}>Nuevo</button>
          <button type="button" className="up-tab up-tab-icon" onClick={loadProjects} disabled={projLoading} title="Actualizar lista">↻</button>
        </div>

        {projectMode === 'existing' ? (
          <>
            <div className="up-search-wrap">
              <input className="up-search" placeholder="Buscar por código o nombre…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="up-proj-list">
              {projLoading && <div className="up-empty">Cargando proyectos…</div>}
              {projError && <div className="up-empty" style={{ color: 'var(--red)' }}>{projError}</div>}
              {!projLoading && filtered.length === 0 && <div className="up-empty">No se encontraron proyectos.</div>}
              {filtered.map(p => (
                <div key={p.code} className={`up-proj-item ${selectedCode === p.code ? 'active' : ''}`} onClick={() => setSelectedCode(p.code)}>
                  <div>
                    <div className="up-proj-code">{p.code}</div>
                    <div className="up-proj-name">{p.name}</div>
                  </div>
                  <div className="up-proj-meta">
                    <span className={`badge ${STATUS_CLS[p.status] || STATUS_CLS.pendiente}`}>{p.status || 'n/a'}</span>
                    <span className="up-weeks">{p.weeks || 0} sem</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="up-new-form">
            <div>
              <label className="up-label">Código</label>
              <input className="up-input" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="Ej: 28002" />
            </div>
            <div>
              <label className="up-label">Nombre del proyecto</label>
              <input className="up-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ej: Confluencia Puembo" />
            </div>
          </div>
        )}

        <div className="up-selected-bar">
          {ready ? (
            <>
              <div className="up-selected-label">Proyecto activo</div>
              <div className="up-selected-name">{activeCode}</div>
              <div className="up-selected-sub">{activeName}</div>
            </>
          ) : <div className="up-selected-empty">Ningún proyecto seleccionado</div>}
        </div>
      </div>

      <div className="up-right">
        <div className="up-section">
          <div className="up-section-title">Ajustes</div>
          <div className="up-row3">
            <div>
              <label className="up-right-label">Prefijo</label>
              <select className="up-right-select" value={prefijo} disabled={keepNames} onChange={e => setPrefijo(e.target.value)}>
                {PREFIJOS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <label className="up-check-row" style={{ alignSelf: 'flex-end' }}>
              <input type="checkbox" checked={refreshIndex} onChange={e => setRefreshIndex(e.target.checked)} />
              Refrescar índice al terminar
            </label>
            {source !== 'local' && (
              <label className="up-check-row" style={{ alignSelf: 'flex-end' }}>
                <input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />
                Incluir subcarpetas
              </label>
            )}
          </div>
        </div>

        <div className="up-section">
          <div className="up-section-title">Origen</div>
          <div className="up-mode-tabs">
            {[['local', 'Mi equipo'], ['sharepoint', 'SharePoint'], ['onedrive', 'OneDrive']].map(([v, l]) => (
              <button key={v} type="button" className={`up-mode-tab ${source === v ? 'active' : ''}`} onClick={() => { setSource(v); setResult(null) }}>{l}</button>
            ))}
          </div>

          {source === 'local' && (
            <LocalSource projectCode={activeCode} projectName={activeName} prefijo={prefijo}
              keepNames={keepNames} setKeepNames={setKeepNames} refreshIndex={refreshIndex} ready={ready} />
          )}
          {(source === 'sharepoint' || source === 'onedrive') && (
            <RemoteSource source={source} projectCode={activeCode} projectName={activeName} prefijo={prefijo}
              recursive={recursive} refreshIndex={refreshIndex} ready={ready} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Fuente: Mi equipo (directo navegador→blob) ── */
function LocalSource({ projectCode, projectName, prefijo, keepNames, setKeepNames, refreshIndex, ready }) {
  const [files, setFiles] = useState([])
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const filesRef = useRef(null)
  const folderRef = useRef(null)

  function pick(e) {
    const chosen = Array.from(e.target.files || [])
    if (!chosen.length) return
    setFiles(chosen.map(f => ({ file: f, name: f.name, size: f.size, lastModified: f.lastModified, relativePath: f.webkitRelativePath || '' })))
    setRows([]); setMsg(null)
    e.target.value = ''
  }

  async function analyze() {
    if (!ready) { setMsg({ ok: false, text: 'Elige un proyecto primero.' }); return }
    if (!files.length) return
    setBusy(true); setMsg(null)
    try {
      const plan = await api.postUploadLocalPlan({
        projectCode, projectName, prefijo, keepNames,
        files: files.map(({ name, size, lastModified, relativePath }) => ({ name, size, lastModified, relativePath })),
      })
      setRows(plan.files.map((p) => ({
        srcIdx: p.idx, name: p.relativePath || p.name, blob: p.blobPath,
        status: p.status, error: p.reason || null, sasUrl: p.sasUrl, contentType: p.contentType,
        include: p.status === 'nuevo', total: files[p.idx]?.size || 0, done: 0,
      })))
    } catch (e) { setMsg({ ok: false, text: `Error al analizar: ${e.message}` }) }
    finally { setBusy(false) }
  }

  async function start() {
    const todo = rows.filter(r => r.include && r.sasUrl && (r.status === 'nuevo' || r.status === 'error'))
    if (!todo.length) { setMsg({ ok: false, text: 'No hay archivos nuevos seleccionados. Analiza primero.' }); return }
    setBusy(true); setMsg(null)
    const patch = (blob, p) => setRows(rs => rs.map(r => (r.blob === blob ? { ...r, ...p } : r)))
    let ok = 0, fail = 0
    const queue = [...todo]
    const worker = async () => {
      while (queue.length) {
        const row = queue.shift()
        const src = files[row.srcIdx]
        if (!src?.file) { fail++; patch(row.blob, { status: 'error', error: 'Archivo no disponible' }); continue }
        patch(row.blob, { status: 'subiendo', done: 0, error: null })
        try {
          await uploadFileToBlob(row.sasUrl, src.file, row.contentType, loaded => patch(row.blob, { done: loaded }))
          ok++; patch(row.blob, { status: 'ok', done: src.size })
        } catch (e) { fail++; patch(row.blob, { status: 'error', error: e.message }) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(LOCAL_CONCURRENCY, queue.length) }, worker))
    if (refreshIndex && ok > 0) { try { await api.refreshIndex() } catch { /* índice nocturno lo cubre */ } }
    setMsg({ ok: fail === 0, text: `${ok} subido${ok !== 1 ? 's' : ''}${fail ? `, ${fail} con error` : ''}.` })
    setBusy(false)
  }

  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0)
  const selCount = rows.filter(r => r.include && r.sasUrl).length

  return (
    <div className="up-local">
      <div className="up-pickers">
        <button type="button" className="up-btn-ghost" onClick={() => filesRef.current?.click()}>Elegir archivos…</button>
        <button type="button" className="up-btn-ghost" onClick={() => folderRef.current?.click()}>Elegir carpeta completa…</button>
        {files.length > 0 && <button type="button" className="up-btn-ghost" onClick={() => { setFiles([]); setRows([]); setMsg(null) }}>Quitar selección</button>}
      </div>
      <input ref={filesRef} type="file" multiple hidden onChange={pick} />
      <input ref={folderRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={pick} />

      {files.length > 0 && (
        <div className="up-note"><strong style={{ color: 'var(--text)' }}>{files.length}</strong> archivo{files.length !== 1 ? 's' : ''} · {fmtSize(totalBytes)}{files.some(f => f.relativePath) && ' · carpeta completa'}</div>
      )}
      <label className="up-check-row">
        <input type="checkbox" checked={keepNames} onChange={e => { setKeepNames(e.target.checked); setRows([]) }} />
        Mantener nombres y carpetas originales (sin prefijo ni fechas)
      </label>
      <p className="up-hint">Van directo de tu equipo al almacenamiento en bloques de 32 MB con reintentos: los videos de varias GB no dependen del timeout del servidor. No cierres la pestaña hasta que termine.</p>

      <div className="up-pickers">
        <button type="button" className="up-btn-ghost" onClick={analyze} disabled={busy || !files.length}>{busy && !rows.length ? 'Analizando…' : 'Analizar archivos'}</button>
        {rows.length > 0 && <button type="button" className="up-btn-primary" onClick={start} disabled={busy || selCount === 0}>{busy ? 'Subiendo…' : `Subir ${selCount} archivo${selCount !== 1 ? 's' : ''}`}</button>}
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`} style={{ marginTop: 12 }}>{msg.text}</div>}

      {rows.length > 0 && <FileRows rows={rows.map(r => ({ ...r, phase: r.status }))} />}
    </div>
  )
}

/* ── Fuente: SharePoint / OneDrive (migración por lotes con progreso) ── */
function RemoteSource({ source, projectCode, projectName, prefijo, recursive, refreshIndex, ready }) {
  const [spUrl, setSpUrl] = useState('')
  const [odEmail, setOdEmail] = useState('')
  const [odFolder, setOdFolder] = useState('/')
  const [plan, setPlan] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [progress, setProgress] = useState(null) // { done, failed, total }
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState(null)

  async function doPlan() {
    if (!ready) { setMsg({ ok: false, text: 'Elige un proyecto primero.' }); return }
    setPlanning(true); setMsg(null); setPlan(null); setProgress(null)
    try {
      const payload = { source, projectCode, projectName, prefijo, recursive }
      if (source === 'sharepoint') payload.sharepointUrl = spUrl.trim()
      else { payload.userEmail = odEmail.trim(); payload.folderPath = odFolder.trim() || '/' }
      const p = await api.postRemotePlan(payload)
      setPlan(p)
      if (p.total === 0) setMsg({ ok: false, text: 'No se encontraron archivos en esa ubicación.' })
    } catch (e) { setMsg({ ok: false, text: `No se pudo analizar: ${e.message}` }) }
    finally { setPlanning(false) }
  }

  async function migrate() {
    const todo = (plan?.files || []).filter(f => f.status === 'nuevo')
    if (!todo.length) { setMsg({ ok: false, text: 'No hay archivos nuevos para migrar.' }); return }
    setRunning(true); setMsg(null)
    let done = 0, failed = 0
    setProgress({ done, failed, total: todo.length })
    let queue = [...todo]
    try {
      while (queue.length) {
        const chunk = queue.slice(0, REMOTE_CHUNK)
        const res = await api.postRemoteBatch({
          projectCode, projectName,
          items: chunk.map(f => ({ dlUrl: f.dlUrl, blobPath: f.blobPath, name: f.name })),
        })
        ;(res.results || []).forEach(r => { if (r.status === 'ok' || r.status === 'existe') done++; else failed++ })
        const processed = res.processed || 0
        queue = queue.slice(processed || chunk.length)
        setProgress({ done, failed, total: todo.length })
        if (processed === 0) throw new Error('El servidor no pudo procesar la tanda')
      }
      if (refreshIndex) { try { await api.refreshIndex() } catch { /* índice nocturno */ } }
      setMsg({ ok: failed === 0, text: `Migración completa: ${done} subidos${failed ? `, ${failed} con error` : ''}.` })
    } catch (e) { setMsg({ ok: false, text: `Se detuvo: ${e.message}. Puedes volver a "Migrar" y continúa donde quedó.` }) }
    finally { setRunning(false) }
  }

  const pct = progress && progress.total ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : 0

  return (
    <div className="up-remote">
      {source === 'sharepoint' ? (
        <div>
          <label className="up-right-label">URL de la carpeta de SharePoint</label>
          <input className="up-right-input" value={spUrl} onChange={e => setSpUrl(e.target.value)}
            placeholder="https://empresa.sharepoint.com/sites/…/FOTOS Y VIDEOS" />
        </div>
      ) : (
        <div className="up-row2">
          <div>
            <label className="up-right-label">Correo del usuario</label>
            <input className="up-right-input" value={odEmail} onChange={e => setOdEmail(e.target.value)} placeholder="usuario@ripconciv.com" />
          </div>
          <div>
            <label className="up-right-label">Carpeta</label>
            <input className="up-right-input" value={odFolder} onChange={e => setOdFolder(e.target.value)} placeholder="/CONSULTORES/…/VUELOS DRON" />
          </div>
        </div>
      )}

      <div className="up-pickers" style={{ marginTop: 12 }}>
        <button type="button" className="up-btn-ghost" onClick={doPlan} disabled={planning || running}>
          {planning ? 'Analizando…' : 'Analizar (contar archivos)'}
        </button>
        {plan && plan.nuevos > 0 && (
          <button type="button" className="up-btn-primary" onClick={migrate} disabled={running}>
            {running ? 'Migrando…' : `Migrar ${plan.nuevos} archivo${plan.nuevos !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {plan && (
        <div className="up-plan-summary">
          <span><strong>{plan.total}</strong> encontrados</span>
          <span className="ok"><strong>{plan.nuevos}</strong> nuevos</span>
          <span className="muted"><strong>{plan.existentes}</strong> ya subidos</span>
          {plan.totalBytesNuevos > 0 && <span className="muted">{fmtSize(plan.totalBytesNuevos)} por transferir</span>}
        </div>
      )}

      {progress && (
        <div className="up-migrate-progress">
          <div className="up-progress" style={{ width: '100%' }}>
            <div className="up-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="up-migrate-counts">
            {progress.done + progress.failed} de {progress.total} · {progress.failed > 0 && <span style={{ color: 'var(--red)' }}>{progress.failed} con error</span>}
          </div>
        </div>
      )}

      <p className="up-hint">La transferencia va del servidor al almacenamiento en tandas. En carpetas enormes se procesa por partes: si se pausa, vuelve a “Migrar” y continúa con lo que falta (lo ya subido se omite).</p>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  )
}

/* ═══════════════════════════ DESTINO: BIBLIOTECA ═══════════════════════════ */
function LibraryUpload({ sections, me }) {
  const { enqueue } = useUploads()
  const [sectionId, setSectionId] = useState(sections[0]?.id || '')
  const [folders, setFolders] = useState([])
  const [folder, setFolder] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef(null)

  const section = sections.find(s => s.id === sectionId)

  // Árbol completo de la sección: cada carpeta, a cualquier profundidad.
  // El scope de permisos se evalúa contra la carpeta raíz de cada ruta.
  function loadFolders(sid, select) {
    setLoading(true)
    api.getMediaTree(sid)
      .then(d => {
        const fs = (d?.folders || []).filter(f => canItem(me, sid, f.path.split('/')[0]))
        setFolders(fs)
        setFolder(select && fs.some(f => f.path === select) ? select : (fs[0]?.path || ''))
      })
      .catch(() => setFolders([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (sectionId) loadFolders(sectionId) }, [sectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Crea la carpeta DENTRO de la seleccionada (o en la raíz si no hay ninguna).
  async function createFolder() {
    const name = newFolder.trim()
    if (!name) return
    setBusy(true); setMsg(null)
    try {
      const res = await api.createMediaFolder(sectionId, name, folder)
      setNewFolder('')
      setMsg({ ok: true, text: `Carpeta “${res?.path || name}” creada.` })
      await new Promise(r => setTimeout(r, 400))
      loadFolders(sectionId, res?.path)
    } catch (e) { setMsg({ ok: false, text: `No se pudo crear: ${e.message}` }) }
    finally { setBusy(false) }
  }

  // Se delega al gestor global: sube directo al blob en segundo plano, así
  // puedes seguir navegando mientras se sube un video pesado.
  function upload(e) {
    const chosen = Array.from(e.target.files || [])
    if (!chosen.length || !folder) return
    enqueue(chosen, { sectionId, sectionLabel: section?.label, folderPath: folder })
    setMsg({
      ok: true,
      text: `Subida iniciada (${chosen.length} archivo${chosen.length !== 1 ? 's' : ''}). Puedes seguir navegando; el progreso aparece abajo a la derecha.`,
    })
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!sections.length) return <div className="alert alert-info">No tienes permiso para subir a la biblioteca.</div>

  return (
    <div className="up-library">
      <div className="up-lib-row">
        <label className="field-select">
          <span className="field-select-label">Sección</span>
          <select className="select" value={sectionId} onChange={e => setSectionId(e.target.value)}>
            {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="field-select">
          <span className="field-select-label">Carpeta</span>
          <select className="select" value={folder} onChange={e => setFolder(e.target.value)} disabled={loading || folders.length === 0}>
            {folders.length === 0 && <option value="">{loading ? 'Cargando…' : 'Sin carpetas aún'}</option>}
            {/* Sangría por nivel para que se lea el anidamiento */}
            {folders.map(f => (
              <option key={f.path} value={f.path}>{`${'    '.repeat(f.depth || 0)}${f.name}`}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="up-lib-create">
        <input className="search-input"
          placeholder={folder ? `Nueva carpeta dentro de “${folder}”` : `Nueva carpeta en ${section?.label || 'la sección'}`}
          value={newFolder}
          onChange={e => setNewFolder(e.target.value)} onKeyDown={e => e.key === 'Enter' && !busy && createFolder()} />
        <button className="btn btn-ghost" onClick={createFolder} disabled={busy || !newFolder.trim()}>Crear carpeta</button>
      </div>

      <div className="up-lib-upload">
        <input ref={fileRef} type="file" multiple hidden onChange={upload} />
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy || !folder}>
          Subir archivos a esta carpeta
        </button>
        <span className="up-hint">Los archivos conservan su nombre original. Ideal para logos, plantillas, PDFs y material gráfico.</span>
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div>}
    </div>
  )
}

/* ── Tabla de archivos (modo Mi equipo) ── */
function FileRows({ rows }) {
  const label = { nuevo: 'Nuevo', existe: 'Ya existe', omitido: 'Omitido', subiendo: 'Subiendo', ok: 'Subido', error: 'Error' }
  return (
    <table className="up-file-table">
      <thead><tr><th>Archivo</th><th style={{ width: 150 }}>Estado</th></tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const cls = r.phase === 'ok' ? 'uploaded' : r.phase === 'error' ? 'error' : r.phase === 'subiendo' ? 'uploading' : (r.phase === 'existe' || r.phase === 'omitido') ? 'skipped' : 'new'
          const pct = r.total ? Math.min(100, Math.round((r.done || 0) / r.total * 100)) : 0
          return (
            <tr key={i}>
              <td><div className="up-file-name">{r.name}</div>{r.blob && <div className="up-file-blob">{r.blob}</div>}</td>
              <td>
                <span className={`up-phase ${cls}`}>{label[r.phase] || r.phase}</span>
                {r.phase === 'subiendo' && r.total > 0 && <div className="up-progress" style={{ marginTop: 5 }}><div className="up-progress-bar" style={{ width: `${pct}%` }} /></div>}
                {r.error && <div className="up-file-error">{r.error}</div>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
