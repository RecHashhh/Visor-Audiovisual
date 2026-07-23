// src/pages/SectionsPage.jsx
// Panel de administración del menú: crear, editar, reordenar y quitar secciones.
// Requiere la capacidad manageAccess (mismo perfil que la página Accesos).
//
// Quitar una sección la saca del menú pero NO borra sus archivos: siguen en
// _media/<id>/ y reaparecen si se vuelve a crear con el mismo id. Por eso el
// id de una sección existente no se puede cambiar (sería perder el contenido).
import { useEffect, useMemo, useState } from 'react'
import { api } from '../utils/api'
import { useSections } from '../utils/sections'
import { ICON_CHOICES, SECTION_ICONS, sectionIcon } from '../config/sectionIcons'
import { PROTECTED_SECTION } from '../config/sections'
import Modal from '../components/Modal'

const KIND_LABEL = {
  projects: 'Obras',
  media: 'Biblioteca',
  links: 'Enlaces',
}
const KIND_HINT = {
  projects: 'Material audiovisual por obra, con código de proyecto y semanas. Es la única sección de este tipo.',
  media: 'Carpetas y archivos libres: documentos, fotos, videos, plantillas…',
  links: 'Solo enlaces con vista previa, sin archivos ni carpetas.',
}
const EDITABLE_KINDS = ['media', 'links']

// El id es a la vez el segmento de URL y la carpeta en el blob, así que se
// normaliza igual que en el backend (_slugify_section_id).
function slugify(raw) {
  return (raw || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
}

export default function SectionsPage() {
  const { sections, apply, refresh } = useSections()
  const [items, setItems] = useState(sections)
  const [origJson, setOrigJson] = useState(() => JSON.stringify(sections))
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null)

  // La lista viva del provider manda mientras no haya cambios sin guardar.
  useEffect(() => {
    setItems(sections)
    setOrigJson(JSON.stringify(sections))
  }, [sections])

  const dirty = useMemo(() => JSON.stringify(items) !== origJson, [items, origJson])
  const usedIds = useMemo(() => new Set(items.map(s => s.id)), [items])

  function patch(idx, changes) {
    setItems(list => list.map((s, i) => (i === idx ? { ...s, ...changes } : s)))
    setSaveMsg(null)
  }
  function move(idx, delta) {
    const target = idx + delta
    if (target < 0 || target >= items.length) return
    setItems(list => {
      const next = [...list]
      const tmp = next[idx]
      next[idx] = next[target]
      next[target] = tmp
      return next
    })
    setSaveMsg(null)
  }
  function remove(idx) {
    setItems(list => list.filter((_, i) => i !== idx))
    setConfirmRemove(null)
    setSaveMsg(null)
  }

  async function save() {
    setSaving(true); setSaveMsg(null)
    try {
      const payload = items.map(({ id, label, kind, icon, description }) => ({ id, label, kind, icon, description }))
      const res = await api.saveSections(payload)
      const saved = res?.sections || payload
      apply(saved)
      setOrigJson(JSON.stringify(saved))
      setSaveMsg({ ok: true, text: 'Menú actualizado' })
    } catch (e) {
      setSaveMsg({ ok: false, text: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Secciones</h1>
        <p className="page-sub">
          Define qué aparece en el menú lateral y en qué orden. Quitar una sección solo la oculta:
          sus archivos siguen guardados y vuelven si la creas otra vez con el mismo identificador.
        </p>
      </div>

      <section className="access-card">
        <div className="access-card-head">
          <div>
            <div className="access-card-title">Menú del hub ({items.length})</div>
            <p className="access-card-desc">
              El identificador es la dirección de la sección y su carpeta en el almacenamiento, por eso
              no se puede cambiar una vez creada.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>Agregar sección</button>
        </div>

        <div className="seclist">
          {items.map((s, idx) => (
            <SectionRow
              key={s.id}
              section={s}
              index={idx}
              total={items.length}
              onPatch={changes => patch(idx, changes)}
              onMove={delta => move(idx, delta)}
              onRemove={() => setConfirmRemove({ idx, section: s })}
            />
          ))}
        </div>
      </section>

      {(dirty || saveMsg) && (
        <div className="access-savebar">
          {saveMsg && <span className={`access-savemsg ${saveMsg.ok ? 'ok' : 'error'}`}>{saveMsg.text}</span>}
          {dirty && (
            <>
              <button className="btn btn-ghost" disabled={saving}
                onClick={() => { setItems(JSON.parse(origJson)); setSaveMsg(null); refresh() }}>Descartar</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </>
          )}
        </div>
      )}

      <CreateSectionModal
        open={createOpen}
        usedIds={usedIds}
        onCancel={() => setCreateOpen(false)}
        onCreate={(section) => { setItems(list => [...list, section]); setCreateOpen(false); setSaveMsg(null) }}
      />

      <Modal
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
        title={confirmRemove ? `Quitar “${confirmRemove.section.label}”` : ''}
        subtitle="Se oculta del menú, no se borra nada"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setConfirmRemove(null)}>Cancelar</button>
          <button className="btn btn-danger" onClick={() => remove(confirmRemove.idx)}>Quitar del menú</button>
        </>}
      >
        {confirmRemove && (
          <p className="field-help">
            Desaparece del menú para todo el mundo. Los archivos que ya tenga <strong>no se borran</strong>:
            se quedan guardados y vuelven a verse si creas otra vez la sección con el identificador{' '}
            <code>{confirmRemove.section.id}</code>.
          </p>
        )}
      </Modal>
    </>
  )
}

function SectionRow({ section: s, index, total, onPatch, onMove, onRemove }) {
  const [open, setOpen] = useState(false)
  const locked = s.id === PROTECTED_SECTION

  return (
    <div className={`secrow ${open ? 'is-open' : ''}`}>
      <div className="secrow-head">
        <div className="secrow-order">
          <button className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0}
            aria-label={`Subir ${s.label}`} title="Subir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 14l6-6 6 6" />
            </svg>
          </button>
          <button className="icon-btn" onClick={() => onMove(1)} disabled={index === total - 1}
            aria-label={`Bajar ${s.label}`} title="Bajar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 10l6 6 6-6" />
            </svg>
          </button>
        </div>

        <span className="secrow-icon" aria-hidden="true">{sectionIcon(s)}</span>

        <button type="button" className="secrow-id" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className="secrow-label">{s.label}</span>
          <span className="secrow-meta">/{s.id} · {KIND_LABEL[s.kind] || s.kind}</span>
        </button>

        {locked
          ? <span className="badge" title="La sección de obras no se puede quitar ni cambiar de tipo">Fija</span>
          : (
            <button className="icon-btn icon-btn-danger" onClick={onRemove}
              aria-label={`Quitar ${s.label}`} title="Quitar del menú">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12M10 11v5M14 11v5" />
              </svg>
            </button>
          )}
      </div>

      {open && (
        <div className="secrow-body">
          <label className="field">
            <span className="field-label">Nombre visible</span>
            <input className="field-input" value={s.label} maxLength={48}
              onChange={e => onPatch({ label: e.target.value })} />
          </label>

          <label className="field">
            <span className="field-label">Descripción</span>
            <textarea className="field-input" rows={2} value={s.description || ''} maxLength={400}
              placeholder="Se muestra en la portada, bajo el nombre de la sección."
              onChange={e => onPatch({ description: e.target.value })} />
          </label>

          <div className="field">
            <span className="field-label">Tipo de contenido</span>
            {locked ? (
              <span className="field-help">{KIND_HINT.projects}</span>
            ) : (
              <>
                <div className="segmented">
                  {EDITABLE_KINDS.map(k => (
                    <button key={k} type="button" className={`segmented-btn ${s.kind === k ? 'active' : ''}`}
                      onClick={() => onPatch({ kind: k })}>{KIND_LABEL[k]}</button>
                  ))}
                </div>
                <span className="field-help">{KIND_HINT[s.kind]}</span>
              </>
            )}
          </div>

          <div className="field">
            <span className="field-label">Icono</span>
            <IconPicker value={s.icon} onChange={icon => onPatch({ icon })} />
          </div>
        </div>
      )}
    </div>
  )
}

