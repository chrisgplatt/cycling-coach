'use client'
import { useState } from 'react'
import type { BikeKind } from '@/types'
import GearSheet from '@/components/gear/GearSheet'
import { Field, fieldClass, primaryBtn, errMsg } from '@/components/gear/fields'

const KINDS: Array<{ value: BikeKind; label: string }> = [
  { value: 'road', label: 'Road' },
  { value: 'gravel', label: 'Gravel' },
  { value: 'mtb', label: 'Mountain' },
  { value: 'trainer', label: 'Trainer (indoor)' },
  { value: 'other', label: 'Other' },
]

interface Props {
  title: string
  initial?: { name: string; kind: BikeKind }
  onSave: (v: { name: string; kind: BikeKind }) => Promise<void>
  onClose: () => void
}

export default function BikeSheet({ title, initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<BikeKind>(initial?.kind ?? 'road')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true); setError(null)
    try { await onSave({ name: name.trim(), kind }); onClose() }
    catch (e) { setError(errMsg(e)) }
    finally { setSaving(false) }
  }

  return (
    <GearSheet title={title} onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tarmac SL7" maxLength={60} className={fieldClass} autoFocus />
      </Field>
      <Field label="Type">
        <select value={kind} onChange={e => setKind(e.target.value as BikeKind)} className={fieldClass}>
          {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={submit} disabled={saving || name.trim() === ''} className={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
    </GearSheet>
  )
}
