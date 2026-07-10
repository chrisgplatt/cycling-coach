'use client'
import { useEffect, useState } from 'react'
import type { Workout, ICUActivity, SessionFeedback, TrainingEvent, RideStreams, WeightEntry, ActivityWeather } from '@/types'
import ActivityWeatherPanel from '@/components/ActivityWeatherPanel'
import { weightAtDate } from '@/lib/weight-helpers'
import { getWeekBounds } from '@/lib/week-bounds'
import WorkoutProfileChart, { WorkoutStepList } from './WorkoutProfileChart'
import RideStats, { rideStatsFromMetrics } from './RideStats'
import SessionHistogram from './SessionHistogram'
import RideMapGraph from './ride/RideMapGraph'
import TabBar from './TabBar'
import PlannedVsActualChart from './PlannedVsActualChart'
import PlannedVsActualList from './PlannedVsActualList'
import { buildPlannedActual, type PlannedActual } from '@/lib/ride/planned-actual'
import WorkoutFeedbackTab from './WorkoutFeedbackTab'
import { deriveTargetZones } from '@/lib/claude/zones'
import { WORKOUT_TYPE_BADGE, WORKOUT_STATUS_BADGE, WORKOUT_STATUS_LABEL } from '@/lib/workout-colours'
import { estimateTss } from '@/lib/estimate-tss'

const MISSED_REASONS = ['Too tired', 'No time', 'Illness', 'Weather', 'Other']

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// "2026-06-01" → "Mon " (parsed as local midnight so the weekday matches the date).
function dayPrefix(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : `${DAY_ABBR[d.getDay()]} `
}

interface Props {
  workout: Workout
  athleteId: string
  ftp?: number
  effectiveMaxHr?: number | null
  activitiesOnDate?: ICUActivity[]
  nearbyEvents?: TrainingEvent[]
  weightLog?: WeightEntry[]
  onClose: () => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
  onChat?: () => void
  onEventLinked?: (updated: TrainingEvent) => void
}

