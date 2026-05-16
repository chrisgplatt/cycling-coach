'use client'
import { useState } from 'react'
import type { TrainingEvent } from '@/types'

interface Props {
  initialEvent?: Omit<TrainingEvent, '_key'>
  onConfirm: (event: Omit<TrainingEvent, '_key'>) => Promise<void>
  onClose: () => void
}

const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

export default function AddEventModal({ initialEvent, onConfirm, onClose }: Props) {
  const [name, setName] = useState(initialEvent?.name ?? '')
  const [date, setDate] = useState(initialEvent?.date ?? '')
  const [type, setType] = useState<TrainingEvent['type']>(initialEvent?.type ?? 'sportive')
  const [priority, setPriority] = useState<TrainingEvent['priority']>(initialEvent?.priority ?? 'B')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!initialEvent
  const valid = name.trim() !== '' && date !== ''

  async function handleConfirm() {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm({ name: name.trim(), date, type, priority })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save event')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-900">{isEditing ? 'Edit event' : 'Add event'}</h2>

        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Event name"
            className={inputClass}
            autoFocus
          />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={inputClass}
          />
          <select value={type} onChange={e => setType(e.target.value as TrainingEvent['type'])} className={inputClass}>
            <option value="sportive">Sportive</option>
            <option value="race">Race</option>
            <option value="holiday">Holiday riding</option>
            <option value="fitness">Fitness</option>
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value as TrainingEvent['priority'])} className={inputClass}>
            <option value="A">A — Peak for this</option>
            <option value="B">B — Important</option>
            <option value="C">C — Secondary</option>
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!valid || saving}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add event'}
          </button>
        </div>
      </div>
    </div>
  )
}
