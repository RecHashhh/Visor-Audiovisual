import React, { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../utils/api'
import { 
  ArrowLeft, Download, ExternalLink, FileText, 
  ChevronLeft, ChevronRight, X, Filter, RefreshCw 
} from 'lucide-react'

// Helper de tipos (Movido fuera para que no se recree)
const prefixOf = (name) => {
  const p = name.split('_')[0].upperCase ? name.split('_')[0].toUpperCase() : ""
  return ["DRN", "FOT", "VID", "E360", "I360"].includes(p) ? p : "FILE"
}

export default function GalleryPage() {
  const { id, week } = useParams()
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [lightbox, setLightbox] = useState(null)
  const [sasUrls, setSasUrls] = useState({})

  // 1. LÓGICA DE FILTRADO (Ahora declarada antes de los Effects)
  const prefixes = useMemo(() => {
    return [...new Set(files.map(f => prefixOf(f.name)))].filter(Boolean)
  }, [files])

  const displayFiles = useMemo(() => {
    return filter === 'all' ? files : files.filter(f => prefixOf(f.name) === filter)
  }, [files, filter])

  // 2. CARGA DE DATOS
  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getFiles(id, week)
        setFiles(data)
        // Batch SAS para eficiencia
        const paths = data.map(f => f.path)
        if (paths.length > 0) {
          const { urls } = await api.getSasBatch(paths, 120)
          setSasUrls(urls)
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, week])

  // 3. MANEJO DE TECLADO (Ahora displayFiles ya existe arriba)
  useEffect(() => {
    const handler = (e) => {
      if (!lightbox) return
      if (e.key === 'ArrowRight') navLightbox(1)
      if (e.key === 'ArrowLeft') navLightbox(-1)
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, displayFiles]) // SEGURO: displayFiles está inicializado

  const navLightbox = (dir) => {
    const idx = displayFiles.findIndex(f => f.path === lightbox.path)
    const next = displayFiles[(idx + dir + displayFiles.length) % displayFiles.length]
    setLightbox(next)
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
      <RefreshCw className="w-10 h-10 animate-spin mb-4 text-blue-500" />
      <p className="animate-pulse">Cargando galería audiovisual...</p>
    </div>
  )

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header con Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
            <Link to="/projects" className="hover:text-blue-400 transition-colors">Proyectos</Link>
            <span>/</span>
            <Link to={`/projects/${id}`} className="hover:text-blue-400 transition-colors">{id}</Link>
            <span>/</span>
            <span className="text-slate-300">{week}</span>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            Registro Audiovisual
          </h1>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-2 bg-slate-900/50 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'all' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-white'
            }`}
          >
            Todos
          </button>
          {prefixes.map(p => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === p ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Archivos */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {displayFiles.map((file) => (
          <div 
            key={file.path}
            className="group relative bg-slate-900 rounded-xl overflow-hidden border border-white/5 hover:border-blue-500/50 transition-all cursor-pointer"
            onClick={() => setLightbox(file)}
          >
            <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
              {file.type === 'img' ? (
                <img 
                  src={sasUrls[file.path] || ''} 
                  alt={file.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <FileText className="w-8 h-8" />
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-white/10 rounded uppercase">
                    {file.type}
                  </span>
                </div>
              )}
            </div>
            
            <div className="p-3">
              <p className="text-xs text-slate-300 truncate font-medium">{file.name}</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">{file.prefix}</p>
            </div>

            <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ExternalLink className="w-6 h-6 text-white drop-shadow-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col animate-in fade-in zoom-in duration-300">
          <div className="flex items-center justify-between p-4 text-white">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{lightbox.name}</span>
              <span className="text-[10px] text-slate-500 uppercase">{lightbox.path}</span>
            </div>
            <div className="flex items-center gap-4">
              <a 
                href={sasUrls[lightbox.path]} 
                download 
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <Download className="w-6 h-6" />
              </a>
              <button onClick={() => setLightbox(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="flex-1 relative flex items-center justify-center p-4">
            <button 
              onClick={(e) => { e.stopPropagation(); navLightbox(-1); }}
              className="absolute left-4 p-4 hover:bg-white/5 rounded-full transition-colors text-white/50 hover:text-white"
            >
              <ChevronLeft className="w-10 h-10" />
            </button>

            <div className="max-w-5xl max-h-full flex items-center justify-center">
              {lightbox.type === 'img' ? (
                <img src={sasUrls[lightbox.path]} alt="" className="max-w-full max-h-[80vh] object-contain shadow-2xl" />
              ) : lightbox.type === 'vid' ? (
                <video src={sasUrls[lightbox.path]} controls autoPlay className="max-w-full max-h-[80vh]" />
              ) : (
                <div className="bg-slate-900 p-12 rounded-2xl border border-white/10 flex flex-col items-center gap-6">
                  <FileText className="w-20 h-20 text-blue-500" />
                  <div className="text-center">
                    <p className="text-xl text-white font-bold mb-2">Vista previa no disponible</p>
                    <p className="text-slate-400">Este tipo de archivo ({lightbox.type}) debe ser descargado.</p>
                  </div>
                  <a 
                    href={sasUrls[lightbox.path]} 
                    download 
                    className="bg-blue-600 hover:bg-blue-500 px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 text-white"
                  >
                    <Download className="w-5 h-5" /> Descargar Archivo
                  </a>
                </div>
              )}
            </div>

            <button 
              onClick={(e) => { e.stopPropagation(); navLightbox(1); }}
              className="absolute right-4 p-4 hover:bg-white/5 rounded-full transition-colors text-white/50 hover:text-white"
            >
              <ChevronRight className="w-10 h-10" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
