// src/config/sections.js
// Registro central de secciones del hub. Agregar una sección nueva = una entrada aquí
// (Sidebar, rutas y destino de subida se generan a partir de esta lista).
//
// kind:
//   'projects' → carpetas por obra con código + semanas (la sección Proyectos).
//   'media'    → biblioteca de carpetas libres en el blob (_media/<id>/…).
export const SECTIONS = [
  {
    id: 'proyectos',
    label: 'Proyectos',
    path: '/proyectos',
    kind: 'projects',
    status: 'active',
    description: 'Todo el material audiovisual de cada obra: fotos, dron, video y 360° organizados por proyecto y semana.',
  },
  {
    id: 'marcas',
    label: 'Marcas',
    path: '/marcas',
    kind: 'media',
    status: 'active',
    description: 'Arquetipo, personalidad y variantes descargables de cada marca del grupo RIPCON, filtrables por fondo, color y formato.',
  },
  {
    id: 'documentos',
    label: 'Documentos y Plantillas',
    path: '/documentos',
    kind: 'media',
    status: 'active',
    description: 'Plantillas de marca, papelería, presentaciones y manuales listos para usar.',
  },
  {
    id: 'videos',
    label: 'Videos Corporativos',
    path: '/videos',
    kind: 'media',
    status: 'active',
    description: 'Institucionales y spots de la empresa, independientes de cada obra.',
  },
  {
    id: 'eventos',
    label: 'Fotografía de Eventos',
    path: '/eventos',
    kind: 'media',
    status: 'active',
    description: 'Eventos corporativos, equipo y cultura de empresa.',
  },
  {
    id: 'redes',
    label: 'Redes Sociales',
    path: '/redes',
    kind: 'media',
    status: 'active',
    description: 'Contenido preparado y publicado para Instagram, LinkedIn y más.',
  },
]

export const MEDIA_SECTIONS = SECTIONS.filter(s => s.kind === 'media')
export const sectionById = (id) => SECTIONS.find(s => s.id === id)
