// src/utils/pdfThumb.js
// Miniatura de la 1ª página de un PDF, renderizada en el navegador con PDF.js
// (sin servidor). Best-effort: si falla (CORS del blob, PDF protegido…), el
// llamador se queda con el ícono de tipo.
//
// pdfjs-dist es pesado, así que se carga on-demand (dynamic import): solo baja
// su chunk cuando de verdad hay un PDF que miniaturizar.

let _pdfjs = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  _pdfjs = pdfjs
  return pdfjs
}

const _cache = new Map()

export async function renderPdfThumb(url, { width = 480 } = {}) {
  if (_cache.has(url)) return _cache.get(url)
  const pdfjs = await getPdfjs()
  const doc = await pdfjs.getDocument({ url }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, width / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    // Fondo blanco (los PDF suelen tener fondo transparente en el canvas).
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    _cache.set(url, dataUrl)
    return dataUrl
  } finally {
    try { doc.destroy() } catch { /* noop */ }
  }
}
