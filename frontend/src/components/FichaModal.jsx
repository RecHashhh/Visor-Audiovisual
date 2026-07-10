// src/components/FichaModal.jsx
// Ficha opcional de una carpeta: nombre a mostrar, descripción, colores y
// —solo en Marcas— arquetipo. Se guarda como meta.json dentro de la carpeta.
import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api } from '../utils/api'

const HEX_RE = /^#?[0-9a-fA-F]{3,8}$/

function normalizeColors(colors) {
  if (!Array.isArray(colors)) return []
  return colors.map(c => ({ hex: c?.hex || '', name: c?.name || '', role: c?.role || '' }))
}

export default function FichaModal({ open, onClose, sectionId, folderPath, folderName, initial, onSaved }) {
  const isMarcas = sectionId === 'marcas'
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [description, setDescription] = useState('')
  const [colors, setColors] = useState([])
  const [archName, setArchName] = useState('')
  const [archSummary, setArchSummary] = useState('')
  const [archDesc, setArchDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!open) return
    const m = initial || {}
    setName(m.name || '')
    setTagline(m.tagline || '')
    setDescription(m.description || '')
    setColors(normalizeColors(m.colors))
    setArchName(m.archetype?.name || '')
    setArchSummary(m.archetype?.summary || '')
    setArchDesc(m.archetype?.description || '')
    setErr(null); setBusy(false)
  }, [open, initial])

  function addColor() { setColors(prev => [...prev, { hex: '#1E3FAA', name: '', role: '' }]) }
  function setColor(i, patch) { setColors(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c)) }
  function removeColor(i) { setColors(prev => prev.filter((_, idx) => idx !== i)) }

  async function save() {
    setBusy(true); setErr(null)
    const cleanColors = colors
      .map(c => ({ hex: (c.hex || '').trim(), name: (c.name || '').trim(), role: (c.role || '').trim() }))
      .filter(c => c.hex && HEX_RE.test(c.hex))
      .map(c => ({ ...c, hex: c.hex.startsWith('#') ? c.hex.toUpperCase() : `#${c.hex.toUpperCase()}` }))
    const meta = {
      name: name.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      colors: cleanColors,
    }
    if (isMarcas && (archName.trim() || archSummary.trim() || archDesc.trim())) {
      meta.archetype = { name: archName.trim(), summary: archSummary.trim(), description: archDesc.trim() }
    }
    try {
      const res = await api.saveMediaMeta(sectionId, folderPath, meta)
      onClose()
      onSaved?.(res?.meta || meta)
    } catch (e) {
      setErr(`No se pudo guardar: ${e.message}`)
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} wide
      title="Ficha de la carpeta" subtitle={`“${folderName}” · ${isMarcas ? 'marca' : 'carpeta'}`}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Guardando...' : 'Guardar ficha'}</button>
      </>}
    >
      <label className="field">
        <span className="field-label">Nombre a mostrar <span className="field-opt">(opcional)</span></span>
        <input className="field-input" value={name} placeholder={folderName}
          onChange={e => setName(e.target.value)} />
        <span className="field-help">Si lo dejas vacío, se usa el nombre de la carpeta.</span>
      </label>

      <label className="field">
        <span className="field-label">Eslogan / línea corta <span className="field-opt">(opcional)</span></span>
        <input className="field-input" value={tagline} placeholder="p. ej. Construcción e ingeniería civil"
          onChange={e => setTagline(e.target.value)} />
      </label>

      <label className="field">
        <span className="field-label">Descripción <span className="field-opt">(opcional)</span></span>
        <textarea className="field-input" rows={3} value={description}
          placeholder="Texto libre sobre esta carpeta / marca."
          onChange={e => setDescription(e.target.value)} />
      </label>

      <div className="field">
        <span className="field-label">Colores <span className="field-opt">(opcional)</span></span>
        <div className="ficha-colors">
          {colors.map((c, i) => (
            <div key={i} className="ficha-color-row">
              <input type="color" className="ficha-color-swatch"
                value={HEX_RE.test(c.hex) ? (c.hex.startsWith('#') ? c.hex : `#${c.hex}`) : '#1E3FAA'}
                onChange={e => setColor(i, { hex: e.target.value })} />
              <input className="field-input ficha-color-hex" value={c.hex}
                placeholder="#1E3FAA" onChange={e => setColor(i, { hex: e.target.value })} />
              <input className="field-input" value={c.name}
                placeholder="Nombre (Ripconciv Blue)" onChange={e => setColor(i, { name: e.target.value })} />
              <input className="field-input" value={c.role}
                placeholder="Uso (Color primario)" onChange={e => setColor(i, { role: e.target.value })} />
              <button className="upload-item-x" onClick={() => removeColor(i)} aria-label="Quitar color">×</button>
            </div>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={addColor}>+ Agregar color</button>
      </div>

      {isMarcas && (
        <div className="field ficha-archetype">
          <span className="field-label">Arquetipo de marca <span className="field-opt">(solo Marcas, opcional)</span></span>
          <input className="field-input" value={archName} placeholder="Nombre (p. ej. El Creador)"
            onChange={e => setArchName(e.target.value)} style={{ marginBottom: 8 }} />
          <input className="field-input" value={archSummary} placeholder="Resumen en una línea"
            onChange={e => setArchSummary(e.target.value)} style={{ marginBottom: 8 }} />
          <textarea className="field-input" rows={2} value={archDesc} placeholder="Descripción del arquetipo"
            onChange={e => setArchDesc(e.target.value)} />
        </div>
      )}

      {err && <span className="field-error">{err}</span>}
    </Modal>
  )
}
