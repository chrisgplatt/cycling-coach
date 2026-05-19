'use client'
import { useState } from 'react'
import type { Workout, ICUActivity, WorkoutType } from '@/types'
import { getWeekBounds } from '@/lib/week-bounds'

const TYPE_COLOURS: Record<WorkoutType, string> = {
  endurance: 'bg-blue-100 text-blue-700',
  threshold: 'bg-orange-100 text-orange-700',
  intervals: 'bg-red-100 text-red-700',
  recovery: 'bg-emerald-100 text-emerald-700',
}

interface Props {
  workout: Workout
  athleteId: string
  activitiesOnDate?: ICUActivity[]
  onClose: () => void
  onFeedback?: () => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
}

export default function WorkoutDetailModal({
  workout, athleteId, activitiesOnDate, onClose, onFeedback, onStatusChange, onDelete, onReschedule,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [showChange, setShowChange] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to delete')
        setDeleteConfirm(false)
        return
      }
      onDelete?.()
    } catch {
      setError('Network error')
      setDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  function weekMonday(date: string): string {
    const d = new Date(date)
    const day = d.getUTCDay()
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1))
    return d.toISOString().split('T')[0]
  }

  const eventUrl = workout.intervals_icu_event_id
    ? `https://intervals.icu/?w=${weekMonday(workout.date)}`
    : null
  const activityUrl = workout.icu_activity_id
    ? `https://intervals.icu/activities/${workout.icu_activity_id}`
    : null

  const matchedActivity = activitiesOnDate?.find(a => a.id === workout.icu_activity_id)

  async function confirmMatch() {
    setConfirming(true)
    setError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to confirm')
        return
      }
      onStatusChange?.()
    } catch {
      setError('Network error')
    } finally {
      setConfirming(false)
    }
  }

  async function selectActivity(act: ICUActivity) {
    setConfirming(true)
    setError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icu_activity_id: act.id, tss: act.training_load, status: 'completed' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to update')
        return
      }
      onStatusChange?.()
    } catch {
      setError('Network error')
    } finally {
      setConfirming(false)
    }
  }

  const { start: weekStart, end: weekEnd } = getWeekBounds(workout.date)

  async function handleReschedule() {
    if (!pendingDate) return
    setRescheduling(true)
    setRescheduleError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: pendingDate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRescheduleError(data.error ?? 'Failed to reschedule')
        return
      }
      setPendingDate(null)
      onReschedule?.()
    } catch {
      setRescheduleError('Network error')
    } finally {
      setRescheduling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${TYPE_COLOURS[workout.type]}`}>
                {workout.type}
              </span>
              <span className="text-sm font-medium text-slate-500">{workout.duration_minutes} min</span>
              {workout.tss !== null && (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  TSS {workout.tss}
                </span>
              )}
            </div>
            <span className="text-xs font-medium text-slate-400 shrink-0">{workout.date}</span>
          </div>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{workout.target_zones}</p>
          </div>

          {workout.status === 'planned' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label htmlFor="reschedule-date" className="text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                  Reschedule
                </label>
                <input
                  id="reschedule-date"
                  type="date"
                  min={weekStart}
                  max={weekEnd}
                  value={pendingDate ?? workout.date}
                  onChange={e => {
                    const v = e.target.value
                    setPendingDate(v !== workout.date ? v : null)
                    setRescheduleError(null)
                  }}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {pendingDate && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-slate-600">Move to {pendingDate}?</span>
                  <button
                    onClick={() => { setPendingDate(null); setRescheduleError(null) }}
                    disabled={rescheduling}
                    className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReschedule}
                    disabled={rescheduling}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    {rescheduling ? 'Moving…' : 'Confirm'}
                  </button>
                </div>
              )}
              {rescheduleError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {rescheduleError}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            {eventUrl && (
              <a
                href={eventUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium block transition-colors"
              >
                View week in intervals.icu →
              </a>
            )}
            {activityUrl && (
              <a
                href={activityUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700 font-medium block transition-colors"
              >
                View Garmin activity →
              </a>
            )}
          </div>

          {workout.status === 'needs_review' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-medium text-amber-800">
                Auto-matched to <span className="font-semibold">{matchedActivity?.name ?? 'an activity'}</span> — correct?
              </p>
              {!showChange ? (
                <div className="flex gap-2">
                  <button
                    onClick={confirmMatch}
                    disabled={confirming}
                    className="text-sm font-medium bg-emerald-600 text-white px-4 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowChange(true)}
                    className="text-sm font-medium text-amber-700 hover:text-amber-900 px-3 py-1.5 transition-colors"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Select the correct activity</p>
                  {(activitiesOnDate ?? []).map(act => (
                    <button
                      key={act.id}
                      onClick={() => selectActivity(act)}
                      disabled={confirming}
                      className="w-full text-left text-sm px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                    >
                      <span className="font-medium text-slate-700">{act.name}</span>
                      {act.training_load != null && (
                        <span className="text-slate-400 ml-2">TSS {act.training_load}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(workout.status === 'completed' || workout.status === 'needs_review') && onFeedback && (
              <button onClick={onFeedback} className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
                Log feedback
              </button>
            )}
            {onDelete && !deleteConfirm && (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="text-sm font-medium text-red-500 hover:text-red-700 transition-colors"
              >
                Delete
              </button>
            )}
            {deleteConfirm && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">Delete this workout?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
