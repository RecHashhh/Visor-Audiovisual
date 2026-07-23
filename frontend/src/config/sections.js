// src/config/sections.js
// Catálogo INICIAL de secciones del hub.
//
// La lista real la decide quien administra desde la página "Secciones" y vive
// en el backend ({CONFIG_PREFIX}/sections.json). Esta constante es solo:
//   1. el valor con el que se pinta el menú antes de que responda /api/sections
//      (así no hay parpadeo ni salto de layout), y
//   2. el fallback si la API falla o es un backend viejo sin ese endpoint.
// Para leer las secciones vigentes usa useSections() de utils/sections.jsx.
//
// kind:
//   'projects' → carpetas por obra con código + semanas (la sección Proyectos).
//   'media'    → biblioteca de carpetas libres en el blob (_media/<id>/…).
//   'links'    → lista de enlaces (redes sociales); sin carpetas, tarjetas preview.
export const DEFAULT_SECTIONS = [
  {
    id: 'proyectos',
    label: 'Proyectos',
    kind: 'projects',
    icon: 'proyectos',
    description: 'Todo el material audiovisual de cada obra: fotos, dron, video y 360° organizados por proyecto y semana.',
  },
  {
    id: 'marcas',
    label: 'Marcas',
    kind: 'media',
    icon: 'marcas',
    description: 'Arquetipo, personalidad y variantes descargables de cada marca del grupo RIPCON, filtrables por fondo, color y formato.',
  },
  {
    id: 'documentos',
    label: 'Documentos y Plantillas',
    kind: 'media',
    icon: 'documentos',
    description: 'Plantillas de marca, papelería, presentaciones y manuales listos para usar.',
  },
  {
    id: 'videos',
    label: 'Videos Corporativos',
    kind: 'media',
    icon: 'videos',
    description: 'Institucionales y spots de la empresa, independientes de cada obra.',
  },
  {
    id: 'eventos',
    label: 'Fotografía de Eventos',
    kind: 'media',
    icon: 'eventos',
    description: 'Eventos corporativos, equipo y cultura de empresa.',
  },
  {
    id: 'redes',
    label: 'Redes Sociales',
    kind: 'links',
    icon: 'redes',
    description: 'Enlaces oficiales a las redes sociales de la empresa: Instagram, LinkedIn, Facebook y más.',
  },
  {
    id: 'politicas',
    label: 'Politicas',
    kind: 'media',
    icon: 'politicas',
    description: 'Políticas, normativas y reglamentos internos de la empresa.',
  },
]

// La sección de obras es fija: no se puede borrar ni cambiar de tipo desde el
// panel, porque sus rutas (/proyectos/project/:id/week/:week) y su índice son
// lógica aparte del resto de secciones.
export const PROTECTED_SECTION = 'proyectos'

// El id manda: es a la vez el segmento de URL y la carpeta en el blob.
export const withPaths = (items) =>
  (items || []).map(s => ({ ...s, path: `/${s.id}`, icon: s.icon || s.id }))
