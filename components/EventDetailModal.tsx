'use client'
import { useState } from 'react'
import type { TrainingEvent, ICUActivity } from '@/types'

interface Props {
  event: TrainingEvent
  activitiesOnDate: ICUActivity[]
  activitiesLoading?: boolean
  onClose: () => void
  onResultSaved: (updated: TrainingEvent) => void
  onEdit?: () => void
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`
}

const PRIORITY_COLOUR: Record<string, string> = {
  A: 'bg-red-100 text-red-700',
  B: 'bg-orange-100 text-orange-700',
  C: 'bg-blue-100 text-blue-700',
}
const TYPE_COLOUR: Record<string, string> = {
  race: 'bg-red-50 text-red-600',
  sportive: 'bg-purple-50 text-purple-600',
  holiday: 'bg-green-50 text-green-600',
  fitness: 'bg-blue-50 text-blue-600',
}

export default function EventDetailModal({
  event, activitiesOnDate, activitiesLoading = false, onClose, onResultSaved, onEdit,
}: Props) {
  const rides = activitiesOnDate.filter(a => /ride/i.test(a.type))
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    rides.length === 1 ? rides[0].id : null,
  )
  const [note, setNote] = useState(event.result_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const hasResult = !!event.icu_activity_id

  async function assign() {
    const activity = rides.find(a => a.id === selectedActivityId)
    if (!activity) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/events/result', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: event.name,
          event_date: event.date,
          icu_activity_id: activity.id,
          result_tss: activity.training_load ?? undefined,
          result_duration_minutes: activity.moving_time
            ? Math.round(activity.moving_time / 60)
            : undefined,
          result_avg_power: activity.weighted_average_watts ?? undefined,
          result_note: note || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to save')
        return
      }
      const { event: updated } = await res.json()
      setShowPicker(false)
      onResultSaved(updated)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function saveNote() {
    if (note === (event.result_note ?? '')) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/events/result', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: event.name,
          event_date: event.date,
          result_note: note,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to save note')
        return
      }
      const { event: updated } = await res.json()
      onResultSaved(updated)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function removeResult() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/events/result', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: event.name, event_date: event.date, remove: true }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to remove')
        return
      }
      const { event: updated } = await res.json()
      setNote('')
      setSelectedActivityId(null)
      setShowPicker(false)
      onResultSaved(updated)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto flex flex-col">

        {/* Header */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-slate-800">{event.name}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-slate-400">{event.date}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${TYPE_COLOUR[event.type] ?? 'bg-slate-100 text-slate-600'}`}>
                  {event.type}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOUR[event.priority] ?? 'bg-slate-100 text-slate-600'}`}>
                  Priority {event.priority}
                </span>
                {event.race_type && (
                  <span className="text-xs text-slate-500 capitalize">
                    {event.race_type.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
            {event.icu_activity_id && (
              <span
                className="w-3 h-3 rounded-full bg-emerald-500 mt-1 shrink-0"
                title="Result assigned"
              />
            )}
          </div>
          {(event.start_time || event.duration_minutes || event.distance_km || event.estimated_tss != null) && (
            <div className="flex gap-3 mt-3 text-xs text-slate-500 flex-wrap">
              {event.start_time && <span>Starts {event.start_time}</span>}
              {event.duration_minutes && <span>~{event.duration_minutes}min</span>}
              {event.distance_km && <span>~{event.distance_km}km</span>}
              {event.estimated_tss != null && (
                <span className="text-slate-400">~{event.estimated_tss} TSS (est.)</span>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 flex-1">
          {hasResult && !showPicker ? (
            /* Result-assigned state */
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Result</p>
                <div className="flex flex-wrap gap-4">
                  {event.result_tss != null && (
                    <div>
                      <p className="text-xs text-slate-400">TSS</p>
                      <p className="text-sm font-semibold text-slate-700">{event.result_tss}</p>
                    </div>
                  )}
                  {event.result_duration_minutes != null && (
                    <div>
                      <p className="text-xs text-slate-400">Duration</p>
                      <p className="text-sm font-semibold text-slate-700">{fmtDuration(event.result_duration_minutes)}</p>
                    </div>
                  )}
                  {event.result_avg_power != null && (
                    <div>
                      <p className="text-xs text-slate-400">NP</p>
                      <p className="text-sm font-semibold text-slate-700">{event.result_avg_power}W</p>
                    </div>
                  )}
                </div>
                <a
                  href={`https://intervals.icu/activities/${event.icu_activity_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  View in intervals.icu →
                </a>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Race note
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onBlur={saveNote}
                  rows={3}
                  placeholder="How did it go? (auto-saves)"
                  className="w-full text-sm border border-slate-200 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {saving && <p className="text-xs text-slate-400">Saving…</p>}
              </div>
            </>
          ) : (
            /* No-result / picker state */
            <>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Assign completed ride
                </p>
                {activitiesLoading ? (
                  <p className="text-sm text-slate-400">Loading rides…</p>
                ) : rides.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">
                    No rides recorded for this date. Try syncing first.
                  </p>
                ) : rides.length === 1 ? (
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                    <p className="text-sm font-medium text-slate-700">{rides[0].name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {rides[0].moving_time ? `${Math.round(rides[0].moving_time / 60)}min` : ''}
                      {rides[0].training_load != null ? ` · TSS ${rides[0].training_load}` : ''}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {rides.map(act => (
                      <button
                        key={act.id}
                        onClick={() => setSelectedActivityId(act.id)}
                        className={`w-full text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                          selectedActivityId === act.id
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <span className="font-medium text-slate-700">{act.name}</span>
                        <span className="text-slate-400 ml-2 text-xs">
                          {act.moving_time ? `${Math.round(act.moving_time / 60)}min` : ''}
                          {act.training_load != null ? ` · TSS ${act.training_load}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Race note <span className="normal-case font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="How did it go?"
                  className="w-full text-sm border border-slate-200 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasResult && !showPicker && (
              <>
                <button
                  onClick={() => setShowPicker(true)}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Change ride
                </button>
                <button
                  onClick={removeResult}
                  disabled={saving}
                  className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                >
                  Remove result
                </button>
              </>
            )}
            {(!hasResult || showPicker) && (
              <>
                <button
                  onClick={assign}
                  disabled={saving || !selectedActivityId}
                  className="text-sm font-semibold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Assign ride'}
                </button>
                {showPicker && (
                  <button
                    onClick={() => setShowPicker(false)}
                    className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={onEdit}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors"
              >
                Edit event
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
