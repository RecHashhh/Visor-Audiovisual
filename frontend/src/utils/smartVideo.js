// src/utils/smartVideo.js
// Reproduce MP4/MOV con el índice (moov) al FINAL sin tener que reprocesar el
// archivo: usa mp4box.js + Media Source Extensions para pedir el moov por un
// rango pequeño y luego ir bajando el video por trozos a medida que se ve.
// Así arranca rápido aunque pese varios GB. Si algo falla, el visor cae al
// <video> nativo (mismo comportamiento de antes) — nunca queda peor.

// ── Detección barata: ¿el archivo tiene el índice al final (necesita ayuda)? ──
// Lee solo los primeros 64 KB por un Range y mira si aparece 'mdat' antes que
// 'moov'. Si el servidor ignora el Range (200 en vez de 206), no arriesgamos.
export async function needsFaststart(url) {
  let res
  try {
    res = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
  } catch { return false }
  if (res.status !== 206) { try { res.body?.cancel?.() } catch {} ; return false }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length < 8) return false
  const dv = new DataView(buf.buffer)
  const boxType = (p) => String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7])
  let pos = 0
  while (pos + 8 <= buf.length) {
    let size = dv.getUint32(pos)
    const type = boxType(pos)
    if (type === 'moov') return false   // ya está al frente → nativo es rápido
    if (type === 'mdat') return true    // datos antes que el índice → necesita ayuda
    if (size === 1) {
      const hi = dv.getUint32(pos + 8)
      const lo = dv.getUint32(pos + 12)
      size = hi * 4294967296 + lo
    } else if (size === 0) {
      return true
    }
    if (size < 8) break
    pos += size
  }
  return false
}

