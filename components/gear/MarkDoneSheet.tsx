'use client'
import { useState } from 'react'
import GearSheet from '@/components/gear/GearSheet'
import { Field, dateClass, primaryBtn, errMsg, localToday } from '@/components/gear/fields'

interface Props {
  label: string
  onConfirm: (date?: string) => Promise<void>
  onClose: () => void
}

export default function MarkDoneSheet({ label, onConfirm, onClose }: Props) {
  const today = localToday()
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true); setError(null)
    try { await onConfirm(date !== today ? date : undefined); onClose() }
    catch (e) { setError(errMsg(e)) }
    finally { setSaving(false) }
  }

  return (
    <GearSheet title={`${label} done`} onClose={onClose}>
      <p className="text-sm text-slate-500">The count for this reminder restarts from the date below.</p>
      <Field label="Date">
        <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className={dateClass} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={submit} disabled={saving || !date} className={primaryBtn}>{saving ? 'Saving…' : 'Confirm'}</button>
    </GearSheet>
  )
}
