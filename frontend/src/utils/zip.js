// src/utils/zip.js
// Empaqueta varios archivos en un ZIP dentro del navegador: baja cada uno por su
// URL (SAS) y los junta. Usa "store" (sin comprimir) porque las fotos/videos ya
// vienen comprimidos: así es rápido y no recalienta el CPU.
// fflate se carga de forma diferida (chunk aparte) solo al pedir un ZIP.

// Evita nombres repetidos dentro del ZIP: "foto.jpg", "foto (2).jpg", ...
function uniqueName(name, used) {
  if (!used[name]) { used[name] = 1; return name }
  const n = ++used[name]
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
}

// files: [{ name, url }]  ·  onProgress(hechos, total, faseTexto)
export async function buildZip(files, onProgress) {
  const { zip } = await import('fflate')
  const entries = {}
  const used = {}
  let done = 0
  for (const f of files) {
    let buf
    try {
      const res = await fetch(f.url)
      if (!res.ok) throw new Error(String(res.status))
      buf = new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      throw new Error(`No se pudo bajar "${f.name}" (${e.message})`)
    }
    entries[uniqueName(f.name, used)] = [buf, { level: 0 }]  // level 0 = almacenar
    done += 1
    onProgress?.(done, files.length, 'descargando')
  }
  onProgress?.(files.length, files.length, 'comprimiendo')
  const data = await new Promise((resolve, reject) => {
    zip(entries, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)))
  })
  return new Blob([data], { type: 'application/zip' })
}