function IconPicker({ value, onChange }) {
  return (
    <div className="iconpick">
      {ICON_CHOICES.map(key => (
        <button key={key} type="button" title={key}
          className={`iconpick-btn ${value === key ? 'active' : ''}`}
          onClick={() => onChange(key)} aria-label={`Icono ${key}`} aria-pressed={value === key}>
          {SECTION_ICONS[key]}
        </button>
      ))}
    </div>
  )
}

function CreateSectionModal({ open, usedIds, onCancel, onCreate }) {
  const [label, setLabel] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [kind, setKind] = useState('media')
  const [icon, setIcon] = useState('carpeta')
  const [description, setDescription] = useState('')

  // Reinicia el formulario cada vez que se abre.
  useEffect(() => {
    if (!open) return
    setLabel(''); setId(''); setIdTouched(false)
    setKind('media'); setIcon('carpeta'); setDescription('')
  }, [open])

  // El id se propone a partir del nombre hasta que alguien lo edita a mano.
  const finalId = idTouched ? slugify(id) : slugify(label)
  const duplicate = Boolean(finalId) && usedIds.has(finalId)
  const valid = Boolean(label.trim()) && Boolean(finalId) && !duplicate

  return (
    <Modal open={open} onClose={onCancel} title="Nueva sección"
      subtitle="Aparecerá en el menú lateral de quienes tengan acceso"
      footer={<>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" disabled={!valid}
          onClick={() => onCreate({ id: finalId, label: label.trim(), kind, icon, description: description.trim() })}>
          Agregar al menú
        </button>
      </>}
    >
      <label className="field">
        <span className="field-label">Nombre visible</span>
        <input className="field-input" autoFocus value={label} maxLength={48}
          placeholder="p. ej. Manuales de seguridad"
          onChange={e => setLabel(e.target.value)} />
      </label>

      <label className="field">
        <span className="field-label">Identificador</span>
        <input className="field-input" value={finalId} maxLength={32}
          onChange={e => { setIdTouched(true); setId(e.target.value) }} />
        {duplicate
          ? <span className="field-error">Ya existe una sección con ese identificador.</span>
          : <span className="field-help">Dirección de la sección: <code>/{finalId || '…'}</code>. No se podrá cambiar después.</span>}
      </label>

      <div className="field">
        <span className="field-label">Tipo de contenido</span>
        <div className="segmented">
          {EDITABLE_KINDS.map(k => (
            <button key={k} type="button" className={`segmented-btn ${kind === k ? 'active' : ''}`}
              onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <span className="field-help">{KIND_HINT[kind]}</span>
      </div>

      <label className="field">
        <span className="field-label">Descripción</span>
        <textarea className="field-input" rows={2} value={description} maxLength={400}
          placeholder="Se muestra en la portada, bajo el nombre de la sección."
          onChange={e => setDescription(e.target.value)} />
      </label>

      <div className="field">
        <span className="field-label">Icono</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
    </Modal>
  )
}
