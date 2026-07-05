# Product

## Register

product

## Users

Equipo de marketing/audiovisual de RIPCONCIV y gerencia/dirección que supervisa o aprueba contenido. Uso interno, típicamente de oficina, en sesiones donde necesitan encontrar, revisar, aprobar o descargar material rápido — no son diseñadores, así que la navegación tiene que ser obvia sin curva de aprendizaje. El trabajo a resolver: localizar el activo correcto (foto de dron de un proyecto, logo en la variante correcta, plantilla de PowerPoint, video corporativo) sin depender de carpetas de red dispersas ni preguntar a otra persona dónde está.

## Product Purpose

Rework de "Visor Audiovisual" (hoy: un visor de un solo propósito — material de obra por Proyecto → Semana → Galería) hacia un **hub interno de contenido audiovisual y de marca de RIPCONCIV**, con arquitectura tipo SharePoint/intranet: navegación por secciones que puede crecer sin rediseñar el shell.

Secciones confirmadas para el roadmap (construcción por fases, no todas a la vez):
1. **Material** (ya existe) — fotos/dron/video/360 por Proyecto → Semana → Galería.
2. **Proyectos** — ficha y estado de cada proyecto de construcción.
3. **Marcas** (antes "Logos", ampliada por pedido de dirección) — **carpetas dinámicas en el blob** bajo `_media/marcas/<Marca>/` (RIPCONCIV ya migrada; nuevas marcas como GEOFORCE se crean desde la UI y generan su carpeta real en el storage). Cada marca tiene:
   - Su **arquetipo de marca** (personalidad, tono) en un `marca.json` dentro de su carpeta.
   - Sus variantes descargables; los archivos que siguen la convención `formato-fondo-color.png` activan automáticamente la galería con **filtros** (formato / fondo / color); el resto se lista como archivos descargables genéricos.
   - Subida directa de archivos a la carpeta (solo administradores) desde la propia página.
   - La biblioteca `_media/<seccion>/` está lista para reutilizarse en Documentos, Videos, Eventos y Redes.
4. **Documentos y plantillas** — plantillas de marca, papelería, presentaciones, manuales.
5. **Videos corporativos** — institucionales/spots no ligados a un proyecto de obra.
6. **Fotografía de eventos** — eventos corporativos, equipo, cultura de empresa.
7. **Redes sociales** — contenido preparado/publicado para RRSS.

Éxito = cualquier persona de marketing o gerencia encuentra y descarga el activo correcto en segundos, y el equipo puede añadir una sección nueva (p. ej. "Video institucional 2027") sin que se sienta pegada con cinta a un sitio pensado para una sola cosa.

## Brand Personality

Moderno, dinámico, audaz — pero anclado en la identidad real de RIPCONCIV (ingeniería civil/construcción), no en un skin genérico de agencia. Debe sentirse como si el propio departamento de diseño de RIPCON hubiera construido su intranet: preciso, con peso visual, orgulloso del material que produce. Azul institucional `#192D96` (del logo oficial RIPCONCIV) como ancla de marca, no como acento decorativo.

## Anti-references

- El look "Claude/IA genérica" — el diseño actual del visor no debe leerse como una app de IA por defecto.
- Corporativo aburrido: intranet tipo SharePoint out-of-the-box, azul-corbata sin personalidad.
- SaaS genérico: tarjetas idénticas, texto con gradiente, eyebrows en mayúsculas sobre cada sección — cualquier tell de "plantilla de dashboard con IA".

## Design Principles

1. **Secciones como ciudadanos de primera clase** — la navegación (shell/sidebar) debe escalar a N secciones sin rediseño; hoy son 7, mañana pueden ser 12.
2. **La marca RIPCONCIV manda** — el azul `#192D96` del logo real es el ancla cromática del sistema, no un accent token cualquiera.
3. **Denso pero navegable** — el contenido real es voluminoso (cientos/miles de fotos y videos por proyecto); la jerarquía y los filtros importan más que el espacio en blanco decorativo.
4. **Un solo shell, N secciones** — cabecera/navegación consistente entre Material, Proyectos, Logos, etc.; cambiar de sección se siente como cambiar de pestaña, no de sitio.
5. **Construir por fases** — primero shell + rediseño visual sobre lo existente (Material/Proyectos), luego cada sección nueva se añade de forma incremental sin tocar las demás.
6. **Marcas es multi-marca desde el modelo de datos** — "Marcas" no es una galería de una sola empresa; cada marca del grupo tiene su propio arquetipo y su propio set de variantes filtrables, así que la estructura debe soportar N marcas sin rehacerse cuando dirección añada la siguiente.
7. **Acceso por persona, administrado desde la app** — el hub tiene roles (administrador / visualizador) y una página "Accesos" donde el administrador decide, por correo, quién entra, qué secciones ve y qué proyectos puede abrir (caso típico: un consultor externo que solo ve ciertos proyectos). El backend valida el token de Entra ID y aplica los permisos en cada endpoint; la config vive en `_config/access.json` del blob storage. Modo "abierto" (todos los del tenant ven todo) hasta que el admin active el modo restringido.

## Accessibility & Inclusion

WCAG AA como base (uso interno, en oficina, monitores variados). Sin requisitos específicos adicionales reportados; mantener contraste correcto y soporte de teclado dado el volumen de archivos que hay que revisar y comparar.
