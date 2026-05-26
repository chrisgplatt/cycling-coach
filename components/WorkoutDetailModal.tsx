'use client'
import { useEffect, useState } from 'react'
import type { Workout, ICUActivity, WorkoutType, SessionFeedback, TrainingEvent } from '@/types'
import { getWeekBounds } from '@/lib/week-bounds'

const TYPE_COLOURS: Record<WorkoutType, string> = {
  endurance: 'bg-blue-100 text-blue-700',
  threshold: 'bg-orange-100 text-orange-700',
  intervals: 'bg-red-100 text-red-700',
  recovery: 'bg-emerald-100 text-emerald-700',
}

const IF_BY_TYPE: Record<WorkoutType, number> = {
  recovery: 0.50, endurance: 0.68, threshold: 0.85, intervals: 0.90,
}

const STATUS_CHIP: Partial<Record<string, string>> = {
  completed:    'bg-emerald-100 text-emerald-700',
  skipped:      'bg-red-100 text-red-600',
  needs_review: 'bg-amber-100 text-amber-700',
}

const STATUS_LABEL: Partial<Record<string, string>> = {
  completed:    '✓ Completed',
  skipped:      'Missed',
  needs_review: 'Needs review',
}

const MISSED_REASONS = ['Too tired', 'No time', 'Illness', 'Weather', 'Other']

interface Props {
  workout: Workout
  athleteId: string
  activitiesOnDate?: ICUActivity[]
  nearbyEvents?: TrainingEvent[]
  onClose: () => void
  onFeedback?: (existingFeedback?: SessionFeedback) => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
  onChat?: () => void
  onEventLinked?: (updated: TrainingEvent) => void
}

