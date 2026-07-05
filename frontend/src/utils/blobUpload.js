// src/utils/blobUpload.js
// Subida directa navegador → Azure Blob con SAS de escritura.
// Archivos chicos: un solo PUT. Grandes: bloques de 32 MB (Put Block +
// Put Block List) con reintentos por bloque — así un corte de red no tira
// una subida de varias GB, y el servidor nunca toca los bytes.

const BLOCK_SIZE = 32 * 1024 * 1024
const SINGLE_PUT_MAX = 128 * 1024 * 1024
const BLOCK_RETRIES = 3

function xhrPut(url, body, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    if (onProgress) {
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded) }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`HTTP ${xhr.status} al subir al blob`))
    }
    xhr.onerror = () => reject(new Error('Error de red durante la subida'))
    xhr.onabort = () => reject(new Error('Subida cancelada'))
    xhr.send(body)
  })
}

async function withRetries(fn, label) {
  let lastErr
  for (let attempt = 1; attempt <= BLOCK_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (attempt < BLOCK_RETRIES) {
        await new Promise(r => setTimeout(r, 1500 * attempt))
      }
    }
  }
  throw new Error(`${label}: ${lastErr?.message || lastErr}`)
}

async function putSingle(sasUrl, file, contentType, onProgress) {
  await withRetries(
    () => xhrPut(sasUrl, file, {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': contentType || 'application/octet-stream',
    }, onProgress),
    'Subida directa'
  )
}

async function putBlocks(sasUrl, file, contentType, onProgress) {
  const totalBlocks = Math.ceil(file.size / BLOCK_SIZE)
  const blockIds = []

  for (let i = 0; i < totalBlocks; i++) {
    const start = i * BLOCK_SIZE
    const chunk = file.slice(start, Math.min(start + BLOCK_SIZE, file.size))
    const blockId = btoa(`block-${String(i).padStart(6, '0')}`)
    blockIds.push(blockId)
    const url = `${sasUrl}&comp=block&blockid=${encodeURIComponent(blockId)}`
    await withRetries(
      () => xhrPut(url, chunk, {}, onProgress
        ? loaded => onProgress(start + Math.min(loaded, chunk.size))
        : null),
      `Bloque ${i + 1}/${totalBlocks}`
    )
    if (onProgress) onProgress(start + chunk.size)
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${
    blockIds.map(id => `<Latest>${id}</Latest>`).join('')
  }</BlockList>`
  await withRetries(
    () => xhrPut(`${sasUrl}&comp=blocklist`, xml, {
      'Content-Type': 'application/xml',
      'x-ms-blob-content-type': contentType || 'application/octet-stream',
    }),
    'Confirmación de bloques'
  )
}

export async function uploadFileToBlob(sasUrl, file, contentType, onProgress) {
  if (file.size <= SINGLE_PUT_MAX) {
    return putSingle(sasUrl, file, contentType, onProgress)
  }
  return putBlocks(sasUrl, file, contentType, onProgress)
}
