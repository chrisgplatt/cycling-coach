'use client'
import { useState } from 'react'
import { Field, dateClass, primaryBtn, secondaryBtn, errMsg } from '@/components/gear/fields'

interface Props {
  bikeName: string
  count: number
  onConfirm: (from?: string) => Promise<void>
  onSkip: () => void
}

export default function BackfillPrompt({ bikeName, count, onConfirm, onSkip }: Props) {
  const [from, setFrom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setSaving(true); setError(null)
    try { await onConfirm(from || undefined) }
    catch (e) { setError(errMsg(e)); setSaving(false) }
  }

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-slate-900">
        Assign your {count} existing {count === 1 ? 'ride' : 'rides'} to {bikeName}?
      </p>
      <p className="text-xs text-slate-500">Indoor rides go to your trainer bike if you have one. You can change any ride later.</p>
      <Field label="Only rides from (optional)">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={dateClass} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={confirm} disabled={saving} className={`${primaryBtn} flex-1`}>{saving ? 'Assigning…' : 'Assign rides'}</button>
        <button onClick={onSkip} disabled={saving} className={secondaryBtn}>Skip</button>
      </div>
    </div>
  )
}
