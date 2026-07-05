import { useState, useRef, useEffect } from 'react'
import { api } from '../utils/api'
import { uploadFileToBlob } from '../utils/blobUpload'

const PREFIJOS = ['FOT', 'DRN', 'VID', 'I360', 'E360']

const UPLOAD_MODES = [
  { value: 'local',      label: 'Mi equipo',      icon: 'ti-device-desktop' },
  { value: 'sharepoint', label: 'SharePoint',     icon: 'ti-brand-office' },
  { value: 'onedrive',   label: 'OneDrive',       icon: 'ti-cloud' },
  { value: 'urls',       label: 'URLs / SAS',     icon: 'ti-link' },
]

const LOCAL_UPLOAD_CONCURRENCY = 3

function fmtSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const STATUS_CLS = {
  completo:  'badge-green',
  subiendo:  'badge-orange',
  pendiente: 'badge-red',
}

export default function UploadPage() {
  const [projectMode, setProjectMode]           = useState('existing')
  const [existingProjects, setExistingProjects] = useState([])
  const [selectedCode, setSelectedCode]         = useState('')
  const [projectSearch, setProjectSearch]       = useState('')
  const [newCode, setNewCode]                   = useState('')
  const [newName, setNewName]                   = useState('')

  const [prefijo, setPrefijo]           = useState('FOT')
  const [maxWorkers, setMaxWorkers]     = useState(4)
  const [refreshIndex, setRefreshIndex] = useState(true)
  const [recursive, setRecursive]       = useState(true)

  const [uploadMode, setUploadMode] = useState('local')
  const [urlsText, setUrlsText]     = useState('')

  const [spUrl, setSpUrl]               = useState('')
  const [spSiteId, setSpSiteId]         = useState('')
  const [spFolderPath, setSpFolderPath] = useState('/')
  const [spResolved, setSpResolved]     = useState(null)
  const [spResolving, setSpResolving]   = useState(false)

  const [odEmail, setOdEmail]           = useState('')
  const [odFolder, setOdFolder]         = useState('/')

  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState(null)
  const [fileList, setFileList]     = useState([])
  const [jobId, setJobId]           = useState(null)
  const [polling, setPolling]       = useState(false)
  const [projLoading, setProjLoading] = useState(false)
  const [projError, setProjError]   = useState(null)
  const [savedSettings, setSavedSettings] = useState(null)
  const [settLoading, setSettLoading]     = useState(false)
  const pollRef = useRef(null)

  // Modo "Mi equipo": subida directa navegador → blob (los bytes no pasan por el servidor)
  const [localFiles, setLocalFiles] = useState([])
  const [localPlan, setLocalPlan]   = useState(null)
  const [keepNames, setKeepNames]   = useState(false)
  const filesInputRef  = useRef(null)
  const folderInputRef = useRef(null)

  const selectedProject = existingProjects.find((p) => p.code === selectedCode)
  const activeCode = projectMode === 'existing' ? selectedCode : newCode
  const activeName = projectMode === 'existing' ? (selectedProject?.name || '') : newName

  const filteredProjects = existingProjects.filter((p) => {
    const t = projectSearch.trim().toLowerCase()
    return !t || p.code.toLowerCase().includes(t) || (p.name || '').toLowerCase().includes(t)
  })

  const loadProjects = async (silent = false) => {
    if (!silent) { setProjLoading(true); setProjError(null) }
    try {
      const data = await api.getProjects()
      const arr = Array.isArray(data) ? data : []
      setExistingProjects(arr)
      if (arr.length === 0) { setProjectMode('new'); setSelectedCode('') }
      else if (!arr.some((p) => p.code === selectedCode)) setSelectedCode(arr[0]?.code || '')
    } catch (e) {
      setProjError(e.message || 'Error al cargar proyectos')
    } finally {
      if (!silent) setProjLoading(false)
    }
  }

  const fetchSettings = async (code) => {
    if (!code) { setSavedSettings(null); return }
    setSettLoading(true)
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
    } catch { setSavedSettings(null) }
    finally { setSettLoading(false) }
  }

  const saveSettings = async (silent = false) => {
    if (!selectedCode) { if (!silent) alert('Seleccioná un proyecto existente.'); return false }
    setSettLoading(true)
    try {
      const res = await api.saveProjectSettings(selectedCode, { prefijo, maxWorkers, refreshIndex })
      if (res?.settings) { setSavedSettings(res.settings); if (!silent) alert('Configuración guardada.'); return true }
      return false
    } catch (e) { if (!silent) alert('Error: ' + (e.message || e)); return false }
    finally { setSettLoading(false) }
  }

  useEffect(() => { loadProjects() }, [])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])
  useEffect(() => { if (projectMode === 'existing' && selectedCode) fetchSettings(selectedCode) }, [projectMode, selectedCode])

  const startPolling = (id) => {
    setJobId(id); setPolling(true)
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.getUploadStatus(id)
        if (st?.files) setFileList(st.files.map((f) => ({ ...f, include: f.include !== false })))
        if (st && (st.status === 'finished' || st.status === 'error')) {
          clearInterval(pollRef.current); pollRef.current = null
          setPolling(false); setResult(st.summary || { status: st.status })
        }
      } catch {}
    }, 1500)
  }

  const resolveSpUrl = async () => {
    if (!spUrl.trim()) { alert('Pegá una URL de SharePoint primero.'); return }
    setSpResolving(true); setSpResolved(null)
    try {
      const res = await api.resolveSharepointUrl(spUrl.trim())
      setSpResolved(res)
      if (res.site_id) setSpSiteId(res.site_id)
      if (res.folder_path) setSpFolderPath(res.folder_path)
    } catch (e) { alert('No se pudo resolver: ' + (e.message || e)) }
    finally { setSpResolving(false) }
  }

  const checkUrls = async () => {
    const urls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean)
    if (!activeCode || !activeName || !urls.length) { alert('Seleccioná un proyecto y pegá URLs.'); return }
    setLoading(true)
    try {
      const res = await api.postUploadCheck({ projectCode: activeCode, projectName: activeName, urls })
      setFileList(res.results.map((r) => ({ ...r, include: !(r.exists || r.similar) })))
    } catch (e) { alert('Error: ' + e.message) }
    finally { setLoading(false) }
  }

  const onPickLocal = (e) => {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    setLocalFiles(picked.map((f) => ({
      file: f,
      name: f.name,
      size: f.size,
      lastModified: f.lastModified,
      relativePath: f.webkitRelativePath || '',
    })))
    setLocalPlan(null); setFileList([]); setResult(null)
    e.target.value = ''
  }

  const planLocal = async () => {
    if (!activeCode || !activeName) { alert('Seleccioná o creá un proyecto.'); return }
    if (!localFiles.length) { alert('Elegí archivos o una carpeta primero.'); return }
    setLoading(true); setResult(null)
    try {
      const plan = await api.postUploadLocalPlan({
        projectCode: activeCode,
        projectName: activeName,
        prefijo,
        keepNames,
        files: localFiles.map(({ name, size, lastModified, relativePath }) =>
          ({ name, size, lastModified, relativePath })),
      })
      setLocalPlan(plan)
      setFileList(plan.files.map((p, rowIdx) => ({
        rowIdx,
        name: p.relativePath || p.name,
        finalName: p.finalName,
        blob: p.blobPath,
        phase: p.status === 'nuevo' ? 'new' : p.status === 'existe' ? 'exists' : 'skipped',
        error: p.reason || null,
        include: p.status === 'nuevo',
        downloadTotal: localFiles[p.idx]?.size || 0,
        downloaded: 0,
        _srcIdx: p.idx,
        _sasUrl: p.sasUrl,
        _contentType: p.contentType,
      })))
    } catch (e2) { alert('Error al planificar: ' + e2.message) }
    finally { setLoading(false) }
  }

  const submitLocal = async () => {
    const rows = fileList.filter((r) => r.include && r._sasUrl && (r.phase === 'new' || r.phase === 'error'))
    if (!rows.length) { alert('No hay archivos nuevos seleccionados. Usa "Analizar archivos" primero.'); return }
    setLoading(true); setResult(null)

    const patchRow = (rowIdx, patch) =>
      setFileList((prev) => prev.map((r) => (r.rowIdx === rowIdx ? { ...r, ...patch } : r)))

    let ok = 0, fail = 0
    const queue = [...rows]
    const uploadOne = async (row) => {
      const src = localFiles[row._srcIdx]
      if (!src?.file) { fail++; patchRow(row.rowIdx, { phase: 'error', error: 'Archivo no disponible' }); return }
      patchRow(row.rowIdx, { phase: 'uploading', downloaded: 0, error: null })
      let last = 0
      try {
        await uploadFileToBlob(row._sasUrl, src.file, row._contentType, (loaded) => {
          const now = Date.now()
          if (now - last > 400 || loaded >= src.size) { last = now; patchRow(row.rowIdx, { downloaded: loaded }) }
        })
        ok++
        patchRow(row.rowIdx, { phase: 'uploaded', downloaded: src.size })
      } catch (e2) {
        fail++
        patchRow(row.rowIdx, { phase: 'error', error: e2.message })
      }
    }
    const workers = Array.from({ length: Math.min(LOCAL_UPLOAD_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) await uploadOne(queue.shift())
    })
    await Promise.all(workers)

    if (refreshIndex && ok > 0) {
      try { await api.refreshIndex() } catch { /* el índice nocturno lo cubre */ }
    }
    setResult({
      modo: 'directo (navegador → blob)',
      carpeta: localPlan?.carpeta,
      subidos: ok,
      errores: fail,
      yaExistian: localPlan?.existentes || 0,
      omitidosPorTipo: localPlan?.omitidos || 0,
    })
    setLoading(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (uploadMode === 'local') { await submitLocal(); return }
    if (!activeCode || !activeName) { alert('Seleccioná o creá un proyecto.'); return }
    setLoading(true); setResult(null)
    try {
      if (projectMode === 'existing') await saveSettings(true)
      let res
      if (uploadMode === 'urls') {
        const sel = fileList.filter((f) => f.include).map((f) => f.url)
        if (!sel.length) { alert('No hay archivos seleccionados.'); setLoading(false); return }
        res = await api.postUpload({ projectCode: activeCode, projectName: activeName, prefijo, urls: sel, maxWorkers, refreshIndex })
      } else if (uploadMode === 'sharepoint') {
        if (!spUrl.trim() && !spSiteId.trim()) { alert('Pegá una URL de SharePoint.'); setLoading(false); return }
        res = await api.postUploadSharepoint({ projectCode: activeCode, projectName: activeName, sharepointUrl: spUrl || undefined, siteId: spSiteId || undefined, folderPath: spFolderPath || '/', prefijo, maxWorkers, refreshIndex, recursive })
      } else {
        if (!odEmail.trim()) { alert('Introduce el email del usuario de OneDrive.'); setLoading(false); return }
        res = await api.postUploadOnedrive({ projectCode: activeCode, projectName: activeName, userEmail: odEmail, folderPath: odFolder || '/', prefijo, maxWorkers, refreshIndex, recursive })
      }
      if (res?.jobId) startPolling(res.jobId)
      else setResult(res)
    } catch (e) { alert('Error: ' + e.message) }
    finally { setLoading(false) }
  }

  const statusCls = (status) => STATUS_CLS[status] || STATUS_CLS.pendiente

  return (
    <>
      <style>{`
        /* Estilos del UploadPage alineados al sistema de diseño (tokens):
           funcionan en tema claro y oscuro sin valores incrustados. */
        .up-root { display: grid; grid-template-columns: 360px 1fr; gap: 0; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; min-height: calc(100vh - 150px); }
        .up-left { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-width: 0; }
        .up-right { display: flex; flex-direction: column; padding: 24px 28px 28px; overflow-y: auto; min-width: 0; }
        .up-left-header { padding: 20px 20px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .up-left-header h1 { font-size: 1rem; font-weight: 700; color: var(--text); margin: 0 0 2px; }
        .up-left-header p { font-size: 0.78rem; color: var(--text-dim); margin: 0; }
        .up-proj-tabs { display: flex; padding: 12px 14px 0; gap: 6px; flex-shrink: 0; }
        .up-tab { flex: 1; padding: 7px; font-size: 0.74rem; font-weight: 600; background: transparent; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; transition: var(--transition); color: var(--text-dim); }
        .up-tab.active { background: var(--accent-bg); border-color: var(--accent-bd); color: var(--accent); }
        .up-tab:hover:not(.active):not(:disabled) { border-color: var(--border-hi); color: var(--text); }
        .up-search-wrap { padding: 12px 14px 8px; flex-shrink: 0; }
        .up-search { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; font-size: 0.8rem; font-family: var(--font-body); color: var(--text); outline: none; box-sizing: border-box; transition: var(--transition); }
        .up-search::placeholder { color: var(--text-dim); }
        .up-search:focus { border-color: var(--accent-dim); }
        .up-proj-list { flex: 1; overflow-y: auto; padding: 0 8px 14px; }
        .up-proj-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 12px; border-radius: var(--radius); cursor: pointer; transition: background var(--transition); margin-bottom: 2px; border: 1px solid transparent; }
        .up-proj-item:hover { background: var(--bg3); }
        .up-proj-item.active { background: var(--accent-bg); border-color: var(--accent-bd); }
        .up-proj-code { font-size: 0.78rem; font-weight: 600; color: var(--text); font-family: var(--font-mono); }
        .up-proj-name { font-size: 0.74rem; color: var(--text-dim); margin-top: 2px; }
        .up-proj-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
        .up-weeks { font-size: 0.68rem; color: var(--text-faint); white-space: nowrap; }
        .up-new-form { padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; }
        .up-label { font-size: 0.7rem; font-weight: 600; color: var(--text-dim); display: block; margin-bottom: 5px; }
        .up-input { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; font-size: 0.82rem; font-family: var(--font-body); color: var(--text); outline: none; box-sizing: border-box; transition: var(--transition); }
        .up-input:focus { border-color: var(--accent-dim); }
        .up-selected-bar { padding: 14px 16px; border-top: 1px solid var(--border); background: var(--bg3); flex-shrink: 0; }
        .up-selected-label { font-size: 0.66rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
        .up-selected-name { font-size: 0.92rem; font-weight: 700; color: var(--text); font-family: var(--font-mono); }
        .up-selected-sub { font-size: 0.76rem; color: var(--text-dim); margin-top: 2px; }
        .up-selected-empty { font-size: 0.76rem; color: var(--text-faint); text-align: center; }
        .up-section { margin-bottom: 22px; }
        .up-section-title { font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
        .up-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .up-right-label { font-size: 0.72rem; font-weight: 600; color: var(--text-dim); display: block; margin-bottom: 6px; }
        .up-right-input { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 9px 12px; font-size: 0.84rem; font-family: var(--font-body); color: var(--text); outline: none; box-sizing: border-box; transition: var(--transition); }
        .up-right-input:focus { border-color: var(--accent-dim); }
        .up-right-input::placeholder { color: var(--text-dim); }
        .up-right-select { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 9px 12px; font-size: 0.84rem; font-family: var(--font-body); color: var(--text); outline: none; cursor: pointer; appearance: none; box-sizing: border-box; }
        .up-right-select:focus { border-color: var(--accent-dim); }
        .up-right-select:disabled { opacity: 0.5; cursor: not-allowed; }
        .up-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .up-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        .up-check-row { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: var(--text-dim); cursor: pointer; }
        .up-check-row input[type=checkbox] { accent-color: var(--accent); width: 15px; height: 15px; }
        .up-mode-tabs { display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap; }
        .up-mode-tab { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 99px; font-size: 0.8rem; font-weight: 600; border: 1px solid var(--border); background: var(--bg); color: var(--text-dim); cursor: pointer; transition: var(--transition); }
        .up-mode-tab.active { background: var(--accent-bg); border-color: var(--accent-bd); color: var(--accent); }
        .up-mode-tab:hover:not(.active) { border-color: var(--border-hi); color: var(--text); }
        .up-textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; font-size: 0.8rem; font-family: var(--font-mono); color: var(--text); resize: vertical; min-height: 140px; outline: none; box-sizing: border-box; line-height: 1.6; transition: var(--transition); }
        .up-textarea:focus { border-color: var(--accent-dim); }
        .up-textarea::placeholder { color: var(--text-dim); }
        .up-btn-ghost { background: transparent; border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px; font-size: 0.78rem; font-weight: 500; font-family: var(--font-body); color: var(--text-dim); cursor: pointer; transition: var(--transition); }
        .up-btn-ghost:hover:not(:disabled) { border-color: var(--border-hi); color: var(--text); background: var(--bg3); }
        .up-btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
        .up-btn-primary { background: var(--accent); border: none; border-radius: var(--radius); padding: 10px 24px; font-size: 0.84rem; font-weight: 600; font-family: var(--font-body); color: #fff; cursor: pointer; transition: var(--transition); }
        .up-btn-primary:hover:not(:disabled) { background: var(--accent-dim); }
        .up-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .up-resolved-box { margin-top: 10px; padding: 10px 12px; background: var(--green-bg); border: 1px solid var(--green-bd); border-radius: var(--radius); font-size: 0.76rem; color: var(--green); }
        .up-resolved-box code { background: transparent; padding: 1px 4px; font-size: 0.72rem; color: inherit; }
        .up-input-row { display: flex; gap: 8px; }
        .up-input-row .up-right-input { flex: 1; }
        .up-file-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        .up-file-table th { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-faint); padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: left; }
        .up-file-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
        .up-file-table tr:last-child td { border-bottom: none; }
        .up-file-name { font-family: var(--font-mono); font-size: 0.76rem; color: var(--text); word-break: break-all; }
        .up-file-blob { font-size: 0.7rem; color: var(--text-faint); margin-top: 2px; word-break: break-all; }
        .up-file-error { font-size: 0.72rem; color: var(--red); margin-top: 2px; }
        .up-progress { height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden; width: 90px; }
        .up-progress-bar { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
        .up-phase { font-size: 0.66rem; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
        .up-phase.queued, .up-phase.new { background: var(--bg3); color: var(--text-dim); }
        .up-phase.downloading, .up-phase.uploading { background: var(--accent-bg); color: var(--accent); }
        .up-phase.uploaded { background: var(--green-bg); color: var(--green); }
        .up-phase.error { background: var(--red-bg); color: var(--red); }
        .up-phase.skipped, .up-phase.exists, .up-phase.similar { background: var(--bg3); color: var(--text-faint); }
        .up-result { margin-top: 22px; padding: 16px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-lg); }
        .up-result-title { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 10px; }
        .up-result pre { font-size: 0.74rem; font-family: var(--font-mono); color: var(--text-dim); white-space: pre-wrap; margin: 0; line-height: 1.7; }
        .up-footer { padding: 18px 0 0; display: flex; align-items: center; gap: 14px; border-top: 1px solid var(--border); margin-top: 8px; }
        .up-job-badge { font-size: 0.7rem; font-family: var(--font-mono); color: var(--text-dim); padding: 4px 8px; background: var(--bg3); border-radius: var(--radius); }
        .up-empty { text-align: center; padding: 36px 16px; color: var(--text-faint); font-size: 0.8rem; }
        .up-note { font-size: 0.76rem; color: var(--text-dim); line-height: 1.6; }
        .up-hint { font-size: 0.72rem; color: var(--text-faint); line-height: 1.6; }
        .up-sett-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; font-size: 0.76rem; }
        .up-sett-item { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); }
        .up-sett-key { color: var(--text-dim); }
        .up-sett-val { color: var(--text); font-weight: 600; font-family: var(--font-mono); font-size: 0.72rem; }
        @media (max-width: 900px) { .up-root { grid-template-columns: 1fr; } .up-left { border-right: none; border-bottom: 1px solid var(--border); max-height: 50vh; } }
      `}</style>

      <form onSubmit={submit} className="up-root">

        {/* ══════ COLUMNA IZQUIERDA — Proyecto ══════ */}
        <div className="up-left">
          <div className="up-left-header">
            <h1>Subir material</h1>
            <p>Selecciona el proyecto destino</p>
          </div>

          <div className="up-proj-tabs">
            <button type="button" className={`up-tab ${projectMode === 'existing' ? 'active' : ''}`}
              onClick={() => setProjectMode('existing')} disabled={existingProjects.length === 0}>
              Existente
            </button>
            <button type="button" className={`up-tab ${projectMode === 'new' ? 'active' : ''}`}
              onClick={() => setProjectMode('new')}>
              Nuevo
            </button>
            <button type="button" className="up-tab" onClick={() => loadProjects()} disabled={projLoading}
              style={{ flex: '0 0 auto', padding: '7px 10px' }} title="Actualizar lista">
              ↻
            </button>
          </div>

          {projectMode === 'existing' ? (
            <>
              <div className="up-search-wrap">
                <input className="up-search" placeholder="Buscar por código o nombre…"
                  value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} />
              </div>
              <div className="up-proj-list">
                {projLoading && <div className="up-empty">Cargando proyectos…</div>}
                {projError  && <div className="up-empty" style={{ color: 'var(--red)' }}>{projError}</div>}
                {!projLoading && filteredProjects.length === 0 && (
                  <div className="up-empty">No se encontraron proyectos.</div>
                )}
                {filteredProjects.map((p) => (
                  <div key={p.code} className={`up-proj-item ${selectedCode === p.code ? 'active' : ''}`}
                    onClick={() => setSelectedCode(p.code)}>
                    <div>
                      <div className="up-proj-code">{p.code}</div>
                      <div className="up-proj-name">{p.name}</div>
                    </div>
                    <div className="up-proj-meta">
                      <span className={`badge ${statusCls(p.status)}`}>{p.status || 'n/a'}</span>
                      <span className="up-weeks">{p.weeks || 0} sem · {p.types || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="up-new-form">
              <div>
                <label className="up-label">Código</label>
                <input className="up-input" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Ej: 28002" />
              </div>
              <div>
                <label className="up-label">Nombre del proyecto</label>
                <input className="up-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej: Confluencia Puembo" />
              </div>
            </div>
          )}

          {/* Barra inferior: proyecto activo */}
          <div className="up-selected-bar">
            {selectedProject || (projectMode === 'new' && newCode) ? (
              <>
                <div className="up-selected-label">Proyecto activo</div>
                <div className="up-selected-name">{activeCode}</div>
                <div className="up-selected-sub">{activeName}</div>
                {savedSettings && (
                  <div className="up-sett-grid" style={{ marginTop: 10 }}>
                    {[
                      ['Prefijo', savedSettings.prefijo || 'FOT'],
                      ['Workers', savedSettings.maxWorkers ?? 4],
                      ['Índice', savedSettings.refreshIndex ? 'Sí' : 'No'],
                      ['Guardado', savedSettings.savedAt ? savedSettings.savedAt.slice(0, 10) : 'Nunca'],
                    ].map(([k, v]) => (
                      <div key={k} className="up-sett-item">
                        <span className="up-sett-key">{k}</span>
                        <span className="up-sett-val">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {projectMode === 'existing' && (
                  <button type="button" className="up-btn-ghost" style={{ marginTop: 10, width: '100%' }}
                    onClick={() => saveSettings()} disabled={settLoading}>
                    {settLoading ? 'Guardando…' : 'Guardar configuración'}
                  </button>
                )}
              </>
            ) : (
              <div className="up-selected-empty">
                Ningún proyecto seleccionado
              </div>
            )}
          </div>
        </div>

        {/* ══════ COLUMNA DERECHA — Ajustes + Origen ══════ */}
        <div className="up-right">

          {/* Ajustes */}
          <div className="up-section">
            <div className="up-section-title">Ajustes de subida</div>
            <div className="up-row3" style={{ marginBottom: 12 }}>
              <div>
                <label className="up-right-label">Prefijo</label>
                <select className="up-right-select" value={prefijo}
                  disabled={uploadMode === 'local' && keepNames}
                  onChange={(e) => setPrefijo(e.target.value)}>
                  {PREFIJOS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="up-right-label">Max Workers</label>
                <input type="number" className="up-right-input" min={1} max={24}
                  value={maxWorkers} onChange={(e) => setMaxWorkers(Number(e.target.value))} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8 }}>
                <label className="up-check-row">
                  <input type="checkbox" checked={refreshIndex} onChange={(e) => setRefreshIndex(e.target.checked)} />
                  Refrescar índice
                </label>
                {(uploadMode === 'sharepoint' || uploadMode === 'onedrive') && (
                  <label className="up-check-row">
                    <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
                    Recursivo
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Origen */}
          <div className="up-section">
            <div className="up-section-title">Origen de los archivos</div>

            <div className="up-mode-tabs">
              {UPLOAD_MODES.map((m) => (
                <button key={m.value} type="button"
                  className={`up-mode-tab ${uploadMode === m.value ? 'active' : ''}`}
                  onClick={() => { setUploadMode(m.value); setResult(null); setFileList([]) }}>
                  <i className={`ti ${m.icon}`} aria-hidden="true" />
                  {m.label}
                </button>
              ))}
            </div>

            {/* Mi equipo — subida directa al blob */}
            {uploadMode === 'local' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="up-btn-ghost" onClick={() => filesInputRef.current?.click()}>
                    Elegir archivos…
                  </button>
                  <button type="button" className="up-btn-ghost" onClick={() => folderInputRef.current?.click()}>
                    Elegir carpeta completa…
                  </button>
                  {localFiles.length > 0 && (
                    <button type="button" className="up-btn-ghost"
                      onClick={() => { setLocalFiles([]); setLocalPlan(null); setFileList([]); setResult(null) }}>
                      Quitar selección
                    </button>
                  )}
                </div>
                <input ref={filesInputRef} type="file" multiple hidden onChange={onPickLocal} />
                <input ref={folderInputRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={onPickLocal} />

                {localFiles.length > 0 && (
                  <div className="up-note">
                    <strong style={{ color: 'var(--text)' }}>{localFiles.length}</strong> archivo{localFiles.length !== 1 ? 's' : ''} seleccionado{localFiles.length !== 1 ? 's' : ''}
                    {' · '}{fmtSize(localFiles.reduce((s, f) => s + (f.size || 0), 0))}
                    {localFiles.some((f) => f.relativePath) && ' · carpeta completa (incluye subcarpetas)'}
                  </div>
                )}

                <label className="up-check-row">
                  <input type="checkbox" checked={keepNames}
                    onChange={(e) => { setKeepNames(e.target.checked); setLocalPlan(null); setFileList([]) }} />
                  Mantener nombres y carpetas originales (sin prefijo ni fechas)
                </label>

                <div className="up-hint">
                  Los archivos van directo de tu equipo al almacenamiento en bloques de 32 MB con
                  reintentos — no pasan por el servidor, así que los videos de varias GB no dependen
                  de su límite de tiempo. Cierra esta pestaña solo cuando termine.
                </div>

                <div>
                  <button type="button" className="up-btn-ghost" onClick={planLocal}
                    disabled={loading || !localFiles.length || !activeCode}>
                    {loading && !fileList.length ? 'Analizando…' : 'Analizar archivos (nombres y duplicados)'}
                  </button>
                </div>
              </div>
            )}

            {/* URLs directas */}
            {uploadMode === 'urls' && (
              <>
                <label className="up-right-label">URLs (una por línea)</label>
                <textarea className="up-textarea" value={urlsText}
                  onChange={(e) => setUrlsText(e.target.value)}
                  placeholder={"https://blob.core.windows.net/...\nhttps://empresa.sharepoint.com/:i:/s/..."} />
                <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <button type="button" className="up-btn-ghost" onClick={checkUrls} disabled={loading}>
                    
                    Comprobar existentes
                  </button>
                </div>
              </>
            )}

            {/* SharePoint */}
            {uploadMode === 'sharepoint' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="up-right-label">URL de carpeta SharePoint</label>
                  <div className="up-input-row">
                    <input className="up-right-input" value={spUrl} onChange={(e) => setSpUrl(e.target.value)}
                      placeholder="https://empresa.sharepoint.com/sites/Proyectos/Documentos%20compartidos/…" />
                    <button type="button" className="up-btn-ghost" onClick={resolveSpUrl}
                      disabled={spResolving || !spUrl.trim()} style={{ whiteSpace: 'nowrap' }}>
                      {spResolving ? 'Resolviendo…' : 'Resolver'}
                    </button>
                  </div>
                  {spResolved && (
                    <div className="up-resolved-box">
                      <strong>{spResolved.site_name}</strong> · <code>{spResolved.site_id}</code>
                      <br />Carpeta: <code>{spResolved.folder_path}</code>
                    </div>
                  )}
                </div>
                <div className="up-row2">
                  <div>
                    <label className="up-right-label">Site ID (opcional)</label>
                    <input className="up-right-input" value={spSiteId} onChange={(e) => setSpSiteId(e.target.value)}
                      placeholder="ripcon.sharepoint.com,abc,def" />
                  </div>
                  <div>
                    <label className="up-right-label">Folder path</label>
                    <input className="up-right-input" value={spFolderPath} onChange={(e) => setSpFolderPath(e.target.value)}
                      placeholder="/Proyectos/28002/Semana15" />
                  </div>
                </div>
              </div>
            )}

            {/* OneDrive */}
            {uploadMode === 'onedrive' && (
              <div className="up-row2">
                <div>
                  <label className="up-right-label">Email del usuario</label>
                  <input className="up-right-input" value={odEmail} onChange={(e) => setOdEmail(e.target.value)}
                    placeholder="usuario@empresa.com" />
                </div>
                <div>
                  <label className="up-right-label">Ruta de carpeta</label>
                  <input className="up-right-input" value={odFolder} onChange={(e) => setOdFolder(e.target.value)}
                    placeholder="/Fotos Obra/Semana 15" />
                </div>
              </div>
            )}
          </div>

          {/* Archivos detectados */}
          {fileList.length > 0 && (
            <div className="up-section">
              <div className="up-section-title">
                Archivos
                <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
                  {fileList.filter((f) => f.include).length} / {fileList.length} seleccionados
                </span>
                <button type="button" className="up-btn-ghost" style={{ marginLeft: 'auto', fontSize: 10 }}
                  onClick={() => setFileList(fileList.map((f) => ({ ...f, include: true })))}>Todo</button>
                <button type="button" className="up-btn-ghost" style={{ fontSize: 10 }}
                  onClick={() => setFileList(fileList.map((f) => ({ ...f, include: false })))}>Nada</button>
              </div>
              <table className="up-file-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>✓</th>
                    <th>Archivo</th>
                    <th style={{ width: 160 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {fileList.map((f, idx) => {
                    const phase = f.phase || (f.exists ? 'exists' : f.similar ? 'similar' : 'new')
                    const phaseLabel = { exists: 'Ya existe', similar: 'Similar', new: 'Nuevo', queued: 'En cola', downloading: 'Descargando', uploading: 'Subiendo', uploaded: 'Subido', error: 'Error', skipped: 'Omitido' }[phase] || phase
                    return (
                      <tr key={idx}>
                        <td>
                          <input type="checkbox" checked={f.include} style={{ accentColor: 'var(--accent)' }}
                            onChange={(e) => {
                              const c = [...fileList]; c[idx] = { ...c[idx], include: e.target.checked }; setFileList(c)
                            }} />
                        </td>
                        <td>
                          <div className="up-file-name">{f.name || f.nombre_nuevo || '—'}</div>
                          {f.blob && <div className="up-file-blob">{f.blob}</div>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <span className={`up-phase ${phase}`}>{phaseLabel}</span>
                            {f.downloadTotal > 0 && (
                              <div className="up-progress">
                                <div className="up-progress-bar" style={{ width: `${Math.min(100, Math.round((f.downloaded || 0) / f.downloadTotal * 100))}%` }} />
                              </div>
                            )}
                            {f.error && <div className="up-file-error">{f.error}</div>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Resultado */}
          {result && (
            <div className="up-result">
              <div className="up-result-title">Resultado</div>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}

          {/* Footer */}
          <div className="up-footer">
            <button className="up-btn-primary" type="submit"
              disabled={loading || polling || (uploadMode === 'local' && !fileList.some((f) => f.include && f._sasUrl))}>
              {loading || polling
                ? <>Procesando…</>
                : uploadMode === 'local'
                  ? <>Subir {fileList.filter((f) => f.include && f._sasUrl).length} archivo{fileList.filter((f) => f.include && f._sasUrl).length !== 1 ? 's' : ''}</>
                  : <>Iniciar subida</>}
            </button>
            {polling && jobId && (
              <span className="up-job-badge">job: {jobId.slice(0, 12)}…</span>
            )}
          </div>
        </div>
      </form>
    </>
  )
}