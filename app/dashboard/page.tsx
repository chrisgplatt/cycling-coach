'use client'
import { useEffect, useRef, useState } from 'react'
import MetricsBar from '@/components/MetricsBar'
import WorkoutCard from '@/components/WorkoutCard'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent, SessionFeedback } from '@/types'
import { EVENT_COLOURS } from '@/lib/event-colours'
import WeeklyReviewBanner from '@/components/WeeklyReviewBanner'
import PlanReviewModal from '@/components/PlanReviewModal'
import { isoWeek } from '@/lib/iso-week'
import { getWeekBounds } from '@/lib/week-bounds'
import { localDateStr } from '@/lib/local-date'
import type { GeneratedPlan } from '@/types'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { ReactNode } from 'react'
import RescheduleConfirmModal from '@/components/RescheduleConfirmModal'
import TodayCard from '@/components/TodayCard'
import NotificationBanner from '@/components/NotificationBanner'
import SessionChatModal from '@/components/SessionChatModal'
import PlanChatModal from '@/components/PlanChatModal'
import EventDetailModal from '@/components/EventDetailModal'
import AddEventModal from '@/components/AddEventModal'
import ActivityCard from '@/components/ActivityCard'

function getReadinessSummary(wellness: ICUWellness): string {
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)

  let summary: string
  if (form === null) {
    summary = 'Not enough training load data to assess readiness yet.'
  } else if (form > 10) {
    summary = `With a form score of +${Math.round(form)}, you're well rested and carrying low fatigue — prime condition for a hard effort today.`
  } else if (form > 5) {
    summary = `Your form score of +${Math.round(form)} shows you're fresh and ready for quality training. A structured session today should feel good.`
  } else if (form >= -5) {
    summary = `Your form score of ${Math.round(form)} reflects a balanced training load. You're fit to train — moderate intensity suits the current state well.`
  } else if (form >= -15) {
    summary = `Your form score of ${Math.round(form)} indicates some accumulated fatigue from recent training. Keep today's effort controlled and focus on completion over intensity.`
  } else {
    summary = `Your form score of ${Math.round(form)} points to significant fatigue. Prioritise recovery — an easy spin or rest will serve you better than pushing hard right now.`
  }

  const notes: string[] = []
  if (wellness.hrv !== null) notes.push(`HRV ${Math.round(wellness.hrv)} ms`)
  if (wellness.resting_hr !== null) notes.push(`resting HR ${Math.round(wellness.resting_hr)} bpm`)
  if (notes.length > 0) summary += ` (${notes.join(', ')})`

  return summary
}

const SYNC_CACHE_KEY = 'cycling_coach_sync'

function DraggableWorkoutCard({ workout, onClick }: { workout: Workout; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: workout.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <WorkoutCard workout={workout} onClick={onClick} />
    </div>
  )
}

