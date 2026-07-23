// src/utils/sections.jsx
// Secciones vigentes del hub: se piden una vez por sesión a /api/sections y de
// ahí salen el menú lateral, las rutas y los destinos de subida.
//
// Arranca con el catálogo por defecto (config/sections.js) en vez de con una
// lista vacía: el menú se pinta al instante y, si la API falla, la app sigue
// siendo navegable con las secciones de siempre.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { DEFAULT_SECTIONS, withPaths } from '../config/sections'

const SectionsContext = createContext(null)

function derive(list) {
  const sections = withPaths(list)
  return {
    sections,
    mediaSections: sections.filter(s => s.kind === 'media'),
    linkSections: sections.filter(s => s.kind === 'links'),
    byId: (id) => sections.find(s => s.id === id),
  }
}

const FALLBACK = { ...derive(DEFAULT_SECTIONS), loaded: false, refresh: () => {}, apply: () => {} }

export function SectionsProvider({ enabled = true, children }) {
  const [list, setList] = useState(DEFAULT_SECTIONS)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve()
    return api.getSections()
      .then(data => {
        if (Array.isArray(data?.sections) && data.sections.length) setList(data.sections)
      })
      // Backend antiguo (sin /api/sections) o caído: nos quedamos con el catálogo
      // por defecto en lugar de dejar al usuario sin menú.
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [enabled])

  useEffect(() => { refresh() }, [refresh])

  const value = useMemo(() => ({
    ...derive(list),
    loaded,
    refresh,
    // Tras guardar en la página Secciones, refleja el cambio sin recargar.
    apply: (next) => { if (Array.isArray(next) && next.length) setList(next) },
  }), [list, loaded, refresh])

  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>
}

export function useSections() {
  return useContext(SectionsContext) || FALLBACK
}