export default function WorkoutDetailModal({
  workout, athleteId, activitiesOnDate, nearbyEvents, onClose, onFeedback,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [showChange, setShowChange] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [markingMissed, setMarkingMissed] = useState(false)
  const [missedReason, setMissedReason] = useState<string | null>(null)
  const [savingMissed, setSavingMissed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [existingFeedback, setExistingFeedback] = useState<SessionFeedback | null | 'loading'>('loading')
  const [linkEventOpen, setLinkEventOpen] = useState(false)
  const [linkingEvent, setLinkingEvent] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    if (workout.status !== 'completed' && workout.status !== 'needs_review') {
      setExistingFeedback(null)
      return
    }
    fetch(`/api/feedback?workoutId=${workout.id}`)
      .then(r => r.json())
      .then(d => setExistingFeedback(d.feedback ?? null))
      .catch(() => setExistingFeedback(null))
  }, [workout.id, workout.status])

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

  async function handleMarkMissed() {
    setSavingMissed(true)
    setError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'skipped', missed_reason: missedReason }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to update')
        return
      }
      setMarkingMissed(false)
      setMissedReason(null)
      onStatusChange?.()
    } catch {
      setError('Network error')
    } finally {
      setSavingMissed(false)
    }
  }

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

  async function linkToEvent(event: TrainingEvent) {
    if (!workout.icu_activity_id) return
    setLinkingEvent(true)
    setLinkError(null)
    try {
      const res = await fetch('/api/events/result', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: event.name,
          event_date: event.date,
          icu_activity_id: workout.icu_activity_id,
          result_tss: workout.tss ?? undefined,
          result_duration_minutes: workout.duration_minutes,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setLinkError(d.error ?? 'Failed to link')
        return
      }
      const { event: updated } = await res.json()
      setLinkEventOpen(false)
      onEventLinked?.(updated)
    } catch {
      setLinkError('Network error')
    } finally {
      setLinkingEvent(false)
    }
  }

  async function handleRefreshIcu() {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}/refresh-icu`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRefreshMsg(data.error ?? 'Refresh failed')
      } else {
        setRefreshMsg('Refreshed in intervals.icu')
        setTimeout(() => setRefreshMsg(null), 3000)
      }
    } catch {
      setRefreshMsg('Network error')
    } finally {
      setRefreshing(false)
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
              {STATUS_CHIP[workout.status] && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[workout.status]}`}>
                  {STATUS_LABEL[workout.status]}
                </span>
              )}
              <span className="text-sm font-medium text-slate-500">{workout.duration_minutes} min</span>
              {workout.status === 'completed' && workout.tss !== null ? (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  ~{Math.round((workout.duration_minutes * 60 * (IF_BY_TYPE[workout.type] ?? 0.68) ** 2) / 36)} → {workout.tss} TSS
                </span>
              ) : workout.tss !== null ? (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  TSS {workout.tss}
                </span>
              ) : null}
            </div>
            {workout.status === 'planned' ? (
              <input
                type="date"
                min={weekStart}
                max={weekEnd}
                value={pendingDate ?? workout.date}
                onChange={e => {
                  const v = e.target.value
                  setPendingDate(v !== workout.date ? v : null)
                  setRescheduleError(null)
                }}
                className="text-xs font-medium text-slate-400 shrink-0 bg-transparent border-0 cursor-pointer hover:text-blue-500 focus:outline-none focus:text-blue-500 p-0"
              />
            ) : (
              <span className="text-xs font-medium text-slate-400 shrink-0">{workout.date}</span>
            )}
          </div>
          {pendingDate && (
            <div className="flex items-center gap-3 mt-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              <span className="text-sm font-semibold text-orange-700 flex-1">Move to {pendingDate}?</span>
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
                className="text-sm font-semibold bg-orange-500 text-white px-3 py-1 rounded-md hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {rescheduling ? 'Moving…' : 'Save'}
              </button>
            </div>
          )}
          {rescheduleError && (
            <p className="text-sm text-red-600 mt-2">{rescheduleError}</p>
          )}
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{workout.target_zones}</p>
          </div>

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
                View completed activity in intervals.icu →
              </a>
            )}
          </div>

          {(workout.status === 'completed' || workout.status === 'needs_review') && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Session feedback</p>
              {existingFeedback === 'loading' && (
                <p className="text-sm text-slate-400">Loading…</p>
              )}
              {existingFeedback === null && (
                <p className="text-sm text-slate-400 italic">No feedback logged yet.</p>
              )}
              {existingFeedback && existingFeedback !== 'loading' && (
                <>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {existingFeedback.feedback_text}
                  </p>
                  {existingFeedback.proposed_adjustment && existingFeedback.approved === true && (
                    <p className="text-xs text-emerald-600 font-medium">Adaptations applied</p>
                  )}
                  {existingFeedback.proposed_adjustment && existingFeedback.approved === false && (
                    <p className="text-xs text-slate-400">Adaptations suggested but not applied</p>
                  )}
                  {!existingFeedback.proposed_adjustment && (
                    <p className="text-xs text-slate-400">Logged without adaptation analysis</p>
                  )}
                  {onFeedback && (
                    <button
                      onClick={() => onFeedback(existingFeedback)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      Edit feedback
                    </button>
                  )}
                </>
              )}
            </div>
          )}

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

          {workout.status === 'planned' && markingMissed && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-medium text-orange-800">
                Why was it missed?{' '}
                <span className="font-normal text-orange-600">(optional)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {MISSED_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setMissedReason(prev => prev === r ? null : r)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      missedReason === r
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white text-orange-600 border-orange-300 hover:border-orange-500'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleMarkMissed}
                  disabled={savingMissed}
                  className="text-sm font-semibold bg-orange-500 text-white px-4 py-1.5 rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {savingMissed ? 'Saving…' : 'Confirm missed'}
                </button>
                <button
                  onClick={() => { setMarkingMissed(false); setMissedReason(null) }}
                  disabled={savingMissed}
                  className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {workout.icu_activity_id && nearbyEvents && nearbyEvents.length > 0 && !linkEventOpen && (
            <button
              onClick={() => setLinkEventOpen(true)}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              Link to event
            </button>
          )}

          {linkEventOpen && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Link to event</p>
              <div className="space-y-1.5">
                {(nearbyEvents ?? []).map(ev => (
                  <button
                    key={`${ev.name}-${ev.date}`}
                    onClick={() => linkToEvent(ev)}
                    disabled={linkingEvent || !!ev.icu_activity_id}
                    className={`w-full text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                      ev.icu_activity_id
                        ? 'border-slate-100 bg-white text-slate-300 cursor-default'
                        : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50'
                    }`}
                  >
                    <span className="font-medium">{ev.name}</span>
                    <span className="ml-2 text-xs text-slate-400">{ev.date} · {ev.priority} priority</span>
                    {ev.icu_activity_id && (
                      <span className="ml-2 text-xs text-emerald-500">already linked</span>
                    )}
                  </button>
                ))}
              </div>
              {linkError && (
                <p className="text-sm text-red-600">{linkError}</p>
              )}
              <button
                onClick={() => { setLinkEventOpen(false); setLinkError(null) }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
          {refreshMsg && (
            <p className={`text-sm rounded-lg px-3 py-2 ${refreshMsg === 'Refreshed in intervals.icu' ? 'text-emerald-700 bg-emerald-50 border border-emerald-100' : 'text-red-600 bg-red-50 border border-red-100'}`}>
              {refreshMsg}
            </p>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onChat && (
              <button
                onClick={onChat}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                Chat
              </button>
            )}
            {(workout.status === 'completed' || workout.status === 'needs_review') && onFeedback && existingFeedback !== 'loading' && !existingFeedback && (
              <button onClick={() => onFeedback()} className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
                Log feedback
              </button>
            )}
            {workout.status === 'planned' && workout.intervals_icu_event_id && !markingMissed && (
              <button
                onClick={handleRefreshIcu}
                disabled={refreshing}
                className="text-sm font-medium text-violet-600 hover:text-violet-800 disabled:opacity-50 transition-colors"
              >
                {refreshing ? 'Refreshing…' : 'Refresh in ICU'}
              </button>
            )}
            {workout.status === 'planned' && !markingMissed && (
              <button
                onClick={() => setMarkingMissed(true)}
                className="text-sm font-medium text-orange-500 hover:text-orange-700 transition-colors"
              >
                Mark as missed
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
