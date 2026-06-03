import { useState, useRef, useEffect } from 'react'
import { api } from '../utils/api'

// ── Modos de subida disponibles ────────────────────────────────────────────
const UPLOAD_MODES = [
  { value: 'urls',        label: 'URLs directas / SAS' },
  { value: 'sharepoint',  label: 'SharePoint' },
  { value: 'onedrive',    label: 'OneDrive (usuario)' },
]

const PREFIJOS = ['FOT', 'DRN', 'VID', 'I360', 'E360']

export default function UploadPage() {
  // ── Proyecto ──────────────────────────────────────────────────────────────
  const [projectMode, setProjectMode]             = useState('existing')
  const [existingProjects, setExistingProjects]   = useState([])
  const [selectedProjectCode, setSelectedProjectCode] = useState('')
  const [projectSearch, setProjectSearch]         = useState('')
  const [projectCode, setProjectCode]             = useState('')
  const [projectName, setProjectName]             = useState('')

  // ── Ajustes ───────────────────────────────────────────────────────────────
  const [prefijo, setPrefijo]           = useState('FOT')
  const [maxWorkers, setMaxWorkers]     = useState(4)
  const [refreshIndex, setRefreshIndex] = useState(true)
  const [recursive, setRecursive]       = useState(true)

  // ── Modo de subida ────────────────────────────────────────────────────────
  const [uploadMode, setUploadMode] = useState('urls')

  // URLs directas
  const [urlsText, setUrlsText] = useState('')

  // SharePoint
  const [spUrl, setSpUrl]           = useState('')
  const [spSiteId, setSpSiteId]     = useState('')
  const [spFolderPath, setSpFolderPath] = useState('/')
  const [spResolved, setSpResolved] = useState(null)
  const [spResolving, setSpResolving] = useState(false)

  // OneDrive
  const [odUserEmail, setOdUserEmail]   = useState('')
  const [odFolderPath, setOdFolderPath] = useState('/')

  // ── Estado UI ─────────────────────────────────────────────────────────────
  const [loading, setLoading]                 = useState(false)
  const [result, setResult]                   = useState(null)
  const [fileList, setFileList]               = useState([])
  const [jobId, setJobId]                     = useState(null)
  const [polling, setPolling]                 = useState(false)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError]     = useState(null)
  const [savedSettings, setSavedSettings]     = useState(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsError, setSettingsError]     = useState(null)
  const pollRef = useRef(null)

  // ── Derivados ─────────────────────────────────────────────────────────────
  const selectedProject = existingProjects.find((p) => p.code === selectedProjectCode)
  const filteredProjects = existingProjects.filter((project) => {
    const term = projectSearch.trim().toLowerCase()
    return (
      !term ||
      project.code.toLowerCase().includes(term) ||
      (project.name || '').toLowerCase().includes(term)
    )
  })

  const activeProjectCode = projectMode === 'existing' ? selectedProjectCode : projectCode
  const activeProjectName = projectMode === 'existing' ? (selectedProject?.name || '') : projectName

  // ── Carga de proyectos ────────────────────────────────────────────────────
  const loadProjects = async ({ silent = false } = {}) => {
    if (!silent) { setProjectsLoading(true); setProjectsError(null) }
    try {
      const data = await api.getProjects()
      const arr = Array.isArray(data) ? data : []
      setExistingProjects(arr)
      if (arr.length === 0) {
        setProjectMode('new')
        setSelectedProjectCode('')
      } else if (!arr.some((p) => p.code === selectedProjectCode)) {
        setSelectedProjectCode(arr[0]?.code || '')
      }
    } catch (e) {
      setProjectsError(e.message || 'Error al cargar proyectos')
    } finally {
      if (!silent) setProjectsLoading(false)
    }
  }

  // ── Configuración del proyecto ────────────────────────────────────────────
  const fetchProjectSettings = async (code) => {
    if (!code) { setSavedSettings(null); return }
    setSettingsLoading(true); setSettingsError(null)
    try {
      const s = await api.getProjectSettings(code)
      if (s && typeof s === 'object') {
        setSavedSettings(s)
        setPrefijo(s.prefijo || 'FOT')
        setMaxWorkers(s.maxWorkers ?? 4)
        setRefreshIndex(s.refreshIndex ?? true)
      } else {
        setSavedSettings(null)
      }
    } catch (e) {
      setSettingsError(e.message || 'No se pudo cargar configuración')
      setSavedSettings(null)
    } finally {
      setSettingsLoading(false)
    }
  }

  const saveProjectSettings = async ({ silent = false } = {}) => {
    if (!selectedProjectCode) {
      if (!silent) alert('Seleccioná un proyecto existente primero.')
      return false
    }
    setSettingsLoading(true); setSettingsError(null)
    try {
      const res = await api.saveProjectSettings(selectedProjectCode, { prefijo, maxWorkers, refreshIndex })
      if (res?.settings) {
        setSavedSettings(res.settings)
        if (!silent) alert('Configuración guardada.')
        return true
      }
      return false
    } catch (e) {
      setSettingsError(e.message || 'Error guardando configuración')
      if (!silent) alert('Error: ' + (e.message || e))
      return false
    } finally {
      setSettingsLoading(false)
    }
  }

  // ── Efectos ───────────────────────────────────────────────────────────────
  useEffect(() => { loadProjects() }, [])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])
  useEffect(() => {
    if (projectMode === 'existing' && selectedProjectCode) fetchProjectSettings(selectedProjectCode)
  }, [projectMode, selectedProjectCode])

  // ── Polling del job ───────────────────────────────────────────────────────
  const startPolling = (id) => {
    setJobId(id)
    setPolling(true)
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.getUploadStatus(id)
        if (st?.files) setFileList(st.files.map((f) => ({ ...f, include: f.include !== false })))
        if (st && (st.status === 'finished' || st.status === 'error')) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setPolling(false)
          setResult(st.summary || { status: st.status, ...(st.summary || {}) })
        }
      } catch (e) {
        console.error('poll error', e)
      }
    }, 1500)
  }

  // ── Resolver URL SharePoint ───────────────────────────────────────────────
  const resolveSharepointUrl = async () => {
    if (!spUrl.trim()) { alert('Pegá una URL de SharePoint primero.'); return }
    setSpResolving(true); setSpResolved(null)
    try {
      const res = await api.resolveSharepointUrl(spUrl.trim())
      setSpResolved(res)
      if (res.site_id) setSpSiteId(res.site_id)
      if (res.folder_path) setSpFolderPath(res.folder_path)
    } catch (e) {
      alert('No se pudo resolver la URL: ' + (e.message || e))
    } finally {
      setSpResolving(false)
    }
  }

  // ── Comprobar URLs (solo modo urls) ───────────────────────────────────────
  const checkUrls = async () => {
    const urls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean)
    if (!activeProjectCode || !activeProjectName || urls.length === 0) {
      alert('Seleccioná o creá un proyecto y pegá al menos una URL.')
      return
    }
    setLoading(true)
    try {
      const res = await api.postUploadCheck({ projectCode: activeProjectCode, projectName: activeProjectName, urls })
      setFileList(res.results.map((r) => ({ ...r, include: !(r.exists || r.similar) })))
      if (projectMode === 'existing') await saveProjectSettings({ silent: true })
    } catch (e) {
      alert('Error comprobando URLs: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Submit principal ──────────────────────────────────────────────────────
  const submit = async (e) => {
    e.preventDefault()
    if (!activeProjectCode || !activeProjectName) {
      alert('Seleccioná o creá un proyecto.')
      return
    }

    setLoading(true); setResult(null)

    try {
      if (projectMode === 'existing') await saveProjectSettings({ silent: true })

      let res

      if (uploadMode === 'urls') {
        const selected = fileList.filter((f) => f.include).map((f) => f.url)
        if (selected.length === 0) { alert('No hay archivos seleccionados para subir.'); setLoading(false); return }
        res = await api.postUpload({
          projectCode: activeProjectCode, projectName: activeProjectName,
          prefijo, urls: selected, maxWorkers, refreshIndex,
        })

      } else if (uploadMode === 'sharepoint') {
        if (!spUrl.trim() && !spSiteId.trim()) {
          alert('Pegá una URL de SharePoint o introduce el Site ID.')
          setLoading(false); return
        }
        res = await api.postUploadSharepoint({
          projectCode: activeProjectCode, projectName: activeProjectName,
          sharepointUrl: spUrl.trim() || undefined,
          siteId: spSiteId.trim() || undefined,
          folderPath: spFolderPath || '/',
          prefijo, maxWorkers, refreshIndex, recursive,
        })

      } else if (uploadMode === 'onedrive') {
        if (!odUserEmail.trim()) { alert('Introduce el email del usuario de OneDrive.'); setLoading(false); return }
        res = await api.postUploadOnedrive({
          projectCode: activeProjectCode, projectName: activeProjectName,
          userEmail: odUserEmail.trim(),
          folderPath: odFolderPath || '/',
          prefijo, maxWorkers, refreshIndex, recursive,
        })
      }

      if (res?.jobId) {
        startPolling(res.jobId)
      } else {
        setResult(res)
      }
    } catch (e) {
      console.error(e)
      alert('Error en upload: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="upload-page">
      <h2>Subir archivos audiovisuales</h2>
      <form onSubmit={submit} className="upload-form">

        {/* ── 1. Proyecto ─────────────────────────────────────────────────── */}
        <div className="upload-card">
          <div className="upload-card-header">
            <strong>1. Seleccionar proyecto</strong>
            <p>Elige un proyecto existente o crea uno nuevo.</p>
          </div>
          <div className="upload-card-body">
            <div className="upload-row">
              <label className="radio-option">
                <input type="radio" name="projectMode" value="existing"
                  checked={projectMode === 'existing'}
                  onChange={() => setProjectMode('existing')}
                  disabled={projectsLoading || existingProjects.length === 0}
                />
                Proyecto existente
              </label>
              <label className="radio-option">
                <input type="radio" name="projectMode" value="new"
                  checked={projectMode === 'new'}
                  onChange={() => setProjectMode('new')}
                />
                Crear nuevo proyecto
              </label>
            </div>

            {projectMode === 'existing' ? (
              <>
                <div className="upload-row upload-row-top">
                  <div>
                    <label>Buscar proyecto</label>
                    <input className="search-input" placeholder="Filtrar por código o nombre"
                      value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} />
                  </div>
                  <div className="upload-actions">
                    <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => loadProjects()} disabled={projectsLoading}>
                      Actualizar lista
                    </button>
                  </div>
                </div>

                <div className="project-list">
                  {filteredProjects.length === 0 ? (
                    <div className="upload-note">No se encontraron proyectos.</div>
                  ) : filteredProjects.map((project) => (
                    <button key={project.code} type="button"
                      className={`project-list-item ${selectedProjectCode === project.code ? 'selected' : ''}`}
                      onClick={() => setSelectedProjectCode(project.code)}>
                      <div className="project-list-main">
                        <span className="project-code">{project.code}</span>
                        <span className="project-name">{project.name}</span>
                      </div>
                      <div className="project-list-meta">
                        <span>{project.weeks || 0} semanas</span>
                        <span>{project.types || 'N/A'}</span>
                        <span>{project.status || 'Sin estado'}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="upload-row">
                  <div>
                    <label>Proyecto seleccionado</label>
                    <input className="search-input"
                      value={selectedProject ? `${selectedProject.code} · ${selectedProject.name}` : 'Seleccioná un proyecto'}
                      disabled />
                  </div>
                  <div>
                    <label>Estado</label>
                    <input className="search-input"
                      value={selectedProject
                        ? `${selectedProject.status || 'Sin estado'} · ${selectedProject.weeks || 0} semanas`
                        : 'Sin proyecto seleccionado'}
                      disabled />
                  </div>
                </div>

                {/* Configuración guardada */}
                <div className="upload-card">
                  <div className="upload-card-header">
                    <strong>Configuración guardada del proyecto</strong>
                  </div>
                  <div className="upload-card-body">
                    {settingsLoading ? (
                      <div className="upload-note">Cargando configuración...</div>
                    ) : savedSettings ? (
                      <>
                        <div className="upload-row">
                          <div>
                            <label>Prefijo</label>
                            <input className="search-input" value={savedSettings.prefijo || 'FOT'} disabled />
                          </div>
                          <div>
                            <label>Max Workers</label>
                            <input className="search-input" value={savedSettings.maxWorkers ?? 4} disabled />
                          </div>
                        </div>
                        <div className="upload-row">
                          <div>
                            <label>Refrescar índice</label>
                            <input className="search-input" value={savedSettings.refreshIndex ? 'Sí' : 'No'} disabled />
                          </div>
                          <div>
                            <label>Último guardado</label>
                            <input className="search-input" value={savedSettings.savedAt || 'Nunca'} disabled />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="upload-note">No hay configuración guardada para este proyecto.</div>
                    )}
                    <div className="upload-actions">
                      <button type="button" className="btn btn-ghost btn-sm"
                        onClick={() => saveProjectSettings()} disabled={settingsLoading}>
                        Guardar configuración
                      </button>
                    </div>
                    {settingsError && <div className="upload-error">{settingsError}</div>}
                  </div>
                </div>

                {projectsLoading && <div className="upload-note">Cargando proyectos...</div>}
                {projectsError  && <div className="upload-error">{projectsError}</div>}
              </>
            ) : (
              <div className="upload-row">
                <div>
                  <label>Código de proyecto</label>
                  <input className="search-input" value={projectCode}
                    onChange={(e) => setProjectCode(e.target.value)} placeholder="Ej: 28002" />
                </div>
                <div>
                  <label>Nombre corto</label>
                  <input className="search-input" value={projectName}
                    onChange={(e) => setProjectName(e.target.value)} placeholder="Ej: Confluencia Puembo" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 2. Ajustes ──────────────────────────────────────────────────── */}
        <div className="upload-card">
          <div className="upload-card-header">
            <strong>2. Ajustes de subida</strong>
            <p>Prefijo de archivo, concurrencia e índice.</p>
          </div>
          <div className="upload-card-body upload-row">
            <div>
              <label>Prefijo</label>
              <select className="search-input" value={prefijo} onChange={(e) => setPrefijo(e.target.value)}>
                {PREFIJOS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label>Max Workers (hilos paralelos)</label>
              <input className="search-input" type="number" min={1} max={24}
                value={maxWorkers} onChange={(e) => setMaxWorkers(Number(e.target.value))} />
            </div>
            <div className="upload-row-full">
              <label className="checkbox-inline">
                <input type="checkbox" checked={refreshIndex}
                  onChange={(e) => setRefreshIndex(e.target.checked)} />
                Refrescar índice en background después de subir
              </label>
            </div>
            {(uploadMode === 'sharepoint' || uploadMode === 'onedrive') && (
              <div className="upload-row-full">
                <label className="checkbox-inline">
                  <input type="checkbox" checked={recursive}
                    onChange={(e) => setRecursive(e.target.checked)} />
                  Incluir subcarpetas recursivamente
                </label>
              </div>
            )}
          </div>
        </div>

        {/* ── 3. Modo de origen ───────────────────────────────────────────── */}
        <div className="upload-card">
          <div className="upload-card-header">
            <strong>3. Origen de los archivos</strong>
            <p>Elige de dónde vienen los archivos a subir.</p>
          </div>
          <div className="upload-card-body">
            <div className="upload-row" style={{ marginBottom: 16 }}>
              {UPLOAD_MODES.map((m) => (
                <label key={m.value} className="radio-option">
                  <input type="radio" name="uploadMode" value={m.value}
                    checked={uploadMode === m.value}
                    onChange={() => { setUploadMode(m.value); setResult(null); setFileList([]) }} />
                  {m.label}
                </label>
              ))}
            </div>

            {/* ── URLs directas ── */}
            {uploadMode === 'urls' && (
              <>
                <label>URLs (una por línea) — públicas, SAS o enlaces de archivo compartido de SharePoint/OneDrive</label>
                <textarea className="search-input" rows={8} value={urlsText}
                  onChange={(e) => setUrlsText(e.target.value)}
                  placeholder={"https://blob.core.windows.net/...\nhttps://ejemplo.sharepoint.com/:i:/s/..."} />
                <div className="upload-actions">
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={checkUrls} disabled={loading}>
                    Comprobar existentes
                  </button>
                </div>
              </>
            )}

            {/* ── SharePoint ── */}
            {uploadMode === 'sharepoint' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label>URL de carpeta SharePoint</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="search-input" style={{ flex: 1 }}
                      value={spUrl} onChange={(e) => setSpUrl(e.target.value)}
                      placeholder="https://empresa.sharepoint.com/sites/Proyectos/Documentos%20compartidos/33014/FOTOS" />
                    <button type="button" className="btn btn-ghost btn-sm"
                      onClick={resolveSharepointUrl} disabled={spResolving || !spUrl.trim()}>
                      {spResolving ? 'Resolviendo…' : 'Resolver'}
                    </button>
                  </div>
                  {spResolved && (
                    <div className="upload-note" style={{ marginTop: 6 }}>
                      ✅ Sitio: <strong>{spResolved.site_name}</strong> · Site ID: <code>{spResolved.site_id}</code> · Carpeta: <code>{spResolved.folder_path}</code>
                    </div>
                  )}
                </div>
                <div className="upload-row">
                  <div>
                    <label>Site ID (opcional si usas URL)</label>
                    <input className="search-input" value={spSiteId}
                      onChange={(e) => setSpSiteId(e.target.value)}
                      placeholder="ripcon.sharepoint.com,abc123,def456" />
                  </div>
                  <div>
                    <label>Folder path</label>
                    <input className="search-input" value={spFolderPath}
                      onChange={(e) => setSpFolderPath(e.target.value)}
                      placeholder="/Proyectos/28002/Semana15" />
                  </div>
                </div>
              </div>
            )}

            {/* ── OneDrive ── */}
            {uploadMode === 'onedrive' && (
              <div className="upload-row">
                <div>
                  <label>Email del usuario</label>
                  <input className="search-input" value={odUserEmail}
                    onChange={(e) => setOdUserEmail(e.target.value)}
                    placeholder="usuario@empresa.com" />
                </div>
                <div>
                  <label>Ruta de carpeta</label>
                  <input className="search-input" value={odFolderPath}
                    onChange={(e) => setOdFolderPath(e.target.value)}
                    placeholder="/Fotos Obra/Semana 15" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Botón submit ─────────────────────────────────────────────────── */}
        <div className="upload-card upload-card-footer">
          <button className="btn btn-primary btn-sm" type="submit"
            disabled={loading || polling}>
            {loading || polling ? 'Procesando…' : 'Iniciar subida'}
          </button>
          {polling && jobId && (
            <span className="upload-note" style={{ marginLeft: 12 }}>
              Job: <code>{jobId}</code> — actualizando cada 1.5s…
            </span>
          )}
        </div>
      </form>

      {/* ── Lista de archivos detectados (modo URLs) ── */}
      {fileList.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Archivos</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
              Seleccionados: {fileList.filter((f) => f.include).length} / {fileList.length}
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => setFileList(fileList.map((f) => ({ ...f, include: true })))}>
                Marcar todos
              </button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
                onClick={() => setFileList(fileList.map((f) => ({ ...f, include: false })))}>
                Desmarcar todos
              </button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr><th>✓</th><th>Nombre</th><th>Estado / Progreso</th></tr>
            </thead>
            <tbody>
              {fileList.map((f, idx) => (
                <tr key={idx}>
                  <td>
                    <input type="checkbox" checked={f.include}
                      onChange={(e) => {
                        const copy = [...fileList]; copy[idx] = { ...copy[idx], include: e.target.checked }; setFileList(copy)
                      }} />
                  </td>
                  <td style={{ minWidth: 320 }}>
                    <div style={{ fontWeight: 700 }}>{f.name || f.nombre_nuevo || '—'}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{f.url || f.blob || ''}</div>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <div style={{ marginBottom: 4 }}>
                      {f.phase || (f.exists ? '⚠ Ya existe' : f.similar ? `~ Similar a ${f.similarTo}` : '✦ Nuevo')}
                    </div>
                    {f.downloadTotal > 0 ? (
                      <div className="progress">
                        <div className="progress-bar"
                          style={{ width: `${Math.min(100, Math.round((f.downloaded || 0) / f.downloadTotal * 100))}%` }} />
                      </div>
                    ) : f.phase === 'downloading' ? (
                      <div className="progress"><div className="progress-bar" style={{ width: '5%' }} /></div>
                    ) : null}
                    {f.error && <div className="upload-error" style={{ fontSize: '0.8rem' }}>{f.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Resultado final ── */}
      {result && (
        <div style={{ marginTop: 16 }}>
          <h3>Resultado</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}