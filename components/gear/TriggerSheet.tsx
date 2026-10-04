'use client'
import { useState } from 'react'
import type { TriggerKind, TriggerMetric } from '@/types'
import GearSheet from '@/components/gear/GearSheet'
import { Field, fieldClass, primaryBtn, errMsg } from '@/components/gear/fields'

export interface TriggerValues { label: string; kind: TriggerKind; metric: TriggerMetric; interval_value: number }

interface Props {
  title: string
  initial?: TriggerValues
  onSave: (v: TriggerValues) => Promise<void>
  onClose: () => void
}

export default function TriggerSheet({ title, initial, onSave, onClose }: Props) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState<TriggerKind>(initial?.kind ?? 'recurring')
  const [metric, setMetric] = useState<TriggerMetric>(initial?.metric ?? 'km')
  const [interval, setIntervalValue] = useState(initial ? String(initial.interval_value) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = !!initial

  async function submit() {
    setSaving(true); setError(null)
    try { await onSave({ label: label.trim(), kind, metric, interval_value: Number(interval) }); onClose() }
    catch (e) { setError(errMsg(e)) }
    finally { setSaving(false) }
  }

  return (
    <GearSheet title={title} onClose={onClose}>
      <Field label="Label">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Re-wax" maxLength={60} className={fieldClass} autoFocus />
      </Field>
      <Field label="Behaviour">
        <select value={kind} disabled={editing} onChange={e => setKind(e.target.value as TriggerKind)} className={fieldClass}>
          <option value="recurring">Recurring — resets when marked done</option>
          <option value="lifetime">Lifetime limit — counts from install</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Every / at">
          <input type="number" inputMode="decimal" min="0" value={interval} onChange={e => setIntervalValue(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Unit">
          <select value={metric} onChange={e => setMetric(e.target.value as TriggerMetric)} className={fieldClass}>
            <option value="km">km</option>
            <option value="hours">hours</option>
          </select>
        </Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={submit} disabled={saving || label.trim() === '' || !(Number(interval) > 0)} className={primaryBtn}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </GearSheet>
  )
}
