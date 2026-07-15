'use client'
import { useEffect, useRef, useState } from 'react'
import MetricsBar from '@/components/MetricsBar'
import WorkoutCard from '@/components/WorkoutCard'
import CtlTrendStrip from '@/components/CtlTrendStrip'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent, ICUActivity, WeightEntry, WeeklyProgress, EventCountdown, WeatherSummary, ActivityWeather } from '@/types'
import { EVENT_COLOURS } from '@/lib/event-colours'
import WeeklyReviewBanner from '@/components/WeeklyReviewBanner'
import PlanReviewModal from '@/components/PlanReviewModal'
import { isoWeek } from '@/lib/iso-week'
import { getWeekBounds } from '@/lib/week-bounds'
import { localDateStr } from '@/lib/local-date'
import { computeDailyActivityLoad } from '@/lib/strain'
import { computeHrvBaseline } from '@/lib/hrv/baseline'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import { estimateTss } from '@/lib/estimate-tss'
import { isSessionCountable, isSessionCompleted } from '@/lib/progress/session-counting'
import { isGarminSyncStale, formatGarminSyncTime } from '@/lib/garmin/sync-staleness'
import { formatRelativeSyncTime } from '@/lib/format-sync-time'
import { eventCoversDate } from '@/lib/events'
import type { GeneratedPlan } from '@/types'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
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
import ActivityDetailModal from '@/components/ActivityDetailModal'
import HrvStatusChip from '@/components/HrvStatusChip'
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'
import ProgressStats from '@/components/ProgressStats'
import WellnessCard from '@/components/WellnessCard'
import WellnessSheet from '@/components/WellnessSheet'
import type { DailyWellness } from '@/types'
import AnimatedLogo from '@/components/AnimatedLogo'
import DayWeatherChip from '@/components/DayWeatherChip'


const SYNC_CACHE_KEY = 'cycling_coach_sync'

