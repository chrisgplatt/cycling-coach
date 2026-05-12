'use client'
import { useState } from 'react'
import type { Workout, ICUActivity, WorkoutType } from '@/types'

const TYPE_COLOURS: Record<WorkoutType, string> = {
  endurance: 'bg-blue-100 text-blue-800',
  threshold: 'bg-orange-100 text-orange-800',
  intervals: 'bg-red-100 text-red-800',
  recovery: 'bg-green-100 text-green-800',
}

interface Props {
  workout: Workout
  athleteId: string
  activitiesOnDate?: ICUActivity[]
  onClose: () => void
  onFeedback?: () => void
  onStatusChange?: () => void
}

export default function WorkoutDetailModal({
  workout, athleteId, activitiesOnDate, onClose, onFeedback, onStatusChange,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [showChange, setShowChange] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    ? `https://intervals.icu/athlete/${athleteId}/activities/${workout.icu_activity_id}`
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

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col">
        <div className="p-5 border-b border-gray-200">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${TYPE_COLOURS[workout.type]}`}>
                {workout.type}
              </span>
              <span className="text-sm text-gray-500">{workout.duration_minutes} min</span>
              {workout.tss !== null && (
                <span className="text-sm font-medium text-gray-700">TSS: {workout.tss}</span>
              )}
            </div>
            <span className="text-sm text-gray-400 shrink-0">{workout.date}</span>
          </div>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div>
            <p className="text-sm text-gray-700">{workout.description}</p>
            <p className="text-xs text-gray-500 mt-1">{workout.target_zones}</p>
          </div>

          <div className="space-y-1">
            {eventUrl && (
              <a
                href={eventUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline block"
              >
                View week in intervals.icu →
              </a>
            )}
            {activityUrl && (
              <a
                href={activityUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline block"
              >
                View Garmin activity in intervals.icu →
              </a>
            )}
          </div>

          {workout.status === 'needs_review' && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
              <p className="text-sm text-amber-800">
                Auto-matched to {matchedActivity?.name ?? 'an activity'} — correct?
              </p>
              {!showChange ? (
                <div className="flex gap-2">
                  <button
                    onClick={confirmMatch}
                    disabled={confirming}
                    className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowChange(true)}
                    className="text-sm text-amber-700 hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">Select the correct activity:</p>
                  {(activitiesOnDate ?? []).map(act => (
                    <button
                      key={act.id}
                      onClick={() => selectActivity(act)}
                      disabled={confirming}
                      className="w-full text-left text-sm px-3 py-2 rounded border border-gray-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
                    >
                      {act.name}{act.training_load != null ? ` — TSS ${act.training_load}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="p-4 border-t border-gray-200 flex items-center justify-between">
          <div>
            {(workout.status === 'completed' || workout.status === 'needs_review') && onFeedback && (
              <button onClick={onFeedback} className="text-sm text-blue-600 hover:underline">
                Log feedback
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
