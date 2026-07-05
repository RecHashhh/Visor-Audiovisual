// scripts/screenshots.mjs — captura visual de todas las páginas con Playwright.
// Usa el bypass dev-preview (solo existe en desarrollo) + APIs simuladas, así
// no necesita login MSAL ni backend corriendo.
//
// Herramienta LOCAL de desarrollo (playwright no va en package.json para no
// inflar el despliegue). Requisito la primera vez:
//   npm i -D playwright && npx playwright install chromium
//
// Uso (con el dev server arriba):
//   node scripts/screenshots.mjs            (dev server en http://localhost:5173)
//   SHOT_BASE=http://localhost:5174 node scripts/screenshots.mjs
//
// Salida: frontend/.shots/*.png (ignorado por git)
import { chromium } from 'playwright'
import { readdirSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.SHOT_BASE || 'http://localhost:5173'
const OUT = process.env.SHOT_OUT || resolve(__dir, '../.shots')
const PUB = resolve(__dir, '../public')
mkdirSync(OUT, { recursive: true })

const DAY = 'puente-dia.jpg'
const NIGHT = 'puente-noche.jpg'

const projects = [
  { code: '33014_promart-quitumbe', name: 'PROMART QUITUMBE FASE IV', weeks: 18, types: 'DRN+FOT+VID', status: 'completo', statusReason: '', hasContent: true, lastModified: '2026-07-01T10:00:00Z', coverPath: 'mock/dia.jpg' },
  { code: '28002_confluencia-puembo', name: 'CONFLUENCIA PUEMBO', weeks: 32, types: 'DRN+FOT', status: 'subiendo', statusReason: '', hasContent: true, lastModified: '2026-07-04T10:00:00Z', coverPath: 'mock/noche.jpg' },
  { code: '22012_pavimento-posorja', name: 'PAVIMENTO ZONA W PTO POSORJA', weeks: 24, types: 'DRN+FOT+VID', status: 'completo', statusReason: '', hasContent: true, lastModified: '2026-06-20T10:00:00Z', coverPath: 'mock/dia.jpg' },
  { code: '19004_vial-4', name: 'VIAL 4 AV DE LAS AMERICAS', weeks: 12, types: 'FOT', status: 'completo', statusReason: '', hasContent: true, lastModified: '2026-05-11T10:00:00Z', coverPath: null },
  { code: '22005_ptap-mancha-grande', name: 'PTAP MANCHA GRANDE', weeks: 9, types: 'DRN+FOT', status: 'completo', statusReason: '', hasContent: true, lastModified: '2026-04-02T10:00:00Z', coverPath: 'mock/dia.jpg' },
  { code: '33013_vivantino', name: 'VIVANTINO', weeks: 4, types: 'DRN', status: 'pendiente', statusReason: '', hasContent: true, lastModified: '2026-03-15T10:00:00Z', coverPath: 'mock/noche.jpg' },
]

const thumbsDir = resolve(PUB, 'brands/ripconciv/thumbs')
const brandFiles = readdirSync(thumbsDir)
  .filter(f => f.endsWith('.png'))
  .map(name => ({
    name,
    path: `_media/marcas/RIPCONCIV/${name}`,
    size: 180000,
    type: 'img',
    lastModified: '2026-07-04T09:00:00Z',
  }))

const marcaMeta = {
  name: 'RIPCONCIV',
  tagline: 'Construcción e ingeniería civil',
  archetype: {
    name: 'El Creador',
    summary: 'Construye lo que antes no existía, y lo hace para que dure.',
    description: 'RIPCONCIV construye infraestructura real: puentes, vías, edificaciones. El arquetipo del Creador encaja porque la marca no vende una promesa abstracta — entrega algo tangible, medible y durable.',
  },
}

async function mockApis(page) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })

    if (p === '/api/me') {
      return json({ email: 'preview@ripconciv.com', name: 'Preview Admin', allowed: true, isAdmin: true, sections: '*', projects: '*', restricted: false, bootstrap: false })
    }
    if (p === '/api/projects') return json(projects)
    if (p === '/api/media/marcas') {
      return json({ section: 'marcas', folders: [
        { name: 'RIPCONCIV', fileCount: 30, lastModified: '2026-07-04T09:00:00Z' },
        { name: 'GEOFORCE', fileCount: 4, lastModified: '2026-06-20T09:00:00Z' },
      ] })
    }
    if (p.startsWith('/api/media/marcas/RIPCONCIV')) {
      return json({ section: 'marcas', folder: 'RIPCONCIV', files: brandFiles, meta: marcaMeta })
    }
    if (p.startsWith('/api/media/')) return json({ section: 'marcas', folder: 'GEOFORCE', files: [], meta: null })
    if (p === '/api/thumb') {
      const bp = url.searchParams.get('blobPath') || ''
      if (bp.includes('_media/marcas/RIPCONCIV/')) {
        return route.fulfill({ path: resolve(thumbsDir, bp.split('/').pop()), contentType: 'image/png' })
      }
      const img = bp.includes('noche') ? NIGHT : DAY
      return route.fulfill({ path: resolve(PUB, 'hero', img), contentType: 'image/jpeg' })
    }
    if (p === '/api/access') {
      return json({ config: { restricted: false, users: [
        { email: 'agarzon@ripconciv.com', name: '', role: 'admin', enabled: true, sections: '*', projects: '*' },
        { email: 'consultor@externo.com', name: '', role: 'viewer', enabled: true, sections: ['material'], projects: ['33014_promart-quitumbe'] },
        { email: 'marketing@ripconciv.com', name: '', role: 'viewer', enabled: true, sections: ['marcas', 'documentos'], projects: '*' },
      ] }, exists: true, bootstrap: false, envAdmins: [], knownSections: ['material', 'proyectos', 'marcas', 'documentos', 'videos', 'eventos', 'redes'] })
    }
    if (p === '/api/share/list') {
      return json([
        { token: 'abc123', projectId: '33014_promart-quitumbe', week: '2026_S26', expiresAt: '2026-07-20T00:00:00Z', active: true, expired: false },
        { token: 'def456', projectId: '28002_confluencia-puembo', week: '2026_S25', expiresAt: '2026-07-12T00:00:00Z', active: true, expired: false },
        { token: 'old789', projectId: '22012_pavimento-posorja', week: '2026_S20', expiresAt: '2026-06-01T00:00:00Z', active: true, expired: true },
      ])
    }
    if (/^\/api\/projects\/[^/]+\/settings$/.test(p)) {
      return json({ prefijo: 'DRN', maxWorkers: 8, refreshIndex: true, savedAt: '2026-07-01T00:00:00Z' })
    }
    if (/^\/api\/projects\/[^/]+\/browse/.test(p)) {
      return json({ path: '', folders: [
        { name: '2026_S26', path: '2026_S26', count: 48, types: ['DRN', 'FOT'], lastModified: '2026-07-01T10:00:00Z' },
        { name: '2026_S25', path: '2026_S25', count: 122, types: ['DRN', 'FOT', 'VID'], lastModified: '2026-06-24T10:00:00Z' },
      ], files: [] })
    }
    if (p === '/api/health') return json({ status: 'ok' })
    return json({})
  })
}

