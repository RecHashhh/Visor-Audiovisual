// src/config/sectionIcons.jsx
// Un set de iconos de línea, compartido entre el Sidebar y la portada (Home),
// para que cada sección se identifique con el mismo símbolo en toda la app.
//
// Las claves de las secciones originales coinciden con su id; las secciones
// nuevas que se crean desde el panel eligen una de estas claves en el campo
// `icon` (ver ICON_CHOICES). Si el icono no existe se usa el de carpeta.
export const SECTION_ICONS = {
  proyectos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8A2 2 0 0 1 21 9.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M9.5 13.2l2-2.4 1.8 2 1.4-1.5 2.3 2.9" />
    </svg>
  ),
  marcas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0l-6.7-6.7a2 2 0 0 1 0-2.8L10.5 3H18a2 2 0 0 1 2 2v7.5z" />
      <circle cx="14.5" cy="8.5" r="1.4" />
    </svg>
  ),
  documentos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4M9 12h6M9 15.5h6M9 8.5h2" />
    </svg>
  ),
  videos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10.2 21 7v10l-6-3.2" />
    </svg>
  ),
  eventos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  ),
  redes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.1 10.8 15.9 7.2M8.1 13.2l7.8 3.6" />
    </svg>
  ),
  politicas: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </svg>
  ),
  // ── Genéricos para secciones creadas desde el panel ────────────────────────
  carpeta: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8A2 2 0 0 1 21 9.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  ),
  imagen: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M4.5 17.5l4.8-5 3.2 3.4 2.6-2.4 4.4 4" />
    </svg>
  ),
  estrella: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z" />
    </svg>
  ),
  gente: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7" />
      <path d="M16 5.6a3 3 0 0 1 0 5.8M18 14.6c1.6.7 2.6 2.2 2.9 4.4" />
    </svg>
  ),
  calendario: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  ),
  caja: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.2 12 4l8.5 4.2v7.6L12 20l-8.5-4.2V8.2z" />
      <path d="M3.5 8.2 12 12.4l8.5-4.2M12 12.4V20" />
    </svg>
  ),
  mapa: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8 9 4.5z" />
      <path d="M9 4.5v12.7M15 6.8v12.7" />
    </svg>
  ),
  herramienta: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.8 6.4a4 4 0 0 0 5.1 5.1l-8 8a2.4 2.4 0 0 1-3.4-3.4l8-8z" />
      <path d="M6.5 4.5 4 7l3 3 2.5-2.5-3-3z" />
    </svg>
  ),
}

// Orden en el que se ofrecen al crear una sección nueva.
export const ICON_CHOICES = [
  'carpeta', 'documentos', 'imagen', 'videos', 'eventos', 'marcas',
  'politicas', 'redes', 'proyectos', 'estrella', 'gente', 'calendario',
  'caja', 'mapa', 'herramienta',
]

// Icono de una sección: por clave `icon`, si no por id, si no el de carpeta.
export function sectionIcon(section) {
  if (!section) return SECTION_ICONS.carpeta
  return SECTION_ICONS[section.icon] || SECTION_ICONS[section.id] || SECTION_ICONS.carpeta
}
