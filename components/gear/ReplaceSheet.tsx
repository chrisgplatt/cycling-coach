'use client'
import { useState } from 'react'
import GearSheet from '@/components/gear/GearSheet'
import { Field, fieldClass, dateClass, primaryBtn, errMsg, localToday } from '@/components/gear/fields'

interface Props {
  componentName: string
  onConfirm: (v: { name: string; installed_at?: string }) => Promise<void>
  onClose: () => void
}

export default function ReplaceSheet({ componentName, onConfirm, onClose }: Props) {
  const today = localToday()
  const [name, setName] = useState(componentName)
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true); setError(null)
    try { await onConfirm({ name: name.trim(), ...(date !== today ? { installed_at: date } : {}) }); onClose() }
    catch (e) { setError(errMsg(e)) }
    finally { setSaving(false) }
  }

  return (
    <GearSheet title={`Replace ${componentName}`} onClose={onClose}>
      <p className="text-sm text-slate-500">The current one is retired and a fresh one starts at zero, keeping the same reminders.</p>
      <Field label="Name">
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60} className={fieldClass} />
      </Field>
      <Field label="Fitted on">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={dateClass} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={submit} disabled={saving || name.trim() === '' || !date} className={primaryBtn}>
        {saving ? 'Replacing…' : 'Replace component'}
      </button>
    </GearSheet>
  )
}