const shots = [
  { name: 'home-light', path: '/', theme: 'light' },
  { name: 'home-dark', path: '/', theme: 'dark' },
  { name: 'proyectos-light', path: '/proyectos', theme: 'light' },
  { name: 'proyectos-dark', path: '/proyectos', theme: 'dark' },
  { name: 'marcas-light', path: '/marcas', theme: 'light' },
  { name: 'marca-ripconciv-light', path: '/marcas/RIPCONCIV', theme: 'light' },
  { name: 'marca-ripconciv-dark', path: '/marcas/RIPCONCIV', theme: 'dark' },
  { name: 'upload-light', path: '/upload', theme: 'light' },
  { name: 'upload-dark', path: '/upload', theme: 'dark' },
  { name: 'accesos-light', path: '/accesos', theme: 'light' },
  { name: 'enlaces-light', path: '/enlaces', theme: 'light' },
]

const browser = await chromium.launch()

for (const shot of shots) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: shot.theme })
  const page = await ctx.newPage()
  await mockApis(page)
  await page.addInitScript((theme) => {
    localStorage.setItem('ripcon-dev-preview', '1')
    localStorage.setItem('ripcon-theme', theme)
  }, shot.theme)
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${shot.name}.png` })
  console.log('shot:', shot.name)
  await ctx.close()
}

// Login (sin bypass) — la primera pantalla real
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await mockApis(page)
  await page.addInitScript(() => localStorage.setItem('ripcon-theme', 'light'))
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/login-light.png` })
  console.log('shot: login-light')
  await ctx.close()
}

// Búsqueda global abierta (Ctrl+K)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await mockApis(page)
  await page.addInitScript(() => {
    localStorage.setItem('ripcon-dev-preview', '1')
    localStorage.setItem('ripcon-theme', 'light')
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/cmdk-light.png` })
  console.log('shot: cmdk-light')
  await ctx.close()
}

await browser.close()
console.log('LISTO →', OUT)