// ── Reproductor MSE. Devuelve una función de limpieza (cleanup). ──
export function playWithMse(video, url, { onUnsupported, onError } = {}) {
  let destroyed = false
  let mediaSource = null
  let objectUrl = null
  let mp4box = null
  const buffers = {}          // trackId -> { sb, queue:[], done:false }
  let nextPos = 0             // próximo byte a pedir (lo dirige mp4box)
  let fileSize = Infinity     // se fija al leer un trozo corto (EOF)
  let fetching = false
  let ready = false
  let fileRead = false
  let failed = false

  const CHUNK = 1024 * 1024        // 1 MB por petición
  const BUFFER_AHEAD = 30          // segundos de video por delante antes de pausar la descarga

  function fail(unsupported) {
    if (destroyed || failed) return
    failed = true
    if (unsupported) onUnsupported?.()
    else onError?.()
  }

  async function fetchRange(start, end) {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
    if (res.status !== 206 && res.status !== 200) throw new Error('range ' + res.status)
    const ab = await res.arrayBuffer()
    return ab
  }

  function bufferedAhead() {
    try {
      const ct = video.currentTime
      const b = video.buffered
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= ct + 0.25 && ct <= b.end(i) + 0.25) return b.end(i) - ct
      }
    } catch {}
    return 0
  }

  function pump(b) {
    if (destroyed || !b || b.sb.updating || b.queue.length === 0) return
    const chunk = b.queue[0]
    try {
      b.sb.appendBuffer(chunk)
      b.queue.shift()
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        evict(b)   // libera lo ya visto; reintenta en 'updateend'/timeupdate
      } else {
        fail(false)
      }
    }
  }

  function evict(b) {
    try {
      const ct = video.currentTime
      const end = Math.max(0, ct - 10)
      if (end > 0 && !b.sb.updating) b.sb.remove(0, end)
    } catch {}
  }

  function maybeEndOfStream() {
    if (destroyed || !mediaSource || mediaSource.readyState !== 'open') return
    const bs = Object.values(buffers)
    if (!bs.length) return
    const allDrained = bs.every(b => b.done && b.queue.length === 0 && !b.sb.updating)
    if (fileRead && allDrained) {
      try { mediaSource.endOfStream() } catch {}
    }
  }

  async function fetchLoop() {
    if (fetching || destroyed || failed) return
    fetching = true
    try {
      while (!destroyed && !failed && nextPos != null && nextPos < fileSize) {
        if (ready && bufferedAhead() > BUFFER_AHEAD) break  // ya hay suficiente por delante
        const end = Math.min(nextPos + CHUNK - 1, fileSize - 1)
        const ab = await fetchRange(nextPos, end)
        if (destroyed || failed) return
        if (ab.byteLength < end - nextPos + 1) fileSize = nextPos + ab.byteLength  // llegamos al final
        ab.fileStart = nextPos
        const next = mp4box.appendBuffer(ab)
        if (ab.byteLength === 0) break
        nextPos = next
      }
      if (!destroyed && !failed && (nextPos == null || nextPos >= fileSize)) {
        fileRead = true
        try { mp4box.flush() } catch {}
        maybeEndOfStream()
      }
    } catch {
      fail(false)
    } finally {
      fetching = false
    }
  }

  function setup(MP4Box) {
    mediaSource = new MediaSource()
    objectUrl = URL.createObjectURL(mediaSource)
    video.src = objectUrl
    mediaSource.addEventListener('sourceopen', () => {
      if (destroyed) return
      mp4box = MP4Box.createFile()
      mp4box.onError = () => fail(false)

      mp4box.onReady = (info) => {
        if (destroyed) return
        try {
          const dur = info.isFragmented ? info.fragment_duration : info.duration
          if (dur && info.timescale) mediaSource.duration = dur / info.timescale
        } catch {}

        let anySupported = false
        info.tracks.forEach((track) => {
          const type = track.video ? 'video' : (track.audio ? 'audio' : null)
          if (!type) return
          const mime = `${type}/mp4; codecs="${track.codec}"`
          if (!('MediaSource' in window) || !MediaSource.isTypeSupported(mime)) return
          let sb
          try { sb = mediaSource.addSourceBuffer(mime) } catch { return }
          const b = { sb, queue: [], done: false }
          buffers[track.id] = b
          sb.addEventListener('updateend', () => {
            pump(b)
            maybeEndOfStream()
            if (!fetching && ready) fetchLoop()
          })
          mp4box.setSegmentOptions(track.id, sb, { nbSamples: 200 })
          anySupported = true
        })

        if (!anySupported) { fail(true); return }   // p. ej. HEVC: nativo tampoco puede

        const initSegs = mp4box.initializeSegmentation()
        initSegs.forEach((seg) => { buffers[seg.id]?.queue.push(seg.buffer) })
        Object.values(buffers).forEach(pump)
        ready = true
        mp4box.start()
      }

      mp4box.onSegment = (id, user, buffer, sampleNum, isLast) => {
        const b = buffers[id]
        if (!b) return
        b.queue.push(buffer)
        if (isLast) b.done = true
        pump(b)
        maybeEndOfStream()
      }

      fetchLoop()
    }, { once: true })

    // Al buscar (seek), preguntamos a mp4box desde qué byte seguir.
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('timeupdate', onTimeUpdate)

    // Watchdog: si en 15 s no hay datos reproducibles, caemos al nativo.
    setTimeout(() => {
      if (!destroyed && !failed && video.readyState < 2) fail(false)
    }, 15000)
  }

  function onSeeking() {
    if (!ready || destroyed || failed) return
    try {
      const info = mp4box.seek(video.currentTime, true)
      nextPos = info.offset
      fetchLoop()
    } catch {}
  }
  function onTimeUpdate() {
    if (!destroyed && !failed && ready && !fetching) fetchLoop()
  }

  // Carga mp4box de forma diferida (chunk aparte) y arranca.
  import('mp4box')
    .then((mod) => {
      const MP4Box = (mod.default && mod.default.createFile) ? mod.default : mod
      if (destroyed) return
      if (!MP4Box || typeof MP4Box.createFile !== 'function') { fail(false); return }
      setup(MP4Box)
    })
    .catch(() => fail(false))

  return function cleanup() {
    destroyed = true
    try { video.removeEventListener('seeking', onSeeking) } catch {}
    try { video.removeEventListener('timeupdate', onTimeUpdate) } catch {}
    try { if (mp4box) mp4box.stop?.() } catch {}
    try { if (mediaSource && mediaSource.readyState === 'open') mediaSource.endOfStream() } catch {}
    try { if (objectUrl) URL.revokeObjectURL(objectUrl) } catch {}
    try { video.removeAttribute('src'); video.load() } catch {}
  }
}