export default function WorkoutDetailModal({
  workout, athleteId, ftp, effectiveMaxHr, activitiesOnDate, nearbyEvents, weightLog = [], onClose,
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
  const [actual, setActual] = useState<PlannedActual | null>(null)
  const [actualUnavailable, setActualUnavailable] = useState(false)
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [streamsError, setStreamsError] = useState(false)
  const [tab, setTab] = useState<'overview' | 'stats' | 'map' | 'feedback'>('overview')
  const [feedbackSaved, setFeedbackSaved] = useState(false)
  const [weather, setWeather] = useState<ActivityWeather | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [feedbackDirty, setFeedbackDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const hasRide = (workout.status === 'completed' || workout.status === 'needs_review') && !!workout.icu_activity_id

  // Guards against losing in-progress, unsubmitted feedback if the tab or PWA
  // gets backgrounded/reloaded — the in-app Close button has its own confirm.
  useEffect(() => {
    if (!feedbackDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [feedbackDirty])

  function attemptClose() {
    if (feedbackDirty) { setConfirmDiscard(true); return }
    onClose()
  }

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

  // For a completed, linked workout, fetch the actual ride streams + laps and build
  // the planned-vs-actual overlay. Any miss (not linked, no FTP, no power, fetch
  // error) leaves `actual` null and the target-only chart shows instead.
  useEffect(() => {
    setActual(null)
    setActualUnavailable(false)
    setStreams(null)
    setStreamsError(false)
    const isDone = workout.status === 'completed' || workout.status === 'needs_review'
    if (!isDone || !workout.icu_activity_id) return
    let cancelled = false
    fetch(`/api/rides/${workout.id}/streams`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        if (d?.streams) setStreams(d.streams)
        else setStreamsError(true)
        // The planned-vs-actual overlay also needs FTP + planned steps + a power stream.
        if (ftp && workout.steps?.length) {
          const pa = d?.streams ? buildPlannedActual(workout.steps, d.streams, d.intervals ?? null, ftp) : null
          if (pa) setActual(pa)
          else setActualUnavailable(true)
        }
      })
      .catch(() => { if (!cancelled) { setActualUnavailable(true); setStreamsError(true) } })
    return () => { cancelled = true }
  }, [workout.id, workout.status, workout.icu_activity_id, ftp, workout.steps])

  useEffect(() => {
    const activityId = workout.icu_activity_id
    if (!activityId || workout.status !== 'completed') {
      setWeather(null)
      setWeatherLoading(false)
      return
    }
    setWeather(null)
    setWeatherLoading(true)
    fetch(`/api/weather/activity/${activityId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: ActivityWeather | null) => { setWeather(d); setWeatherLoading(false) })
      .catch(() => setWeatherLoading(false))
  }, [workout.icu_activity_id, workout.status])

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
        body: JSON.stringify({ status: 'completed', ftp_at_completion: matchedActivity?.ftp ?? null }),
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
        body: JSON.stringify({ icu_activity_id: act.id, tss: act.training_load, status: 'completed', ftp_at_completion: act.ftp ?? null }),
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
    const act = activitiesOnDate?.find(a => a.id === workout.icu_activity_id)
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
          result_avg_power: act?.weighted_average_watts ?? undefined,
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
    <div className="fixed inset-0 z-50 bg-black/50 flex sm:items-center sm:justify-center sm:p-4">
      <div className="bg-white shadow-2xl w-full h-full flex flex-col sm:max-w-lg sm:h-[90vh] sm:rounded-2xl">
        <div className="p-5 border-b border-slate-100">
          {workout.name && (
            <p className="text-base font-bold text-slate-800 mb-2 truncate">{workout.name}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${WORKOUT_TYPE_BADGE[workout.type]}`}>
                {workout.type}
              </span>
              {WORKOUT_STATUS_BADGE[workout.status] && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${WORKOUT_STATUS_BADGE[workout.status]}`}>
                  {WORKOUT_STATUS_LABEL[workout.status]}
                </span>
              )}
              <span className="text-sm font-medium text-slate-500">
                {workout.status === 'completed' && workout.actual_duration_minutes !== null
                  ? <>{workout.duration_minutes} → {workout.actual_duration_minutes} min</>
                  : <>{workout.duration_minutes} min</>}
              </span>
              {workout.status === 'completed' && workout.tss !== null ? (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  ~{estimateTss(workout.type, workout.duration_minutes)} → {workout.tss} TSS
                </span>
              ) : workout.tss !== null ? (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  TSS {workout.tss}
                </span>
              ) : null}
              {workout.status === 'completed' && workout.ftp_at_completion !== null && (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  {workout.ftp_at_completion}W FTP
                </span>
              )}
            </div>
            {workout.status === 'planned' ? (
              // A styled label (so we can show the weekday) with a transparent native
              // date input overlaid on top to keep the platform date picker.
              <div className="relative shrink-0 self-start pt-0.5">
                <span className="text-sm font-medium text-slate-400 hover:text-blue-500">
                  {dayPrefix(pendingDate ?? workout.date)}{pendingDate ?? workout.date}
                </span>
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
                  onClick={e => e.currentTarget.showPicker?.()}
                  aria-label="Reschedule date"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
            ) : (
              <span className="text-sm font-medium text-slate-400 shrink-0 self-start pt-0.5">{dayPrefix(workout.date)}{workout.date}</span>
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

        {(() => {
          const isCompleted = workout.status === 'completed' || workout.status === 'needs_review'
          const hasFeedbackDot = isCompleted && existingFeedback === null && !feedbackSaved
          const tabs = [
            { id: 'overview', label: 'Overview' },
            ...(hasRide ? [{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }] : []),
            ...(isCompleted ? [{ id: 'feedback', label: 'Feedback', dot: hasFeedbackDot }] : []),
          ]
          return tabs.length > 1 ? (
            <TabBar
              tabs={tabs}
              activeId={tab}
              onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map' | 'feedback')}
            />
          ) : null
        })()}

        {hasRide && tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} fit />
              : <p className="p-5 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : tab === 'feedback' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            <WorkoutFeedbackTab
              workoutId={workout.id}
              activityId={workout.icu_activity_id ?? 'manual'}
              existingFeedback={existingFeedback}
              onFeedbackSaved={() => setFeedbackSaved(true)}
              onDirtyChange={setFeedbackDirty}
            />
          </div>
        ) : (
        <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
          {hasRide && tab === 'stats' && (
            workout.activity_metrics
              ? <>
                  {(() => {
                    const rideDate = workout.date
                    const w = weightAtDate(weightLog, rideDate, null)
                    const metricsStats = rideStatsFromMetrics(workout.activity_metrics, (workout.actual_duration_minutes ?? workout.duration_minutes) * 60, workout.tss)
                    if (w) {
                      metricsStats.avgWkg = metricsStats.avgWatts !== null ? parseFloat((metricsStats.avgWatts / w).toFixed(2)) : null
                      metricsStats.npWkg = metricsStats.np !== null ? parseFloat((metricsStats.np / w).toFixed(2)) : null
                    }
                    return <RideStats data={metricsStats} effectiveMaxHr={effectiveMaxHr} />
                  })()}
                  <SessionHistogram distributions={workout.activity_metrics.distributions} />
                </>
              : <p className="text-sm text-slate-400 italic">Ride stats not available yet.</p>
          )}
          {(!hasRide || tab === 'overview') && (
            <>
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{deriveTargetZones(workout.steps, ftp) ?? workout.target_zones}</p>
          </div>

          {workout.coaching_notes && (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coach&apos;s notes</p>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{workout.coaching_notes.summary}</p>
              {workout.coaching_notes.focus.length > 0 && (
                <ul className="space-y-1">
                  {workout.coaching_notes.focus.map((f, i) => (
                    <li key={i} className="text-sm text-slate-600 leading-relaxed">
                      <span className="font-semibold text-slate-700">{f.label}</span> — {f.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {workout.steps && workout.steps.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/60 space-y-2">
              {actual ? (
                <PlannedVsActualChart data={actual} ftp={ftp ?? 0} />
              ) : (
                <>
                  <WorkoutProfileChart steps={workout.steps} ftp={ftp} />
                  {actualUnavailable && (
                    <p className="text-[10px] text-slate-400 mt-1">Actual power unavailable for this ride.</p>
                  )}
                </>
              )}
              <details className="group">
                <summary className="cursor-pointer list-none text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1 select-none">
                  <svg width="10" height="10" viewBox="0 0 12 12" className="transition-transform group-open:rotate-90" fill="currentColor" aria-hidden="true">
                    <path d="M4 2l4 4-4 4z" />
                  </svg>
                  {actual ? 'Planned vs actual' : 'Steps'}
                </summary>
                <div className="mt-1">
                  {actual ? (
                    <PlannedVsActualList segments={actual.segments} />
                  ) : (
                    <WorkoutStepList steps={workout.steps} ftp={ftp} />
                  )}
                </div>
              </details>
            </div>
          )}

          {/* Weather impact panel — shown for completed GPS rides */}
          {workout.status === 'completed' && (weather || weatherLoading) && (
            <div className="px-4 py-3 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-2">Wind Impact</p>
              {weatherLoading ? (
                <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ) : weather ? (
                <ActivityWeatherPanel
                  weather={weather}
                  groundSpeedKph={
                    workout.activity_metrics
                      ? (() => {
                          const m = workout.activity_metrics
                          // distance_m is in metres; convert to km and divide by hours
                          return m.distance_m != null && workout.duration_minutes > 0
                            ? ((m.distance_m / 1000) / (workout.duration_minutes / 60))
                            : null
                        })()
                      : null
                  }
                />
              ) : null}
            </div>
          )}

          <div className="space-y-1.5">
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
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors py-2"
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
                    key={`${ev.name}-${ev.date}-${ev.type}`}
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
            </>
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
        )}

        <div
          className="px-4 pt-4 border-t border-slate-100 flex items-center justify-between"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
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
          <button onClick={attemptClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">
            Close
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Discard feedback?</h2>
              <p className="text-sm text-slate-500 mt-1">
                You've entered feedback for this session that hasn't been saved yet. Closing now will lose it.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDiscard(false)}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Keep editing
              </button>
              <button
                onClick={() => { setConfirmDiscard(false); onClose() }}
                className="bg-red-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