function DraggableWorkoutCard({ workout, onClick, ftp, weather }: { workout: Workout; onClick: () => void; ftp?: number; weather?: ActivityWeather | null }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: workout.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="relative">
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-16 h-0.5 rounded-full bg-slate-300 pointer-events-none z-10" />
      <WorkoutCard workout={workout} onClick={onClick} ftp={ftp} weather={weather} />
      {/* Drag zone sits between the two grip bars; relays quick taps as card-open */}
      <div
        {...listeners}
        className="absolute inset-x-0 top-3 bottom-3 z-10 cursor-grab active:cursor-grabbing"
        onClick={onClick}
      />
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-16 h-0.5 rounded-full bg-slate-300 pointer-events-none z-10" />
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
  const [syncLogoVisible, setSyncLogoVisible] = useState(false)
  const [syncLogoExiting, setSyncLogoExiting] = useState(false)
  const syncExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
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
  const [effectiveMaxHr, setEffectiveMaxHr] = useState<number | null>(null)
  const [garminEmail, setGarminEmail] = useState<string | null>(null)
  const [garminLastSyncAt, setGarminLastSyncAt] = useState<string | null>(null)
  const [futurePlanWorkouts, setFuturePlanWorkouts] = useState<Workout[]>([])
  const [selectedEvent, setSelectedEvent] = useState<TrainingEvent | null>(null)
  const [editingEvent, setEditingEvent] = useState<TrainingEvent | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<ICUActivity | null>(null)
  const [strainSheetOpen, setStrainSheetOpen] = useState(false)
  const [chartsData, setChartsData] = useState<import('@/types').ChartsData | null>(null)
  const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
  const [syncVersion, setSyncVersion] = useState(0)
  const [dailyWellness, setDailyWellness] = useState<DailyWellness[]>([])
  const [wellnessSheetDate, setWellnessSheetDate] = useState<string | null>(null)
  const [weatherByDate, setWeatherByDate] = useState<Map<string, WeatherSummary>>(new Map())
  const [weatherByActivity, setWeatherByActivity] = useState<Map<string, ActivityWeather>>(new Map())

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
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
    if (syncExitTimerRef.current) clearTimeout(syncExitTimerRef.current)
    setSyncing(true)
    setSyncLogoVisible(true)
    setSyncLogoExiting(false)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const now = new Date()
        applySyncData(data, now)
        try {
          localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify({ syncedAt: now.toISOString(), data }))
        } catch { /* ignore storage errors */ }
        await loadPlan()
        await loadProfile()
        setSyncVersion(v => v + 1)
      }
    } finally {
      setSyncing(false)
      setSyncLogoExiting(true)
      syncExitTimerRef.current = setTimeout(() => {
        setSyncLogoVisible(false)
        setSyncLogoExiting(false)
      }, 400)
    }
  }

  function loadProfile() {
    return fetch('/api/profile').then(r => r.json()).then(data => {
      const name: string = data?.full_name ?? ''
      if (name) setFirstName(name.split(' ')[0])
      if (data?.events) setEvents(data.events)
      setNotificationsEnabled(data?.notifications_enabled ?? false)
      if (data?.current_ftp) setCurrentFTP(data.current_ftp)
      setEffectiveMaxHr(resolveMaxHrFromProfile(data)?.value ?? null)
      setGarminEmail(data?.garmin_email ?? null)
      setGarminLastSyncAt(data?.garmin_last_sync_at ?? null)
    }).catch(() => {})
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
      const countableLastWeek = lastWeek.filter(isSessionCountable)
      setLastWeekStats({
        completed: countableLastWeek.filter(isSessionCompleted).length,
        total: countableLastWeek.length,
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
    loadProfile()
    fetch('/api/weight-log')
      .then(r => r.json())
      .then(d => setWeightLog(d.entries ?? []))
      .catch(() => {})
    const wFrom = new Date(Date.now() - 45 * 864e5).toISOString().split('T')[0]
    const wTo = new Date(Date.now() + 45 * 864e5).toISOString().split('T')[0]
    fetch(`/api/wellness?from=${wFrom}&to=${wTo}`)
      .then(r => r.json())
      .then(({ wellness }) => { if (Array.isArray(wellness)) setDailyWellness(wellness) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/charts')
      .then(r => r.ok ? r.json() : null)
      .then(d => setChartsData(d?.charts ?? null))
      .catch(() => setChartsData(null))
  }, [])

  useEffect(() => {
    fetch('/api/weather/week')
      .then(r => r.ok ? r.json() : null)
      .then((d: { dates?: Array<{ date: string; weather: WeatherSummary | null }> } | null) => {
        if (!d?.dates) return
        const map = new Map<string, WeatherSummary>()
        for (const { date, weather } of d.dates) {
          if (weather) map.set(date, weather)
        }
        setWeatherByDate(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const completedIds = workouts
      .filter(w => w.status === 'completed' && w.icu_activity_id)
      .map(w => w.icu_activity_id!)

    if (!completedIds.length) return

    let cancelled = false
    Promise.all(
      completedIds.map(id =>
        fetch(`/api/weather/activity/${id}`)
          .then(r => r.ok ? r.json() : null)
          .then((d: ActivityWeather | null) => d ? [id, d] as const : null)
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return
      const map = new Map<string, ActivityWeather>()
      for (const r of results) { if (r) map.set(r[0], r[1]) }
      setWeatherByActivity(map)
    })

    return () => { cancelled = true }
  }, [workouts])

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
  const hrvStatus = computeHrvBaseline(wellnessArr)

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

  const todayStr = localDateStr(new Date())
  const todayActivityLoad = computeDailyActivityLoad(syncData?.activities ?? [], todayStr, currentFTP)
  const latestWellnessWithLoad: ICUWellness | null = latestWellness
    ? {
        ...latestWellness,
        garmin_training_load: todayActivityLoad > 0 ? todayActivityLoad : null,
        // Merge Garmin data from today's sync if available
        garmin_training_readiness: syncData?.garmin_today?.garmin_training_readiness ?? latestWellness.garmin_training_readiness,
        garmin_training_status: syncData?.garmin_today?.garmin_training_status ?? latestWellness.garmin_training_status,
        garmin_body_battery_current: syncData?.garmin_today?.garmin_body_battery_current ?? latestWellness.garmin_body_battery_current,
        garmin_stress_avg_direct: syncData?.garmin_today?.garmin_stress_avg ?? latestWellness.garmin_stress_avg_direct,
        garmin_hrv_overnight: syncData?.garmin_today?.garmin_hrv_overnight ?? latestWellness.garmin_hrv_overnight,
        garmin_hrv_status: syncData?.garmin_today?.garmin_hrv_status ?? latestWellness.garmin_hrv_status,
        garmin_resting_hr: syncData?.garmin_today?.garmin_resting_hr ?? latestWellness.garmin_resting_hr,
        garmin_sleep_deep_secs: syncData?.garmin_today?.garmin_sleep_deep_secs ?? latestWellness.garmin_sleep_deep_secs,
        garmin_sleep_light_secs: syncData?.garmin_today?.garmin_sleep_light_secs ?? latestWellness.garmin_sleep_light_secs,
        garmin_sleep_rem_secs: syncData?.garmin_today?.garmin_sleep_rem_secs ?? latestWellness.garmin_sleep_rem_secs,
        garmin_sleep_awake_secs: syncData?.garmin_today?.garmin_sleep_awake_secs ?? latestWellness.garmin_sleep_awake_secs,
        garmin_sleep_respiration_avg: syncData?.garmin_today?.garmin_sleep_respiration_avg ?? latestWellness.garmin_sleep_respiration_avg,
        garmin_body_battery_drained: syncData?.garmin_today?.garmin_body_battery_drained ?? latestWellness.garmin_body_battery_drained,
        garmin_body_battery_charged: syncData?.garmin_today?.garmin_body_battery_charged ?? latestWellness.garmin_body_battery_charged,
      }
    : null
  const todayActivities = (syncData?.activities ?? []).filter((a: ICUActivity) =>
    a.start_date_local.startsWith(todayStr)
  )
  const activitySummary: string | undefined = todayActivities.length > 0
    ? todayActivities.map((a: ICUActivity) => a.name).filter(Boolean).join(' · ') || undefined
    : undefined

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

  const weekWorkoutsWP = workouts.filter(w => weekDates.includes(w.date))
  const completedWP = weekWorkoutsWP.filter(w => w.status === 'completed')
  const countableSessionsWP = weekWorkoutsWP.filter(isSessionCountable)
  const linkedActivityIds = new Set(weekWorkoutsWP.map(w => w.icu_activity_id).filter((id): id is string => id != null))
  const recentCtl = [...(syncData?.wellness ?? [])].sort((a, b) => b.id.localeCompare(a.id)).find(w => w.ctl != null)?.ctl ?? null
  const weeklyProgress: WeeklyProgress | null = weekWorkoutsWP.length > 0 ? {
    sessionsCompleted: countableSessionsWP.filter(isSessionCompleted).length,
    sessionsTotal: countableSessionsWP.length,
    tssActual: Math.round(completedWP.filter(w => w.tss !== null).reduce((s, w) => s + (w.tss ?? 0), 0)),
    tssPlanned: weekWorkoutsWP.reduce((s, w) => s + estimateTss(w.type, w.duration_minutes), 0),
    distanceKm: Math.round(completedWP.reduce((s, w) => s + ((w.activity_metrics?.distance_m ?? 0) / 1000), 0) * 10) / 10,
    elevationM: Math.round(completedWP.reduce((s, w) => s + (w.activity_metrics?.elevation_m ?? 0), 0)),
    timePlannedMins: weekWorkoutsWP.reduce((s, w) => s + w.duration_minutes, 0),
    timeActualMins: completedWP.reduce((s, w) => s + (w.actual_duration_minutes ?? w.duration_minutes), 0),
    fitnessCtl: recentCtl !== null ? Math.round(recentCtl) : null,
    otherActivitiesCount: (syncData?.activities ?? [])
      .filter(a => weekDates.some(d => a.start_date_local.startsWith(d)) && !linkedActivityIds.has(a.id))
      .length,
  } : null

  const nearestEvent = events
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  const eventCountdown: EventCountdown | null = nearestEvent ? {
    name: nearestEvent.name,
    daysAway: Math.ceil(
      (new Date(nearestEvent.date).getTime() - new Date(todayStr).getTime())
      / (1000 * 60 * 60 * 24)
    ),
  } : null

  const upcomingEvents = events
    .filter(e => {
      const days = Math.ceil((new Date(e.date).getTime() - new Date(todayStr).getTime()) / 86400000)
      const endDays = Math.ceil((new Date(e.end_date ?? e.date).getTime() - new Date(todayStr).getTime()) / 86400000)
      return endDays >= 0 && days <= 90
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const upcomingTests = futurePlanWorkouts
    .filter(w => {
      const days = Math.ceil((new Date(w.date).getTime() - new Date(todayStr).getTime()) / 86400000)
      return w.type === 'test' && days <= 84
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const lastPlannedDate = futurePlanWorkouts.length > 0
    ? futurePlanWorkouts.reduce((latest, w) => w.date > latest ? w.date : latest, futurePlanWorkouts[0].date)
    : null
  const weeksRemainingInPlan = lastPlannedDate
    ? Math.ceil((new Date(lastPlannedDate).getTime() - new Date(todayStr).getTime()) / (7 * 86400000))
    : null

  const todayWellness = syncData?.wellness.find(w => w.id === todayStr)
  const recentWellness = [...(syncData?.wellness ?? [])]
    .sort((a, b) => b.id.localeCompare(a.id))
    .find(w => w.form !== null)
  const form: number | null = todayWellness?.form ?? recentWellness?.form ?? null

  function handleWellnessSaved(w: DailyWellness) {
    setDailyWellness(prev => {
      const idx = prev.findIndex(e => e.date === w.date)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = w
        return next
      }
      return [...prev, w].sort((a, b) => a.date.localeCompare(b.date))
    })
    setWellnessSheetDate(null)
  }

  function handleOpenWellness(date: string) {
    if (date > todayStr) return
    setWellnessSheetDate(date)
  }

  const todayDailyWellnessEntry = dailyWellness.find(w => w.date === todayStr)
  const todayDailyWellnessForCard = todayDailyWellnessEntry
    ? { energy: todayDailyWellnessEntry.energy, leg_freshness: todayDailyWellnessEntry.leg_freshness }
    : undefined

  const garminStale = !!garminEmail && isGarminSyncStale(garminLastSyncAt)
  const garminSyncLine = garminEmail
    ? (garminLastSyncAt ? `Garmin: synced ${formatRelativeSyncTime(new Date(garminLastSyncAt))}` : 'Garmin: not yet synced')
    : null
  const intervalsSyncLine = lastSyncedAt ? `Intervals: synced ${formatRelativeSyncTime(lastSyncedAt)}` : null

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

      {garminStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            ⚠️ {garminLastSyncAt
              ? `Garmin hasn't synced today — last synced ${formatGarminSyncTime(garminLastSyncAt)}. Today's sleep/HRV data may be based on yesterday's sync.`
              : "Garmin hasn't synced yet."}
          </p>
        </div>
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
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            onClick={doSync}
            disabled={syncing}
            className="relative overflow-hidden flex items-center justify-center gap-1.5 w-28 py-1.5 text-sm font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full hover:bg-blue-100 disabled:cursor-default transition-colors"
          >
            {syncLogoVisible && (
              <span className={syncLogoExiting
                ? 'animate-[sync-bike-exit_0.35s_ease-in_forwards]'
                : 'animate-[sync-bike-enter_0.3s_ease-out_forwards]'
              }>
                <AnimatedLogo size={18} spin={!syncLogoExiting} />
              </span>
            )}
            <span className={syncLogoExiting ? 'opacity-0 transition-opacity duration-200' : ''}>
              {syncLogoVisible ? 'Syncing' : '↻ Sync'}
            </span>
          </button>
          {(garminSyncLine || intervalsSyncLine) && (
            <div className="text-right">
              {garminSyncLine && (
                <p className={`text-[11px] leading-snug ${garminStale ? 'text-amber-600 font-semibold' : 'text-gray-500'}`}>
                  {garminStale && '⚠ '}{garminSyncLine}
                </p>
              )}
              {intervalsSyncLine && (
                <p className="text-[11px] leading-snug text-gray-500">{intervalsSyncLine}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Daily briefing */}
      <div className="space-y-3">
        {!notificationsEnabled && (
          <NotificationBanner onEnabled={() => setNotificationsEnabled(true)} />
        )}
        <TodayCard
          workout={todayWorkout}
          wellness={latestWellnessWithLoad}
          todayEvent={events.find(e => eventCoversDate(e, todayStr)) ?? null}
          extraSessionCount={todaySessionCount - 1}
          ftp={currentFTP}
          hrvBaseline={hrvStatus.baselineMean}
          todayDailyWellness={todayDailyWellnessForCard}
          onWorkoutClick={w => setSelectedWorkout(w)}
          onChatWithCoach={todayWorkout ? () => setChatWorkout(todayWorkout) : undefined}
        />
      </div>

      {latestWellnessWithLoad && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden divide-y divide-gray-200">
          <MetricsBar
            wellness={latestWellnessWithLoad}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
            todayDailyWellness={todayDailyWellnessForCard}
            wellnessHistory={wellnessArr}
          />
          <HrvStatusChip embedded />
          <CtlTrendStrip embedded chartsData={chartsData} />
        </div>
      )}

      <ProgressStats
        syncVersion={syncVersion}
        weeklyProgress={weeklyProgress}
        eventCountdown={eventCountdown}
        upcomingEvents={upcomingEvents}
        upcomingTests={upcomingTests}
        weeksRemainingInPlan={weeksRemainingInPlan}
        form={form}
        activities={chartsData?.activities}
      />

      <div>
        <div className="flex items-baseline justify-between mb-0.5">
          <h2 className="text-lg font-bold tracking-tight text-gray-900">This week</h2>
          {(() => {
            const weekWorkouts = workouts.filter(w => weekDates.includes(w.date))
            if (!weekWorkouts.length) return null
            const plannedTss = weekWorkouts.reduce((sum, w) => sum + estimateTss(w.type, w.duration_minutes), 0)
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
              const dayEvents = events.filter(e => eventCoversDate(e, date))

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
                    <DayWeatherChip weather={weatherByDate.get(date)} />
                  </div>
                  <DroppableDay date={date}>
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
                    {dayWorkouts.map(w => {
                      const linkedEvent = w.icu_activity_id ? eventByActivityId.get(w.icu_activity_id) : undefined
                      return (
                        <div key={w.id}>
                          {w.status === 'planned' ? (
                            <DraggableWorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
                          ) : (
                            <WorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
                          )}
                          {linkedEvent && (
                            <div className="relative ml-4 mt-1.5">
                              <div className="absolute -top-2 -left-3 h-6 w-3 border-l-2 border-b-2 border-gray-200 rounded-bl-md pointer-events-none" />
                              <button
                                onClick={() => setSelectedEvent(linkedEvent)}
                                className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-2.5 hover:brightness-95 transition-all ${EVENT_COLOURS[linkedEvent.priority]}`}
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
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {unplannedActivities.map(a => (
                      <ActivityCard key={a.id} activity={a} onClick={() => setSelectedActivity(a)} />
                    ))}
                    {isEmpty && (
                      <div className="text-sm text-gray-300 italic py-3.5 pl-1">Rest day</div>
                    )}
                    <WellnessCard
                      date={date}
                      today={todayStr}
                      wellness={dailyWellness.find(w => w.date === date)}
                      onTap={() => handleOpenWellness(date)}
                      restDay={isEmpty}
                    />
                  </DroppableDay>
                </div>
              )
            })}
          </div>
          <DragOverlay>
            {activeWorkout ? <WorkoutCard workout={activeWorkout} ftp={currentFTP} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          workoutsOnDate={workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)}
          onClose={() => setSelectedWorkout(null)}
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
          }}
          onClose={() => setEditingEvent(null)}
          hasPlan={!!planName}
          onRegenerate={(note) => startReview(note)}
        />
      )}

      {selectedActivity && (
        <ActivityDetailModal
          activity={selectedActivity}
          onClose={() => setSelectedActivity(null)}
          effectiveMaxHr={effectiveMaxHr}
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

      {strainSheetOpen && latestWellnessWithLoad && (
        <StrainBreakdownSheet
          wellness={latestWellnessWithLoad}
          activitySummary={activitySummary}
          hrvStatus={hrvStatus}
          todayDailyWellness={todayDailyWellnessForCard}
          onClose={() => setStrainSheetOpen(false)}
        />
      )}

      {wellnessSheetDate && (
        <WellnessSheet
          date={wellnessSheetDate}
          wellness={dailyWellness.find(w => w.date === wellnessSheetDate)}
          onClose={() => setWellnessSheetDate(null)}
          onSaved={handleWellnessSaved}
        />
      )}
    </div>
  )
}
