// src/config/sections.js
// Registro central de secciones del hub. Agregar una sección nueva = una entrada aquí
// (Sidebar y las rutas "próximamente" se generan a partir de esta lista).
// Código de hoja al estilo de un índice de planos (convención MEP: M, E, S, A...):
// identifica cada sección, no implica un orden secuencial.
export const SECTIONS = [
  {
    // id interno se mantiene 'material' para no romper permisos ya guardados
    id: 'material',
    code: 'P-01',
    label: 'Proyectos',
    path: '/proyectos',
    status: 'active',
    description: 'Todo el material audiovisual de cada obra: fotos, dron, video y 360° organizados por proyecto y semana.',
  },
  {
    id: 'marcas',
    code: 'MK-01',
    label: 'Marcas',
    path: '/marcas',
    status: 'active',
    description: 'Arquetipo, personalidad y variantes descargables de cada marca del grupo RIPCON, filtrables por fondo, color y formato.',
  },
  {
    id: 'documentos',
    code: 'D-01',
    label: 'Documentos y Plantillas',
    path: '/documentos',
    status: 'soon',
    description: 'Plantillas de marca, papelería, presentaciones y manuales listos para usar.',
  },
  {
    id: 'videos',
    code: 'V-01',
    label: 'Videos Corporativos',
    path: '/videos-corporativos',
    status: 'soon',
    description: 'Institucionales y spots de la empresa, independientes de cada obra.',
  },
  {
    id: 'eventos',
    code: 'EV-01',
    label: 'Fotografía de Eventos',
    path: '/fotografia-eventos',
    status: 'soon',
    description: 'Eventos corporativos, equipo y cultura de empresa.',
  },
  {
    id: 'redes',
    code: 'R-01',
    label: 'Redes Sociales',
    path: '/redes-sociales',
    status: 'soon',
    description: 'Contenido preparado y publicado para Instagram, LinkedIn y más.',
  },
]
