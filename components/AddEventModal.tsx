'use client'
import { useState } from 'react'
import type { TrainingEvent, EventRPE } from '@/types'

interface Props {
  initialEvent?: Omit<TrainingEvent, '_key'>
  onConfirm: (event: Omit<TrainingEvent, '_key'>) => Promise<void>
  onClose: () => void
  hasPlan?: boolean
  onRegenerate?: (note: string) => void
}

const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

export default function AddEventModal({ initialEvent, onConfirm, onClose, hasPlan, onRegenerate }: Props) {
  const [name, setName] = useState(initialEvent?.name ?? '')
  const [date, setDate] = useState(initialEvent?.date ?? '')
  const [type, setType] = useState<TrainingEvent['type']>(initialEvent?.type ?? 'sportive')
  const [priority, setPriority] = useState<TrainingEvent['priority']>(initialEvent?.priority ?? 'B')
  const [startTime, setStartTime] = useState(initialEvent?.start_time ?? '')
  const [rpe, setRpe] = useState<EventRPE | ''>(initialEvent?.rpe ?? '')
  const [duration, setDuration] = useState(initialEvent?.duration_minutes?.toString() ?? '')
  const [distance, setDistance] = useState(initialEvent?.distance_km?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'saved'>('form')

  const isEditing = !!initialEvent
  const valid = name.trim() !== '' && date !== ''

  async function handleConfirm() {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm({
        name: name.trim(),
        date,
        type,
        priority,
        ...(startTime ? { start_time: startTime } : {}),
        ...(rpe ? { rpe } : {}),
        ...(duration ? { duration_minutes: Number(duration) } : {}),
        ...(distance ? { distance_km: Number(distance) } : {}),
      })
      if (hasPlan && onRegenerate) {
        setPhase('saved')
      } else {
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save event')
    } finally {
      setSaving(false)
    }
  }

  function handleRegenerate() {
    const verb = isEditing ? 'updated' : 'added'
    onRegenerate!(`Just ${verb} "${name.trim()}" on ${date} — please revise the plan to account for this event.`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm max-h-[92vh] overflow-y-auto p-5 space-y-4">
        {phase === 'saved' ? (
          <>
            <div className="space-y-1">
              <p className="text-base font-semibold text-slate-900">Event saved.</p>
              <p className="text-sm text-slate-500">Your active plan may need updating to account for this event.</p>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Not now
              </button>
              <button
                onClick={handleRegenerate}
                className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                Regenerate plan
              </button>
            </div>
          </>
        ) : (
          <>
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

              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide pt-1">Optional details</p>

              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Start time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Duration (min)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={e => setDuration(e.target.value)}
                    min={1}
                    placeholder="e.g. 120"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Distance (km)</label>
                  <input
                    type="number"
                    value={distance}
                    onChange={e => setDistance(e.target.value)}
                    min={0.1}
                    step={0.1}
                    placeholder="e.g. 80"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Expected effort</label>
                  <select value={rpe} onChange={e => setRpe(e.target.value as EventRPE | '')} className={inputClass}>
                    <option value="">Not set</option>
                    <option value="race_pace">Race pace</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
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
          </>
        )}
      </div>
    </div>
  )
}
