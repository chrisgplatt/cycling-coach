'use client'
import { useEffect, useRef, useState } from 'react'
import MetricsBar from '@/components/MetricsBar'
import WorkoutCard from '@/components/WorkoutCard'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent } from '@/types'
import { EVENT_COLOURS } from '@/lib/event-colours'
import WeeklyReviewBanner from '@/components/WeeklyReviewBanner'
import PlanReviewModal from '@/components/PlanReviewModal'
import { isoWeek } from '@/lib/iso-week'
import { getWeekBounds } from '@/lib/week-bounds'
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
    if (!workout) return
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
      const today = new Date().toISOString().split('T')[0]
      const { start: weekStart, end: weekEnd } = getWeekBounds(today)
      setWorkouts(plan.workouts.filter((w: Workout) => w.date >= weekStart && w.date <= weekEnd))

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

  useEffect(() => () => reviewAbortRef.current?.abort(), [])

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
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
    }).catch(() => {})
  }, [])

  const wellnessArr = syncData?.wellness ?? []
  const latestWellness: ICUWellness | null = wellnessArr.length > 0
    ? {
        ...wellnessArr[wellnessArr.length - 1],
        hrv: [...wellnessArr].reverse().find(w => w.hrv !== null)?.hrv ?? null,
        resting_hr: [...wellnessArr].reverse().find(w => w.resting_hr !== null)?.resting_hr ?? null,
      }
    : null

  const lastRide = syncData?.activities
    ?.filter(a => /ride/i.test(a.type))
    .slice()
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0] ?? null

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

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const today = new Date()
  const weekDates = days.map((_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - d.getDay() + 1 + i)
    return d.toISOString().split('T')[0]
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

      <MetricsBar wellness={latestWellness} syncedAt={lastSyncedAt} />

      {latestWellness && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Readiness</h2>
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
            const weekWorkouts = workouts.filter(w => weekDates.includes(w.date))
            const totalTss = weekWorkouts.reduce((sum, w) => sum + (w.tss ?? 0), 0)
            const totalMins = weekWorkouts.reduce((sum, w) => sum + w.duration_minutes, 0)
            return totalTss > 0 ? (
              <span className="text-sm text-gray-400">
                <span className="font-semibold text-gray-600">{totalTss}</span> TSS · <span className="font-semibold text-gray-600">{Math.round(totalMins / 60 * 10) / 10}h</span>
              </span>
            ) : totalMins > 0 ? (
              <span className="text-sm text-gray-400">
                <span className="font-semibold text-gray-600">{Math.round(totalMins / 60 * 10) / 10}h</span>
              </span>
            ) : null
          })()}
        </div>
        <p className="text-sm text-gray-400 mb-4">
          {weekDates[0].slice(8)} – {weekDates[6].slice(8)} {new Date(weekDates[0]).toLocaleString('en-GB', { month: 'long' })}
        </p>
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {weekDates.map((date, i) => {
              const dayWorkout = workouts.find(w => w.date === date)
              const dayEvent = events.find(e => e.date === date)
              const isToday = date === new Date().toISOString().split('T')[0]
              return (
                <div key={date} className="flex gap-4 items-start">
                  <div className="w-10 text-center pt-3">
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{days[i]}</div>
                    <div className={`text-xl font-extrabold tracking-tight mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{date.slice(8)}</div>
                  </div>
                  <DroppableDay date={date}>
                    {dayWorkout && dayWorkout.status === 'planned' ? (
                      <DraggableWorkoutCard workout={dayWorkout} onClick={() => setSelectedWorkout(dayWorkout)} />
                    ) : dayWorkout ? (
                      <WorkoutCard workout={dayWorkout} onClick={() => setSelectedWorkout(dayWorkout)} />
                    ) : null}
                    {dayEvent && (
                      <div className={`rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 ${EVENT_COLOURS[dayEvent.priority]}`}>
                        <div className="flex items-center gap-2">
                          <span>🏁</span>
                          <div>
                            <div className="font-semibold text-sm">{dayEvent.name}</div>
                            <div className="text-xs capitalize opacity-75">{dayEvent.type} · {dayEvent.priority} priority</div>
                          </div>
                        </div>
                      </div>
                    )}
                    {!dayWorkout && !dayEvent && (
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
          onFeedback={() => {
            setFeedbackWorkout(selectedWorkout)
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
        />
      )}

      {feedbackWorkout && (
        <FeedbackModal
          workout={feedbackWorkout}
          onClose={() => setFeedbackWorkout(null)}
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
