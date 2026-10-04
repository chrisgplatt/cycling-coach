'use client'
import { useState } from 'react'
import type { ComponentCategory } from '@/types'
import GearSheet from '@/components/gear/GearSheet'
import { Field, fieldClass, dateClass, primaryBtn, errMsg, localToday } from '@/components/gear/fields'
import { COMPONENT_CATEGORIES, triggerPresetsFor, type TriggerPreset } from '@/lib/gear/presets'

export interface ComponentPayload {
  name: string
  category: ComponentCategory
  installed_at?: string
  triggers: TriggerPreset[]
}

interface PresetRow extends TriggerPreset { enabled: boolean; interval: string }
const rowsFor = (c: ComponentCategory): PresetRow[] =>
  triggerPresetsFor(c).map(p => ({ ...p, enabled: true, interval: String(p.interval_value) }))

interface Props {
  onSave: (v: ComponentPayload) => Promise<void>
  onClose: () => void
}

export default function ComponentSheet({ onSave, onClose }: Props) {
  const today = localToday()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<ComponentCategory>('chain')
  const [installed, setInstalled] = useState(today)
  const [rows, setRows] = useState<PresetRow[]>(() => rowsFor('chain'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchRow = (i: number, p: Partial<PresetRow>) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const enabled = rows.filter(r => r.enabled)
  const valid = name.trim() !== '' && enabled.every(r => Number(r.interval) > 0)

  async function submit() {
    setSaving(true); setError(null)
    try {
      await onSave({
        name: name.trim(),
        category,
        // Only send a date the user actually chose; otherwise the server uses its own "today".
        ...(installed !== today ? { installed_at: installed } : {}),
        triggers: enabled.map(({ label, kind, metric, interval }) => ({ label, kind, metric, interval_value: Number(interval) })),
      })
      onClose()
    } catch (e) { setError(errMsg(e)) }
    finally { setSaving(false) }
  }

  return (
    <GearSheet title="Add component" onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. KMC X11 chain" maxLength={60} className={fieldClass} autoFocus />
      </Field>
      <Field label="Category">
        <select
          value={category}
          onChange={e => { const c = e.target.value as ComponentCategory; setCategory(c); setRows(rowsFor(c)) }}
          className={fieldClass}
        >
          {COMPONENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Fitted on">
        <input type="date" value={installed} onChange={e => setInstalled(e.target.value)} className={dateClass} />
      </Field>

      {rows.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Reminders</legend>
          {rows.map((r, i) => (
            <div key={r.label} className="flex items-center gap-3 min-h-[44px]">
              <label className="flex items-center gap-2 flex-1 min-w-0 text-sm text-slate-800">
                <input type="checkbox" checked={r.enabled} onChange={e => patchRow(i, { enabled: e.target.checked })} className="w-5 h-5" />
                <span className="truncate">{r.label}</span>
              </label>
              <span className="text-xs text-slate-400 shrink-0">{r.kind === 'lifetime' ? 'at' : 'every'}</span>
              <input
                type="number" inputMode="decimal" min="0" aria-label={`${r.label} interval`}
                value={r.interval} disabled={!r.enabled}
                onChange={e => patchRow(i, { interval: e.target.value })}
                className="w-20 text-sm border border-slate-200 rounded-xl px-2 py-2.5 text-right disabled:opacity-40"
              />
              <span className="text-xs text-slate-500 w-9 shrink-0">{r.metric}</span>
            </div>
          ))}
        </fieldset>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={submit} disabled={saving || !valid} className={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
    </GearSheet>
  )
}
