'use client'
import { useState } from 'react'
import type { TrainingEvent, EventRPE, RaceType } from '@/types'

interface Props {
  initialEvent?: Omit<TrainingEvent, '_key'>
  onConfirm: (event: Omit<TrainingEvent, '_key'>) => Promise<void>
  onClose: () => void
  hasPlan?: boolean
  onRegenerate?: (note: string) => void
}

const fieldClass = "w-full max-w-full min-w-0 block text-sm border border-slate-200 rounded-xl px-3 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
// date/time inputs on iOS ignore CSS width unless appearance-none is set
const dateTimeClass = `${fieldClass} appearance-none`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

export default function AddEventModal({ initialEvent, onConfirm, onClose, hasPlan, onRegenerate }: Props) {
  const [name, setName] = useState(initialEvent?.name ?? '')
  const [date, setDate] = useState(initialEvent?.date ?? '')
  const [type, setType] = useState<TrainingEvent['type']>(initialEvent?.type ?? 'sportive')
  const [priority, setPriority] = useState<TrainingEvent['priority']>(initialEvent?.priority ?? 'B')
  const [startTime, setStartTime] = useState(initialEvent?.start_time ?? '')
  const [rpe, setRpe] = useState<EventRPE | ''>(initialEvent?.rpe ?? '')
  const [duration, setDuration] = useState(initialEvent?.duration_minutes?.toString() ?? '')
  const [distance, setDistance] = useState(initialEvent?.distance_km?.toString() ?? '')
  const [raceType, setRaceType] = useState<RaceType | ''>(initialEvent?.race_type ?? '')
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
        ...(type === 'race' && raceType ? { race_type: raceType } : {}),
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm max-h-[92vh] flex flex-col overflow-hidden">

        {/* Drag handle (mobile only) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        <div className="overflow-y-auto overflow-x-hidden flex-1 px-5 pb-2 pt-3 space-y-5">
          {phase === 'saved' ? (
            <div className="space-y-1 py-2">
              <p className="text-base font-semibold text-slate-900">Event saved.</p>
              <p className="text-sm text-slate-500">Your active plan may need updating to account for this event.</p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-slate-900">{isEditing ? 'Edit event' : 'Add event'}</h2>

              {/* Required fields */}
              <div className="space-y-3">
                <Field label="Event name">
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Cheltenham Sportive"
                    className={fieldClass}
                    autoFocus
                  />
                </Field>

                <Field label="Date">
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className={dateTimeClass}
                  />
                </Field>

                <Field label="Type">
                  <select value={type} onChange={e => setType(e.target.value as TrainingEvent['type'])} className={fieldClass}>
                    <option value="sportive">Sportive</option>
                    <option value="race">Race</option>
                    <option value="holiday">Holiday riding</option>
                    <option value="fitness">Fitness test</option>
                  </select>
                </Field>

                <Field label="Priority">
                  <select value={priority} onChange={e => setPriority(e.target.value as TrainingEvent['priority'])} className={fieldClass}>
                    <option value="A">A — Peak for this</option>
                    <option value="B">B — Important</option>
                    <option value="C">C — Secondary</option>
                  </select>
                </Field>

                {type === 'race' && (
                  <Field label="Race type">
                    <select value={raceType} onChange={e => setRaceType(e.target.value as RaceType | '')} className={fieldClass}>
                      <option value="">Not specified</option>
                      <option value="road_race">Road Race</option>
                      <option value="criterium">Criterium</option>
                      <option value="time_trial">Time Trial</option>
                      <option value="cyclocross">Cyclocross</option>
                    </select>
                  </Field>
                )}
              </div>

              {/* Optional fields */}
              <div className="space-y-3 pt-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Optional details</p>

                <Field label="Start time">
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className={dateTimeClass}
                  />
                </Field>

                <Field label="Expected effort">
                  <select value={rpe} onChange={e => setRpe(e.target.value as EventRPE | '')} className={fieldClass}>
                    <option value="">Not set</option>
                    <option value="race_pace">Race pace</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </Field>

                <Field label="Estimated duration (minutes)">
                  <input
                    type="number"
                    value={duration}
                    onChange={e => setDuration(e.target.value)}
                    min={1}
                    placeholder="e.g. 120"
                    className={fieldClass}
                  />
                </Field>

                <Field label="Estimated distance (km)">
                  <input
                    type="number"
                    value={distance}
                    onChange={e => setDistance(e.target.value)}
                    min={0.1}
                    step={0.1}
                    placeholder="e.g. 80"
                    className={fieldClass}
                  />
                </Field>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Sticky footer buttons */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end">
          {phase === 'saved' ? (
            <>
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Not now
              </button>
              <button
                onClick={handleRegenerate}
                className="bg-blue-600 text-white text-sm font-medium px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
              >
                Adapt plan
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!valid || saving}
                className="bg-blue-600 text-white text-sm font-medium px-6 py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add event'}
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