function DroppableDay({ date, children }: { date: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: date })
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 space-y-2 rounded-xl transition-colors ${isOver ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''}`}
    >
      {children}
    </div>
  )
}

export default function DashboardPage() {
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [athleteId, setAthleteId] = useState('')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [planName, setPlanName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [initialFeedback, setInitialFeedback] = useState<SessionFeedback | null>(null)
  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [showReviewBanner, setShowReviewBanner] = useState(false)
  const [lastWeekStats, setLastWeekStats] = useState({ completed: 0, total: 0 })
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewPlan, setReviewPlan] = useState<GeneratedPlan | null>(null)
  const [reviewWorkoutsFound, setReviewWorkoutsFound] = useState(0)
  const [reviewEstimatedWorkouts, setReviewEstimatedWorkouts] = useState(0)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const reviewAbortRef = useRef<AbortController | null>(null)

  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null)
  const [pendingReschedule, setPendingReschedule] = useState<{ workout: Workout; toDate: string } | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [chatWorkout, setChatWorkout] = useState<Workout | null>(null)
  const [planChatOpen, setPlanChatOpen] = useState(false)
  const [planTargetEvent, setPlanTargetEvent] = useState('')
  const [planTargetDate, setPlanTargetDate] = useState('')
  const [currentFTP, setCurrentFTP] = useState(200)
  const [futurePlanWorkouts, setFuturePlanWorkouts] = useState<Workout[]>([])
  const [selectedEvent, setSelectedEvent] = useState<TrainingEvent | null>(null)
  const [editingEvent, setEditingEvent] = useState<TrainingEvent | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveWorkout(workouts.find(w => w.id === String(event.active.id)) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveWorkout(null)
    const { active, over } = event
    if (!over) return
    const workout = workouts.find(w => w.id === String(active.id))
    if (!workout || workout.status !== 'planned') return
    const toDate = String(over.id)
    if (toDate === workout.date) return
    setPendingReschedule({ workout, toDate })
  }

  function applySyncData(data: ICUSyncData & { athlete_id?: string }, syncedAt: Date) {
    setSyncData(data)
    setLastSyncedAt(syncedAt)
    if (data.athlete_id) setAthleteId(data.athlete_id)
  }

  async function doSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const now = new Date()
        applySyncData(data, now)
        try {
          localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify({ syncedAt: now.toISOString(), data }))
        } catch { /* ignore storage errors */ }
      }
    } finally {
      setSyncing(false)
    }
  }

  async function loadPlan() {
    const res = await fetch('/api/plan')
    if (!res.ok) return
    const plan = await res.json()
    if (!plan) {
      setShowReviewBanner(false)
      return
    }

    if (plan.workouts) {
      const today = localDateStr(new Date())
      const { start: weekStart, end: weekEnd } = getWeekBounds(today)
      setWorkouts(plan.workouts.filter((w: Workout) => w.date >= weekStart && w.date <= weekEnd))
      setFuturePlanWorkouts(plan.workouts.filter((w: Workout) => w.date >= today && w.status === 'planned'))

      // Compute last week date range for review banner
      const d = new Date()
      const dayOfWeek = (d.getDay() + 6) % 7  // 0=Mon
      const thisMonStart = new Date(d)
      thisMonStart.setDate(d.getDate() - dayOfWeek)
      const lastMonStart = new Date(thisMonStart)
      lastMonStart.setDate(thisMonStart.getDate() - 7)
      const lastSunEnd = new Date(thisMonStart)
      lastSunEnd.setDate(thisMonStart.getDate() - 1)
      const lwStart = lastMonStart.toISOString().split('T')[0]
      const lwEnd = lastSunEnd.toISOString().split('T')[0]

      const lastWeek = plan.workouts.filter((w: Workout) => w.date >= lwStart && w.date <= lwEnd)
      setLastWeekStats({
        completed: lastWeek.filter((w: Workout) => w.status === 'completed').length,
        total: lastWeek.length,
      })
      setReviewEstimatedWorkouts(
        plan.workouts.filter((w: Workout) => w.date >= today && w.status === 'planned').length
      )
    }

    if (plan.name) setPlanName(plan.name)
    if (plan.target_event_name) setPlanTargetEvent(plan.target_event_name)
    if (plan.target_event_date) setPlanTargetDate(plan.target_event_date)

    // Show review banner if current ISO week exceeds last reviewed week
    const week = isoWeek(new Date())
    if (!plan.last_reviewed_week || plan.last_reviewed_week < week) {
      setShowReviewBanner(true)
    } else {
      setShowReviewBanner(false)
    }
  }

  async function startReview(note: string) {
    reviewAbortRef.current?.abort()
    const controller = new AbortController()
    reviewAbortRef.current = controller

    setReviewLoading(true)
    setReviewPlan(null)
    setReviewWorkoutsFound(0)
    setShowReviewModal(true)
    try {
      const res = await fetch('/api/plan/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) { setReviewLoading(false); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done || controller.signal.aborted) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'progress') setReviewWorkoutsFound(msg.found)
            if (msg.type === 'done') { setReviewPlan(msg.plan); setReviewLoading(false) }
            if (msg.type === 'error') setReviewLoading(false)
          } catch { /* ignore parse errors */ }
        }
      }
      // flush any remaining buffered data
      if (buf.trim()) {
        try {
          const msg = JSON.parse(buf)
          if (msg.type === 'done') { setReviewPlan(msg.plan); setReviewLoading(false) }
          if (msg.type === 'error') setReviewLoading(false)
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setReviewLoading(false)
    }
  }

  function handleDismiss() {
    setShowReviewBanner(false)
    fetch('/api/plan/review', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismiss: true }),
    }).catch(() => {})
  }

  function handleReviewApprove() {
    setShowReviewModal(false)
    setReviewPlan(null)
    setShowReviewBanner(false)
    loadPlan()
  }

  function handleWorkoutUpdated(updated: Workout) {
    setWorkouts(prev => prev.map(w => w.id === updated.id ? updated : w))
  }

  async function updateEvent(original: TrainingEvent, updated: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original_name: original.name, original_date: original.date, ...updated }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to update event')
    setEvents(prev => prev.map(e => e.name === original.name && e.date === original.date ? data.event : e))
  }

  useEffect(() => () => reviewAbortRef.current?.abort(), [])

  useEffect(() => {
    const today = localDateStr(new Date())
    let needsSync = true
    try {
      const raw = localStorage.getItem(SYNC_CACHE_KEY)
      if (raw) {
        const cached = JSON.parse(raw)
        if (typeof cached.syncedAt === 'string' && cached.syncedAt.startsWith(today)) {
          applySyncData(cached.data, new Date(cached.syncedAt))
          needsSync = false
        }
      }
    } catch { /* ignore cache errors */ }
    if (needsSync) doSync()
    loadPlan()
    fetch('/api/profile').then(r => r.json()).then(data => {
      const name: string = data?.full_name ?? ''
      if (name) setFirstName(name.split(' ')[0])
      if (data?.events) setEvents(data.events)
      setNotificationsEnabled(data?.notifications_enabled ?? false)
      if (data?.current_ftp) setCurrentFTP(data.current_ftp)
    }).catch(() => {})
  }, [])

  const wellnessArr = syncData?.wellness ?? []
  const latestEntry = wellnessArr.length > 0 ? wellnessArr[wellnessArr.length - 1] : null
  const reversed = [...wellnessArr].reverse()
  const hrvEntry = reversed.find(w => w.hrv !== null) ?? null
  const restingHrEntry = reversed.find(w => w.resting_hr !== null) ?? null
  const latestWellness: ICUWellness | null = latestEntry
    ? { ...latestEntry, hrv: hrvEntry?.hrv ?? null, resting_hr: restingHrEntry?.resting_hr ?? null }
    : null
  const wellnessStale = {
    hrv: !!(hrvEntry && latestEntry && hrvEntry.id !== latestEntry.id),
    restingHr: !!(restingHrEntry && latestEntry && restingHrEntry.id !== latestEntry.id),
  }

  const lastRide = syncData?.activities
    ?.filter(a => /ride/i.test(a.type))
    .slice()
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0] ?? null

  function formatReadinessTime(date: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} at ${time}`
  }

  function formatLastRide(): string {
    if (!lastRide) return ''
    const rideDate = new Date(lastRide.start_date_local)
    const rideDateStr = lastRide.start_date_local.split('T')[0]
    const timeStr = rideDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const dateStr = rideDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`
    if (rideDateStr === todayStr) return `today at ${timeStr}`
    if (rideDateStr === yesterdayStr) return `yesterday at ${timeStr}`
    return `${dateStr} at ${timeStr}`
  }

  const todayStr = localDateStr(new Date())
  const todayWorkout = workouts.find(w => w.date === todayStr) ?? null
  const todaySessionCount = workouts.filter(w => w.date === todayStr).length

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const today = new Date()
  const dayOfWeek = (today.getDay() + 6) % 7  // 0=Mon … 6=Sun (Sunday was 0, causing off-by-one)
  const weekDates = days.map((_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - dayOfWeek + i)
    return localDateStr(d)
  })

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {showReviewBanner && (
        <WeeklyReviewBanner
          lastWeekCompleted={lastWeekStats.completed}
          lastWeekTotal={lastWeekStats.total}
          onReview={startReview}
          onDismiss={handleDismiss}
        />
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
            {firstName ? `Hi, ${firstName} 👋` : 'This Week'}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {planName && <span className="text-sm text-gray-500">{planName}</span>}
            {planName && (
              <button
                onClick={() => setPlanChatOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 rounded-full px-2.5 py-1 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                Chat
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Base phase
            </span>
          </div>
        </div>
        <button
          onClick={doSync}
          disabled={syncing}
          className="text-sm font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-4 py-1.5 hover:bg-blue-100 disabled:opacity-50 transition-colors shrink-0"
        >
          {syncing ? 'Syncing…' : '↻ Sync'}
        </button>
      </div>

      {/* Daily briefing */}
      <div className="space-y-3">
        {!notificationsEnabled && (
          <NotificationBanner onEnabled={() => setNotificationsEnabled(true)} />
        )}
        <TodayCard
          workout={todayWorkout}
          wellness={latestWellness}
          todayEvent={events.find(e => e.date === todayStr) ?? null}
          extraSessionCount={todaySessionCount - 1}
          onWorkoutClick={w => setSelectedWorkout(w)}
          onChatWithCoach={todayWorkout ? () => setChatWorkout(todayWorkout) : undefined}
        />
      </div>

      <MetricsBar wellness={latestWellness} syncedAt={lastSyncedAt} stale={wellnessStale} />

      {latestWellness && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Readiness</h2>
              {lastSyncedAt && (
                <span className="text-[11px] text-gray-400">as of {formatReadinessTime(lastSyncedAt)}</span>
              )}
            </div>
            {lastRide && (
              <span className="text-xs text-gray-400">Last ride: <span className="font-semibold text-gray-500">{formatLastRide()}</span></span>
            )}
          </div>
          <p className="text-sm text-gray-600 leading-relaxed px-4 py-3">{getReadinessSummary(latestWellness)}</p>
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between mb-0.5">
          <h2 className="text-lg font-bold tracking-tight text-gray-900">This week</h2>
          {(() => {
            const IF_VALS: Record<string, number> = { recovery: 0.50, endurance: 0.68, threshold: 0.85, intervals: 0.90 }
            const weekWorkouts = workouts.filter(w => weekDates.includes(w.date))
            if (!weekWorkouts.length) return null
            const plannedTss = weekWorkouts.reduce((sum, w) => {
              const if_ = IF_VALS[w.type] ?? 0.68
              return sum + Math.round((w.duration_minutes * 60 * if_ * if_) / 36)
            }, 0)
            const actualTss = weekWorkouts
              .filter(w => w.status === 'completed' && w.tss !== null)
              .reduce((sum, w) => sum + (w.tss ?? 0), 0)
            const plannedMins = weekWorkouts.reduce((sum, w) => sum + w.duration_minutes, 0)
            const completedMins = weekWorkouts
              .filter(w => w.status === 'completed')
              .reduce((sum, w) => sum + w.duration_minutes, 0)
            const hasCompleted = weekWorkouts.some(w => w.status === 'completed')
            const fmt = (m: number) => `${Math.round(m / 60 * 10) / 10}h`
            return hasCompleted ? (
              <span className="text-sm text-gray-400">
                <span className="font-semibold text-gray-600">~{plannedTss} → {actualTss}</span>{' TSS · '}
                <span className="font-semibold text-gray-600">{fmt(completedMins)}/{fmt(plannedMins)}</span>
              </span>
            ) : (
              <span className="text-sm text-gray-400">
                <span className="font-semibold text-gray-600">~{plannedTss}</span>{' TSS · '}
                <span className="font-semibold text-gray-600">{fmt(plannedMins)}</span>
              </span>
            )
          })()}
        </div>
        <p className="text-sm text-gray-400 mb-4">
          {weekDates[0].slice(8)} – {weekDates[6].slice(8)} {new Date(weekDates[0]).toLocaleString('en-GB', { month: 'long' })}
        </p>
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {weekDates.map((date, i) => {
              const dayWorkouts = workouts.filter(w => w.date === date)
              const dayEvents = events.filter(e => e.date === date)

              // Events whose icu_activity_id matches a workout on the same day — shown below that workout
              const eventByActivityId = new Map<string, TrainingEvent>()
              dayEvents.forEach(e => {
                if (e.icu_activity_id && dayWorkouts.some(w => w.icu_activity_id === e.icu_activity_id)) {
                  eventByActivityId.set(e.icu_activity_id, e)
                }
              })
              // Events not paired with a workout render as standalone cards
              const standaloneEvents = dayEvents.filter(e =>
                !e.icu_activity_id || !dayWorkouts.some(w => w.icu_activity_id === e.icu_activity_id)
              )

              const linkedIds = new Set<string>([
                ...dayWorkouts.map(w => w.icu_activity_id).filter((id): id is string => id != null),
                ...dayEvents.map(e => e.icu_activity_id).filter((id): id is string => id != null),
              ])
              const unplannedActivities = (syncData?.activities ?? [])
                .filter(a => a.start_date_local.startsWith(date) && /ride/i.test(a.type) && !linkedIds.has(a.id))
              const isEmpty = dayWorkouts.length === 0 && standaloneEvents.length === 0 && unplannedActivities.length === 0
              const isToday = date === localDateStr(new Date())
              return (
                <div key={date} className="flex gap-4 items-start">
                  <div className="w-10 text-center pt-3">
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{days[i]}</div>
                    <div className={`text-xl font-extrabold tracking-tight mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{date.slice(8)}</div>
                  </div>
                  <DroppableDay date={date}>
                    {dayWorkouts.map(w => {
                      const linkedEvent = w.icu_activity_id ? eventByActivityId.get(w.icu_activity_id) : undefined
                      return (
                        <div key={w.id}>
                          {w.status === 'planned' ? (
                            <DraggableWorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} />
                          ) : (
                            <WorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} />
                          )}
                          {linkedEvent && (
                            <button
                              onClick={() => setSelectedEvent(linkedEvent)}
                              className={`ml-4 w-[calc(100%-1rem)] text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-2.5 mt-1 hover:brightness-95 transition-all ${EVENT_COLOURS[linkedEvent.priority]}`}
                            >
                              <div className="flex items-center gap-2">
                                <span>🏁</span>
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-sm">{linkedEvent.name}</div>
                                  <div className="text-xs capitalize opacity-75">{linkedEvent.type} · {linkedEvent.priority} priority</div>
                                </div>
                                {linkedEvent.result_tss != null && (
                                  <span className="text-xs shrink-0 opacity-75">{linkedEvent.result_tss} TSS</span>
                                )}
                              </div>
                            </button>
                          )}
                        </div>
                      )
                    })}
                    {standaloneEvents.map(e => (
                      <button
                        key={e.icu_event_id ?? `${e.date}-${e.name}`}
                        onClick={() => setSelectedEvent(e)}
                        className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 hover:brightness-95 transition-all ${EVENT_COLOURS[e.priority]}`}
                      >
                        <div className="flex items-center gap-2">
                          <span>🏁</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">{e.name}</div>
                            <div className="text-xs capitalize opacity-75">{e.type} · {e.priority} priority</div>
                          </div>
                          {e.icu_activity_id && (
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Result recorded" />
                          )}
                        </div>
                      </button>
                    ))}
                    {unplannedActivities.map(a => (
                      <ActivityCard key={a.id} activity={a} />
                    ))}
                    {isEmpty && (
                      <div className="text-sm text-gray-300 italic py-3.5 pl-1">Rest day</div>
                    )}
                  </DroppableDay>
                </div>
              )
            })}
          </div>
          <DragOverlay>
            {activeWorkout ? <WorkoutCard workout={activeWorkout} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          onClose={() => setSelectedWorkout(null)}
          onFeedback={(existingFeedback) => {
            setInitialFeedback(existingFeedback ?? null)
            setFeedbackWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
          onChat={() => {
            setChatWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
          onStatusChange={() => {
            setSelectedWorkout(null)
            loadPlan()
          }}
          onDelete={() => {
            setSelectedWorkout(null)
            loadPlan()
          }}
          onReschedule={() => {
            setSelectedWorkout(null)
            loadPlan()
          }}
          nearbyEvents={events.filter(e => {
            if (!selectedWorkout) return false
            const diff = Math.abs(
              Math.floor(new Date(e.date + 'T00:00:00Z').getTime() / 86400000) -
              Math.floor(new Date(selectedWorkout.date + 'T00:00:00Z').getTime() / 86400000)
            )
            return diff <= 7
          })}
          onEventLinked={(updated) => {
            setEvents(prev =>
              prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e)
            )
          }}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedEvent.date)
            ) ?? []
          }
          onClose={() => setSelectedEvent(null)}
          onResultSaved={(updated) => {
            setEvents(prev =>
              prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e)
            )
            setSelectedEvent(updated)
          }}
          onEdit={() => {
            setEditingEvent(selectedEvent)
            setSelectedEvent(null)
          }}
        />
      )}

      {editingEvent && (
        <AddEventModal
          initialEvent={editingEvent}
          onConfirm={async (updated) => {
            await updateEvent(editingEvent, updated)
            setEditingEvent(null)
          }}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {feedbackWorkout && (
        <FeedbackModal
          workout={feedbackWorkout}
          initialFeedback={initialFeedback ?? undefined}
          onClose={() => {
            setFeedbackWorkout(null)
            setInitialFeedback(null)
          }}
        />
      )}

      {chatWorkout && (
        <SessionChatModal
          workout={chatWorkout}
          wellness={latestWellness}
          onClose={() => setChatWorkout(null)}
          onWorkoutUpdated={handleWorkoutUpdated}
        />
      )}

      {planChatOpen && planName && (
        <PlanChatModal
          planName={planName}
          targetEvent={planTargetEvent}
          targetDate={planTargetDate}
          futureWorkouts={futurePlanWorkouts}
          wellness={latestWellness}
          currentFTP={currentFTP}
          onClose={() => setPlanChatOpen(false)}
          onWorkoutsUpdated={() => { setPlanChatOpen(false); loadPlan() }}
        />
      )}

      {pendingReschedule && (
        <RescheduleConfirmModal
          workout={pendingReschedule.workout}
          toDate={pendingReschedule.toDate}
          onConfirm={() => { setPendingReschedule(null); loadPlan() }}
          onCancel={() => setPendingReschedule(null)}
        />
      )}

      {showReviewModal && (
        <PlanReviewModal
          plan={reviewPlan}
          loading={reviewLoading}
          workoutsFound={reviewWorkoutsFound}
          estimatedWorkouts={reviewEstimatedWorkouts}
          onApprove={handleReviewApprove}
          onReject={() => { setShowReviewModal(false); setReviewPlan(null) }}
        />
      )}
    </div>
  )
}
