// src/components/CommandPalette.jsx
// Búsqueda global (Ctrl+K / Cmd+K): salta a secciones, proyectos y marcas
// desde cualquier página. Carga los datos una sola vez al abrirse.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../utils/api'
import { SECTIONS } from '../config/sections'
import { useAuthz, canSection } from '../utils/authz'

export default function CommandPalette() {
  const { me } = useAuthz()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dynamicItems, setDynamicItems] = useState([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    const onOpenEvent = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('ripcon:cmdk', onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('ripcon:cmdk', onOpenEvent)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    setTimeout(() => inputRef.current?.focus(), 0)

    if (loadedRef.current) return
    loadedRef.current = true
    const loads = []
    if (canSection(me, 'material')) {
      loads.push(
        api.getProjects()
          .then(ps => (Array.isArray(ps) ? ps : [])
            .filter(p => p.hasContent !== false)
            .map(p => ({ type: 'Proyecto', label: `${p.code} — ${p.name}`, path: `/proyectos/project/${p.code}` })))
          .catch(() => [])
      )
    }
    if (canSection(me, 'marcas')) {
      loads.push(
        api.listMediaFolders('marcas')
          .then(d => (d?.folders || []).map(f => ({ type: 'Marca', label: f.name, path: `/marcas/${encodeURIComponent(f.name)}` })))
          .catch(() => [])
      )
    }
    Promise.all(loads).then(parts => setDynamicItems(parts.flat()))
  }, [open, me])

  const results = useMemo(() => {
    const sectionItems = SECTIONS
      .filter(s => canSection(me, s.id))
      .map(s => ({ type: 'Sección', label: s.label, path: s.path }))
    const all = [...sectionItems, ...dynamicItems]
    const t = query.trim().toLowerCase()
    const base = t ? all.filter(i => i.label.toLowerCase().includes(t)) : all
    return base.slice(0, 12)
  }, [query, dynamicItems, me])

  function go(item) {
    setOpen(false)
    nav(item.path)
  }

  function onInputKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && results[selected]) { e.preventDefault(); go(results[selected]) }
  }

  if (!open) return null

  return (
    <div className="cmdk-overlay" onClick={e => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Búsqueda global">
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Buscar proyecto, marca o sección..."
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0) }}
          onKeyDown={onInputKey}
        />
        <div className="cmdk-list">
          {results.length === 0 && <div className="cmdk-empty">Sin resultados para “{query}”</div>}
          {results.map((item, i) => (
            <button
              key={`${item.type}:${item.path}`}
              className={`cmdk-item ${i === selected ? 'is-selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => go(item)}
            >
              <span className="cmdk-type">{item.type}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="cmdk-hint">
          <span>↑↓ navegar</span>
          <span>Enter abrir</span>
          <span>Esc cerrar</span>
        </div>
      </div>
    </div>
  )
}
