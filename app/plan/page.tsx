'use client'
import { useEffect, useRef, useState } from 'react'
import AddEventModal from '@/components/AddEventModal'
import AddUnavailabilityModal from '@/components/AddUnavailabilityModal'
import PlanDurationModal from '@/components/PlanDurationModal'
import PlanApprovalModal from '@/components/PlanApprovalModal'
import PlanReviewModal from '@/components/PlanReviewModal'
import ClearWorkoutsModal from '@/components/ClearWorkoutsModal'
import PlanChatModal from '@/components/PlanChatModal'
import InterviewModal from '@/components/InterviewModal'
import MethodologyModal from '@/components/MethodologyModal'
import { computeMethodology } from '@/lib/claude/methodology'
import PlanJourney from '@/components/plan/PlanJourney'
import ConsistencyStrip from '@/components/plan/ConsistencyStrip'
import LoadComparisonChart from '@/components/plan/LoadComparisonChart'
import FitnessTrendChart from '@/components/plan/FitnessTrendChart'
import CoachingLog from '@/components/plan/CoachingLog'
import { resolvePhases } from '@/lib/plan/phases'
import { buildWeekBuckets, weekState, consistency, planHours } from '@/lib/plan/progress'
import { buildForecast, daysBetweenUtc, addDaysUtc } from '@/lib/plan/forecast'
import WeightLogWidget from '@/components/WeightLogWidget'
import type { TrainingEvent, Workout, GeneratedPlan, ICUSyncData, UnavailabilityPeriod, PlanPhase, CoachingLogEntry, WeightEntry, TrainingPhilosophy } from '@/types'
import { periodDurationDays } from '@/lib/utils/unavailability'

type Tab = 'plan' | 'profile' | 'events'

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"

function formatMins(mins: number): string {
  if (mins === 0) return 'Rest'
  if (mins < 60) return `${mins}min`
  if (mins % 60 === 0) return `${mins / 60}h`
  return `${Math.floor(mins / 60)}h ${mins % 60}min`
}

function formatTimeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export default function PlanPage() {
  const [tab, setTab] = useState<Tab>('plan')

  // Profile state
  const [profileId, setProfileId] = useState<string | null>(null)
  const [goals, setGoals] = useState('')
  const [currentFtp, setCurrentFtp] = useState(200)
  const [weightKg, setWeightKg] = useState(70)
  const [schedule, setSchedule] = useState<Record<string, number>>(
    Object.fromEntries(DAYS.map(d => [d, 0]))
  )
  const [minSessions, setMinSessions] = useState(3)
  const [maxSessions, setMaxSessions] = useState(5)
  const [savedGoals, setSavedGoals] = useState('')
  const [savedFtp, setSavedFtp] = useState(200)
  const [savedWeight, setSavedWeight] = useState(70)
  const [savedSchedule, setSavedSchedule] = useState<Record<string, number>>(
    Object.fromEntries(DAYS.map(d => [d, 0]))
  )
  const [savedMinSessions, setSavedMinSessions] = useState(3)
  const [savedMaxSessions, setSavedMaxSessions] = useState(5)
  const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingGoals, setEditingGoals] = useState(false)
  const [editingStats, setEditingStats] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(false)
  const [editingFrequency, setEditingFrequency] = useState(false)

  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TrainingEvent | null>(null)
  const [deletingEvent, setDeletingEvent] = useState<string | null>(null)
  const [confirmingEvent, setConfirmingEvent] = useState<string | null>(null)

  const [unavailability, setUnavailability] = useState<UnavailabilityPeriod[]>([])
  const [showAddUnavailability, setShowAddUnavailability] = useState(false)
  const [editingPeriod, setEditingPeriod] = useState<UnavailabilityPeriod | null>(null)
  const [confirmingPeriod, setConfirmingPeriod] = useState<string | null>(null)
  const [deletingPeriod, setDeletingPeriod] = useState<string | null>(null)

  const [planName, setPlanName] = useState<string | null>(null)
  const [planWorkouts, setPlanWorkouts] = useState<Workout[]>([])
  const [planTargetEvent, setPlanTargetEvent] = useState('')
  const [planTargetDate, setPlanTargetDate] = useState('')
  const [planCreatedAt, setPlanCreatedAt] = useState('')
  const [planTotalWeeks, setPlanTotalWeeks] = useState<number | null>(null)
  const [planWeekPhases, setPlanWeekPhases] = useState<PlanPhase[] | null>(null)
  const [coachingLog, setCoachingLog] = useState<CoachingLogEntry[]>([])
  const [futurePlanWorkouts, setFuturePlanWorkouts] = useState<Workout[]>([])
  const [planChatOpen, setPlanChatOpen] = useState(false)
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showDurationPrompt, setShowDurationPrompt] = useState(false)
  const [showInterviewOffer, setShowInterviewOffer] = useState(false)
  const [showInterview, setShowInterview] = useState(false)
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [showClearModal, setShowClearModal] = useState(false)
  const [planGenNote, setPlanGenNote] = useState('')
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)
  const [planWeeks, setPlanWeeks] = useState(6)
  const [workoutsFound, setWorkoutsFound] = useState(0)
  const [estimatedWorkouts, setEstimatedWorkouts] = useState(0)

  // Adaptation (plan review after event changes)
  const reviewAbortRef = useRef<AbortController | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewPlan, setReviewPlan] = useState<GeneratedPlan | null>(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewWorkoutsFound, setReviewWorkoutsFound] = useState(0)
  const [reviewEstimatedWorkouts, setReviewEstimatedWorkouts] = useState(0)
  const [pendingAdaptNote, setPendingAdaptNote] = useState<string | null>(null)
  const [coachBrief, setCoachBrief] = useState<{ content: string; generated_at: string } | null>(null)
  const [showMethodologyModal, setShowMethodologyModal] = useState(false)
  const [methodologyRecommendation, setMethodologyRecommendation] = useState<TrainingPhilosophy | null>(null)
  const [trainingPhilosophy, setTrainingPhilosophy] = useState<TrainingPhilosophy | null>(null)
  const [showPhilosophyBanner, setShowPhilosophyBanner] = useState(false)
  const [planPhilosophy, setPlanPhilosophy] = useState<TrainingPhilosophy | null>(null)

  // Fix 1: timer ref to avoid unmount leak and double-save race
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function latestWellness() {
    const w = syncData?.wellness
    return w && w.length ? w[w.length - 1] : null
  }

  function loadPlan() {
    fetch('/api/plan')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setPlanName(data?.name ?? null)
        setPlanWorkouts(data?.workouts ?? [])
        if (data?.target_event_name) setPlanTargetEvent(data.target_event_name)
        if (data?.target_event_date) setPlanTargetDate(data.target_event_date)
        if (data?.created_at) setPlanCreatedAt(data.created_at)
        if (data?.plan_weeks) setPlanTotalWeeks(data.plan_weeks)
        setPlanWeekPhases(data?.week_phases ?? null)
        const today = new Date().toISOString().split('T')[0]
        setFuturePlanWorkouts((data?.workouts ?? []).filter((w: Workout) => w.date >= today && w.status === 'planned'))
        const hasPhilosophy = !!(data?.training_philosophy)
        const hasPlan = !!(data?.workouts?.length || data?.plan_weeks)
        setShowPhilosophyBanner(hasPlan && !hasPhilosophy)
        setPlanPhilosophy(data?.training_philosophy ?? null)
      })
      .catch(() => {})
  }

  async function startAdaptation(note: string) {
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
            if (msg.type === 'total') setReviewEstimatedWorkouts(msg.count)
            if (msg.type === 'progress') setReviewWorkoutsFound(msg.found)
            if (msg.type === 'done') { setReviewPlan(msg.plan); setReviewLoading(false) }
            if (msg.type === 'error') setReviewLoading(false)
          } catch { /* ignore */ }
        }
      }
      if (buf.trim()) {
        try {
          const msg = JSON.parse(buf)
          if (msg.type === 'done') { setReviewPlan(msg.plan); setReviewLoading(false) }
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setReviewLoading(false)
    }
  }

  function handleInterviewComplete(brief: string) {
    setPlanGenNote(brief)
    setShowInterview(false)

    const weeklyHours = Object.values(schedule).reduce((sum: number, mins: unknown) => sum + (mins as number), 0) / 60
    const today = new Date().toISOString().split('T')[0]
    const nearestPriorityEvent = [...events]
      .filter(e => e.date >= today && (e.priority === 'A' || e.priority === 'B'))
      .sort((a, b) => a.date.localeCompare(b.date))[0]
      ?? [...events].filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
      ?? null

    if (!nearestPriorityEvent) {
      setShowDurationPrompt(true)
      return
    }

    const weeksToEvent = Math.max(1, Math.ceil(
      (new Date(nearestPriorityEvent.date).getTime() - new Date(today).getTime()) / (7 * 24 * 60 * 60 * 1000)
    ))

    const recommendation = computeMethodology({
      weeklyHours,
      weeksToEvent,
      eventType: nearestPriorityEvent.type,
      eventPriority: nearestPriorityEvent.priority,
      currentCTL: syncData?.wellness?.length
        ? syncData.wellness[syncData.wellness.length - 1].ctl ?? null
        : null,
      goals: goals ?? '',
    })

    setMethodologyRecommendation(recommendation)
    setShowMethodologyModal(true)
  }

  async function handleMethodologyConfirm(philosophy: TrainingPhilosophy) {
    setTrainingPhilosophy(philosophy)
    setShowMethodologyModal(false)

    if (showPhilosophyBanner) {
      setShowPhilosophyBanner(false)
      const res = await fetch('/api/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ training_philosophy: philosophy }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSaveError(body.error ?? `Failed to save philosophy (${res.status})`)
        setShowPhilosophyBanner(true)
        return
      }
      startAdaptation(
        `Re-evaluating remaining sessions with ${philosophy.label}. Apply the Friel phase distribution rules and session type caps to restructure the remaining workouts.`
      )
      return
    }

    setShowDurationPrompt(true)
  }

  function handlePhilosophyReeval() {
    const weeklyHours = Object.values(schedule).reduce((sum: number, mins: unknown) => sum + (mins as number), 0) / 60
    const today = new Date().toISOString().split('T')[0]
    const nearestEvent = [...events]
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null

    if (!nearestEvent) return
    const weeksToEvent = Math.max(1, Math.ceil(
      (new Date(nearestEvent.date).getTime() - new Date(today).getTime()) / (7 * 24 * 60 * 60 * 1000)
    ))

    const recommendation = computeMethodology({
      weeklyHours,
      weeksToEvent,
      eventType: nearestEvent.type,
      eventPriority: nearestEvent.priority,
      currentCTL: syncData?.wellness?.length
        ? syncData.wellness[syncData.wellness.length - 1].ctl ?? null
        : null,
      goals: goals ?? '',
    })
    setMethodologyRecommendation(recommendation)
    setShowMethodologyModal(true)
  }

  async function handleAdaptationApprove() {
    setShowReviewModal(false)
    setReviewPlan(null)
    // If the plan target was cleared when the event was deleted, repopulate with the next upcoming event
    if (!planTargetDate) {
      const today = new Date().toISOString().split('T')[0]
      const next = [...events].filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
      if (next) {
        await fetch('/api/plan/target', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_event_name: next.name, target_event_date: next.date }),
        }).catch(() => {})
        setPlanTargetEvent(next.name)
        setPlanTargetDate(next.date)
      }
    }
    loadPlan()
  }

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (!data?.id) return
        setProfileId(data.id)
        const g = data.goals ?? ''
        const ftp = data.current_ftp ?? 200
        const wt = data.weight_kg ?? 70
        const avail: Array<{ day: string; duration_minutes: number }> = data.weekly_availability ?? []
        const sched = Object.fromEntries(DAYS.map(d => [d, avail.find(a => a.day === d)?.duration_minutes ?? 0]))
        const minSess = data.min_sessions_per_week ?? 3
        const maxSess = data.max_sessions_per_week ?? 5
        setGoals(g); setSavedGoals(g)
        setCurrentFtp(ftp); setSavedFtp(ftp)
        setWeightKg(wt); setSavedWeight(wt)
        setSchedule(sched); setSavedSchedule(sched)
        setMinSessions(minSess); setSavedMinSessions(minSess)
        setMaxSessions(maxSess); setSavedMaxSessions(maxSess)
        setEvents(data.events ?? [])
        setUnavailability(data.unavailability ?? [])
      })
      // Fix 2: surface load errors instead of silently swallowing them
      .catch(() => setLoadError('Failed to load profile'))

    fetch('/api/weight-log')
      .then(r => r.json())
      .then(d => setWeightLog(d.entries ?? []))
      .catch(() => {})

    loadPlan()

    fetch('/api/feedback')
      .then(r => r.ok ? r.json() : null)
      .then(data => setCoachingLog(data?.entries ?? []))
      .catch(() => {})

    fetch('/api/sync', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setSyncData(data) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/progress-brief')
      .then(r => r.ok ? r.json() : null)
      .then(d => setCoachBrief(d ? { content: d.content, generated_at: d.generated_at } : null))
      .catch(() => {})
  }, [])

  // Fix 1: cleanup effect for the saved timer
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  async function saveProfile(): Promise<boolean> {
    setSaving(true)
    setSaveError(null)
    try {
      const weekly_availability = DAYS
        .filter(d => (schedule[d] ?? 0) > 0)
        .map(d => ({ day: d, duration_minutes: schedule[d] }))
      const body = profileId
        ? { id: profileId, goals, current_ftp: currentFtp, weight_kg: weightKg, weekly_availability, min_sessions_per_week: minSessions, max_sessions_per_week: maxSessions }
        : { goals, current_ftp: currentFtp, weight_kg: weightKg, weekly_availability, min_sessions_per_week: minSessions, max_sessions_per_week: maxSessions }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Save failed')
        return false
      }
      setSavedGoals(goals)
      setSavedFtp(currentFtp)
      setSavedWeight(weightKg)
      setSavedSchedule({ ...schedule })
      setSavedMinSessions(minSessions)
      setSavedMaxSessions(maxSessions)
      setSaved(true)
      // Fix 1: clear any existing timer before setting a new one
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
      return true
    } catch {
      setSaveError('Network error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function syncEvents() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/events/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSyncResult(`Error: ${data.error ?? 'Sync failed'}`); return }
      setEvents(prev => data.events ?? prev)
      setSyncResult(data.added > 0 ? `Added ${data.added} event(s) from intervals.icu` : 'No new events found')
    } catch { setSyncResult('Network error') }
    finally { setSyncing(false) }
  }

  async function deleteEvent(name: string, date: string) {
    const key = `${name}|${date}`
    setDeletingEvent(key)
    try {
      const res = await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date }),
      })
      const data = await res.json()
      if (!res.ok) { setSyncResult(`Error deleting event: ${data.error ?? 'Failed'}`); return }
      setEvents(ev => ev.filter(e => !(e.name === name && e.date === date)))
      // If the deleted event was the plan's target, clear those fields from the plan record
      if (planName && planTargetDate === date && planTargetEvent === name) {
        fetch('/api/plan/target', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_event_name: '', target_event_date: '' }),
        }).catch(() => {})
        setPlanTargetEvent('')
        setPlanTargetDate('')
      }
      if (planName) {
        setPendingAdaptNote(`The event "${name}" on ${date} has been removed — please adapt the training plan accordingly.`)
      }
    } catch { setSyncResult('Network error') }
    finally { setDeletingEvent(null); setConfirmingEvent(null) }
  }

  async function addEvent(event: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to save event')
    setEvents(ev => [...ev, data.event])
    if (data.icu_error) setSyncResult(`Event saved, but intervals.icu sync failed: ${data.icu_error}`)
    else if (data.synced_to_icu) setSyncResult('Event saved and synced to intervals.icu')
  }

  async function updateEvent(original: TrainingEvent, updated: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original_name: original.name, original_date: original.date, ...updated }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to update event')
    setEvents(ev => ev.map(e => e.name === original.name && e.date === original.date ? data.event : e))
    if (data.icu_error) setSyncResult(`Event updated, but intervals.icu sync failed: ${data.icu_error}`)
  }

  async function deletePeriod(id: string) {
    setDeletingPeriod(id)
    try {
      const res = await fetch('/api/unavailability/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) { const d = await res.json(); setSyncResult(`Error: ${d.error ?? 'Delete failed'}`); return }
      setUnavailability(prev => prev.filter(p => p.id !== id))
    } catch { setSyncResult('Network error') }
    finally { setDeletingPeriod(null); setConfirmingPeriod(null) }
  }

  function handlePeriodSaved(period: UnavailabilityPeriod, impactPlan: boolean) {
    setUnavailability(prev => {
      const idx = prev.findIndex(p => p.id === period.id)
      if (idx !== -1) { const next = [...prev]; next[idx] = period; return next }
      return [...prev, period]
    })
    setShowAddUnavailability(false)
    setEditingPeriod(null)
    if (impactPlan && planName) {
      const label = period.type.charAt(0).toUpperCase() + period.type.slice(1)
      const note = period.notes ? `${label}: ${period.notes}` : label
      startAdaptation(`I've added a ${note} period from ${period.start_date} to ${period.end_date}. Please adapt my training plan around it.`)
    }
  }

  function weekNumber(): { current: number; total: number } | null {
    if (!planCreatedAt) return null
    const planOnly = planWorkouts.filter(w => w.plan_id !== null)
    if (planOnly.length === 0) return null
    const start = new Date(planCreatedAt)
    // Use the stored week count if available; fall back to deriving from last workout date
    let total: number
    if (planTotalWeeks) {
      total = planTotalWeeks
    } else {
      const dates = planOnly.map(w => w.date).sort()
      const end = new Date(dates[dates.length - 1])
      total = Math.floor((end.getTime() - start.getTime()) / (7 * 864e5)) + 1
    }
    const today = new Date()
    const current = Math.max(1, Math.min(total, Math.floor((today.getTime() - start.getTime()) / (7 * 864e5)) + 1))
    return { current, total }
  }

  function nextEvent(): { days: number; name: string } | null {
    const upcoming = events
      .map(e => ({ days: Math.ceil((new Date(e.date).getTime() - Date.now()) / 864e5), name: e.name }))
      .filter(e => e.days > 0)
      .sort((a, b) => a.days - b.days)
    return upcoming[0] ?? null
  }

  async function startPlanGeneration(weeks: number, startDate: string, notes: string) {
    setShowDurationPrompt(false)
    setPlanGenNote('')
    setPlanWeeks(weeks)
    setGenerating(true)
    setWorkoutsFound(0)
    setEstimatedWorkouts(0)
    setSaveError(null)
    try {
      const profileSaved = await saveProfile()
      if (!profileSaved) { setGenerating(false); return }
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncData, weeks, startDate, notes, training_philosophy: trainingPhilosophy }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? 'Plan generation failed')
        return
      }
      if (!res.body) { setSaveError('No response from server'); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'total') setEstimatedWorkouts(event.count)
            else if (event.type === 'progress') setWorkoutsFound(event.found)
            else if (event.type === 'done') setGeneratedPlan(event.plan)
            else if (event.type === 'error') setSaveError(event.message)
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch { setSaveError('Network error during plan generation') }
    finally { setGenerating(false) }
  }

  async function clearFutureWorkouts(): Promise<string> {
    try {
      const res = await fetch('/api/workouts/clear-future', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return `Error: ${data.error ?? 'Failed'}`
      return `Plan archived and ${data.deleted} workout${data.deleted !== 1 ? 's' : ''} deleted${data.failed ? ` (${data.failed} failed to remove from intervals.icu)` : ''}`
    } catch { return 'Error: Network error' }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Training Plan</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your plan, profile, and events</p>
      </div>

      <div className="flex border-b border-slate-200">
        {([['plan', 'My Plan'], ['profile', 'Profile & Schedule'], ['events', 'Events']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as Tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* MY PLAN TAB */}
      <div data-testid="tab-plan" style={{ display: tab === 'plan' ? 'block' : 'none' }}>
        {planName ? (() => {
          const wk = weekNumber()
          const next = nextEvent()
          const planStart = planCreatedAt ? planCreatedAt.split('T')[0] : ''
          const totalWeeks = wk?.total ?? 0
          const currentWeek = wk ? wk.current - 1 : 0
          const buckets = planStart && totalWeeks > 0
            ? buildWeekBuckets(planWorkouts, syncData?.activities ?? [], planStart, totalWeeks)
            : []
          const phases = resolvePhases(planWeekPhases, buckets.map(b => b.plannedTss), totalWeeks)
          const states = buckets.map(b => weekState(b, currentWeek))
          const cons = consistency(buckets, currentWeek)
          const hours = planHours(planWorkouts, syncData?.activities ?? [])
          const totalPlanned = buckets.reduce((sum, b) => sum + b.plannedSessions, 0)
          const currentPhase = phases[currentWeek] ?? 'base'
          const phaseLabel = currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1)
          const fitPoints = (syncData?.wellness ?? [])
            .filter(w => planStart && w.id >= planStart && w.ctl != null)
            .map(w => ({ date: w.id, ctl: w.ctl as number, form: w.form ?? 0 }))
          const today = new Date().toISOString().split('T')[0]
          const startCtl = fitPoints.length ? fitPoints[fitPoints.length - 1].ctl : null
          const planEnd = planStart && totalWeeks > 0 ? addDaysUtc(planStart, totalWeeks * 7) : ''
          const horizonTarget = planTargetDate && planTargetDate > today
            ? planTargetDate
            : planEnd
          const horizonDays = startCtl != null && horizonTarget
            ? Math.max(0, daysBetweenUtc(today, horizonTarget))
            : 0
          const forecast = startCtl != null && buckets.length > 0 && horizonDays > 0
            ? buildForecast({ startCtl, buckets, planStart, today, horizonDays, hitPct: cons.hitPct })
            : null
          return (
            <div className="space-y-4">
              {showPhilosophyBanner && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-blue-700">New: Coaching philosophy</p>
                    <p className="text-xs text-blue-600 mt-0.5">Your plan predates the coaching philosophy feature. Re-evaluate remaining sessions with Friel periodization?</p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePhilosophyReeval}
                    className="text-xs font-semibold text-blue-700 bg-blue-100 rounded-lg px-3 py-1.5 hover:bg-blue-200 transition-colors shrink-0 min-h-[44px] flex items-center"
                  >
                    Apply
                  </button>
                </div>
              )}
              <div className="bg-gradient-to-br from-blue-700 to-blue-600 rounded-2xl p-5 text-white shadow-md">
                <p className="text-xs font-bold tracking-widest opacity-60 uppercase mb-2">Active Plan</p>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-xl font-extrabold tracking-tight">{planName}</p>
                  <button
                    onClick={() => setPlanChatOpen(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/20 hover:bg-white/30 text-white rounded-full px-3 py-1.5 transition-colors shrink-0"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                    </svg>
                    Chat with coach
                  </button>
                </div>
                {wk && (
                  <PlanJourney
                    states={states}
                    phases={phases}
                    weekLabel={`Wk ${wk.current} of ${wk.total}`}
                    phaseLabel={phaseLabel}
                    eventName={next?.name ?? null}
                    daysToEvent={next?.days ?? null}
                  />
                )}
              </div>

              {coachBrief && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm text-green-900 leading-relaxed">{coachBrief.content}</p>
                  <p className="text-xs text-green-500 mt-2">Updated {formatTimeAgo(coachBrief.generated_at)}</p>
                </div>
              )}

              {totalPlanned > 0 && (
                <ConsistencyStrip hitPct={cons.hitPct} streak={cons.streak} hours={hours} />
              )}
              {buckets.length > 0 && (
                <LoadComparisonChart weeks={buckets} currentWeek={currentWeek} />
              )}
              <FitnessTrendChart points={fitPoints} forecast={forecast} />
              <CoachingLog entries={coachingLog} />

              <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50">
                  <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Plan actions</h2>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-sm text-slate-500">
                    Building a new plan will archive the current one and replace all future planned workouts.
                  </p>
                  {saveError && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</p>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={() => setShowReplaceConfirm(true)}
                      disabled={generating || events.length === 0}
                      title={events.length === 0 ? 'Add at least one event first' : undefined}
                      className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {generating ? 'Generating plan…' : 'Build New Plan'}
                    </button>
                    <button
                      onClick={() => setShowClearModal(true)}
                      className="bg-red-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                    >
                      Delete Plan
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })() : (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center space-y-3">
            <p className="text-slate-500 font-medium">No active plan</p>
            <p className="text-sm text-slate-400">Add events on the Events tab, then build your first training plan.</p>
            {saveError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</p>
            )}
            <button
              onClick={() => events.length > 0 ? setShowInterviewOffer(true) : setTab('events')}
              disabled={generating}
              className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm mt-2"
            >
              {events.length > 0 ? (generating ? 'Generating plan…' : 'Build New Plan') : 'Add an event first'}
            </button>
          </div>
        )}

        {showReplaceConfirm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Replace active plan?</h2>
              <p className="text-sm text-slate-500">
                You have an active plan: <span className="font-semibold text-slate-700">{planName}</span>.
                Building a new plan will archive it and replace all future planned workouts.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowReplaceConfirm(false)}
                  className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                >Cancel</button>
                <button
                  onClick={() => { setShowReplaceConfirm(false); setShowInterviewOffer(true) }}
                  className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >Continue</button>
              </div>
            </div>
          </div>
        )}

        {showInterviewOffer && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Chat with your coach first?</h2>
              <p className="text-sm text-slate-500">
                A two-minute conversation lets your coach tailor the plan to how you&apos;re feeling, any
                niggles, and what&apos;s coming up. You can talk or type. It&apos;s optional — skip to go
                straight to the plan settings.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowInterviewOffer(false); setShowDurationPrompt(true) }}
                  className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => { setShowInterviewOffer(false); setShowInterview(true) }}
                  className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Start chat
                </button>
              </div>
            </div>
          </div>
        )}

        {showInterview && (
          <InterviewModal
            wellness={latestWellness()}
            currentFTP={currentFtp}
            onClose={() => setShowInterview(false)}
            onComplete={handleInterviewComplete}
          />
        )}

        {showMethodologyModal && methodologyRecommendation && (
          <MethodologyModal
            recommendation={methodologyRecommendation}
            onConfirm={handleMethodologyConfirm}
            onClose={() => {
              setShowMethodologyModal(false)
              setShowDurationPrompt(true)
            }}
          />
        )}

        {showDurationPrompt && (
          <PlanDurationModal
            onStart={startPlanGeneration}
            onCancel={() => {
              setShowDurationPrompt(false)
              setPlanGenNote('')
            }}
            initialNotes={planGenNote}
          />
        )}

        {(generating || generatedPlan) && (
          <PlanApprovalModal
            plan={generatedPlan}
            loading={generating}
            weeks={planWeeks}
            workoutsFound={workoutsFound}
            estimatedWorkouts={estimatedWorkouts}
            trainingPhilosophy={trainingPhilosophy}
            onApprove={() => { setGeneratedPlan(null); window.location.href = '/dashboard' }}
            onReject={() => setGeneratedPlan(null)}
          />
        )}

        {showClearModal && (
          <ClearWorkoutsModal onConfirm={clearFutureWorkouts} onClose={() => { setShowClearModal(false); loadPlan() }} />
        )}

        {planChatOpen && planName && (
          <PlanChatModal
            planName={planName}
            targetEvent={planTargetEvent}
            targetDate={planTargetDate}
            futureWorkouts={futurePlanWorkouts}
            wellness={null}
            currentFTP={currentFtp}
            onClose={() => setPlanChatOpen(false)}
            onWorkoutsUpdated={() => { setPlanChatOpen(false); loadPlan() }}
          />
        )}
      </div>

      {/* PROFILE & SCHEDULE TAB */}
      <div data-testid="tab-profile" style={{ display: tab === 'profile' ? 'block' : 'none' }}>
        <div className="space-y-4">
          {loadError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{loadError}</div>
          )}
          {saveError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{saveError}</div>
          )}

          {/* Goals */}
          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Goals</h2>
              {editingGoals ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => { const ok = await saveProfile(); if (ok) setEditingGoals(false) }}
                    disabled={saving}
                    aria-label="Save goals"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                  >✓</button>
                  <button
                    onClick={() => { setGoals(savedGoals); setEditingGoals(false); setSaveError(null) }}
                    aria-label="Cancel"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
                  >✕</button>
                </div>
              ) : (
                <button onClick={() => setEditingGoals(true)} aria-label="Edit goals" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
              )}
            </div>
            {editingGoals ? (
              <textarea
                id="goals"
                value={goals}
                onChange={e => setGoals(e.target.value)}
                placeholder="Your goals (e.g. Complete Dragon Ride, improve FTP, lose 5kg)"
                rows={5}
                className={inputClass}
              />
            ) : goals ? (
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{goals}</p>
            ) : (
              <p className="text-sm text-slate-400 italic">No goals set yet.</p>
            )}
          </section>

          {/* Athlete stats */}
          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Athlete stats</h2>
              {editingStats ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => { const ok = await saveProfile(); if (ok) setEditingStats(false) }}
                    disabled={saving}
                    aria-label="Save stats"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                  >✓</button>
                  <button
                    onClick={() => { setCurrentFtp(savedFtp); setEditingStats(false); setSaveError(null) }}
                    aria-label="Cancel"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
                  >✕</button>
                </div>
              ) : (
                <button onClick={() => setEditingStats(true)} aria-label="Edit stats" className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
              )}
            </div>
            <div>
              {editingStats ? (
                <>
                  <label htmlFor="ftp" className={labelClass}>FTP (W)</label>
                  <input
                    id="ftp"
                    type="number"
                    value={currentFtp}
                    onChange={e => setCurrentFtp(Number(e.target.value))}
                    className={inputClass}
                  />
                </>
              ) : (
                <>
                  <p className={labelClass}>FTP (W)</p>
                  <p className="text-sm font-semibold text-slate-800">{currentFtp} W</p>
                </>
              )}
            </div>
            <div>
              <p className={labelClass}>Weight Log</p>
              <WeightLogWidget
                entries={weightLog}
                onEntriesChange={entries => {
                  setWeightLog(entries)
                  if (entries[0]) setWeightKg(entries[0].weight_kg)
                }}
              />
            </div>
          </section>

          {/* Weekly schedule */}
          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Weekly Availability</h2>
              {editingSchedule ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => { const ok = await saveProfile(); if (ok) setEditingSchedule(false) }}
                    disabled={saving}
                    aria-label="Save schedule"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                  >✓</button>
                  <button
                    onClick={() => { setSchedule({ ...savedSchedule }); setEditingSchedule(false); setSaveError(null) }}
                    aria-label="Cancel"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
                  >✕</button>
                </div>
              ) : (
                <button onClick={() => setEditingSchedule(true)} className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
              )}
            </div>
            {editingSchedule ? (
              <>
                <p className="text-xs text-slate-400">Set the maximum time available each day. Sessions will be as long as the training needs — up to this limit.</p>
                <div className="space-y-3">
                  {DAYS.map((day, i) => {
                    const mins = schedule[day] ?? 0
                    return (
                      <div key={day} className="flex items-center gap-3">
                        <span className="text-sm text-slate-600 w-8 shrink-0">{DAY_LABELS[i]}</span>
                        <input
                          type="range"
                          min={0}
                          max={360}
                          step={15}
                          aria-label={`${DAY_LABELS[i]} training minutes`}
                          value={mins}
                          onChange={e => setSchedule(s => ({ ...s, [day]: Number(e.target.value) }))}
                          className="flex-1 accent-blue-600"
                        />
                        <span className={`text-xs w-14 text-right font-medium ${mins === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                          {formatMins(mins)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {DAYS.map((day, i) => {
                  const mins = schedule[day] ?? 0
                  return (
                    <div key={day} className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">{DAY_LABELS[i]}</span>
                      <span className={`text-sm font-medium ${mins === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                        {formatMins(mins)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Session frequency */}
          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Session frequency</h2>
              {editingFrequency ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => { const ok = await saveProfile(); if (ok) setEditingFrequency(false) }}
                    disabled={saving}
                    aria-label="Save frequency"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                  >✓</button>
                  <button
                    onClick={() => { setMinSessions(savedMinSessions); setMaxSessions(savedMaxSessions); setEditingFrequency(false); setSaveError(null) }}
                    aria-label="Cancel"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 transition-colors"
                  >✕</button>
                </div>
              ) : (
                <button onClick={() => setEditingFrequency(true)} className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>
              )}
            </div>
            {editingFrequency ? (
              <>
                <p className="text-xs text-slate-400">How many sessions per week to aim for. Claude will target this range, prioritising quality over hitting a number.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Minimum sessions</label>
                    <select
                      value={minSessions}
                      onChange={e => {
                        const v = Number(e.target.value)
                        setMinSessions(v)
                        if (v > maxSessions) setMaxSessions(v)
                      }}
                      className={inputClass}
                    >
                      {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Maximum sessions</label>
                    <select
                      value={maxSessions}
                      onChange={e => {
                        const v = Number(e.target.value)
                        setMaxSessions(v)
                        if (v < minSessions) setMinSessions(v)
                      }}
                      className={inputClass}
                    >
                      {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-700">
                <span className="font-semibold">{minSessions}–{maxSessions}</span>
                <span className="text-slate-500"> sessions per week</span>
              </p>
            )}
          </section>
        </div>
      </div>

      {/* EVENTS TAB */}
      <div data-testid="tab-events" style={{ display: tab === 'events' ? 'block' : 'none' }}>
        <div className="space-y-4">
          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Events</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={syncEvents}
                  disabled={syncing}
                  className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
                >
                  {syncing ? 'Syncing…' : 'Sync from intervals.icu'}
                </button>
                <button
                  onClick={() => setShowAddEvent(true)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  + Add event
                </button>
              </div>
            </div>
            {syncResult && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{syncResult}</p>
            )}
            {events.length === 0 && (
              <p className="text-sm text-slate-400">No events yet. Add one to start planning.</p>
            )}
            {[...events].sort((a, b) => a.date.localeCompare(b.date)).map((event, i) => {
              const key = `${event.name}|${event.date}`
              const today = new Date().toISOString().split('T')[0]
              const diffDays = Math.round((new Date(event.date).getTime() - new Date(today).getTime()) / 864e5)
              const absDays = Math.abs(diffDays)
              const weeksStr = absDays >= 14 ? ` / ${Math.floor(absDays / 7)}w` : ''
              const countdown = diffDays === 0 ? 'Today!' : diffDays === 1 ? 'Tomorrow' : diffDays > 0 ? `In ${diffDays}d${weeksStr}` : `${absDays}d${weeksStr} ago`
              const countdownColor = diffDays < 0 ? 'text-slate-400' : diffDays === 0 ? 'text-green-600 font-semibold' : diffDays <= 7 ? 'text-amber-600' : 'text-slate-500'
              return (
                <div key={key} className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{event.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {event.date} · {event.type} · Priority {event.priority}
                    </p>
                    <p className={`text-xs mt-0.5 ${countdownColor}`}>{countdown}</p>
                    {event.icu_event_id && <p className="text-xs text-green-600 mt-0.5">↑ synced to intervals.icu</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {diffDays < 0 ? (
                      /* Past events are done — no longer editable or deletable */
                      <span className="text-xs font-medium text-slate-300">Done</span>
                    ) : (
                      <>
                        <button
                          onClick={() => setEditingEvent(event)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                        >Edit</button>
                        {confirmingEvent === key ? (
                          <>
                            <span className="text-xs text-slate-600">Delete?</span>
                            <button
                              onClick={() => deleteEvent(event.name, event.date)}
                              disabled={deletingEvent === key}
                              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                            >{deletingEvent === key ? 'Deleting…' : 'Yes'}</button>
                            <button
                              onClick={() => setConfirmingEvent(null)}
                              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                            >Cancel</button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmingEvent(key)}
                            className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                          >Delete</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
          <p className="text-xs text-slate-400 px-1">
            A-priority events trigger a taper in your plan. B-priority events are treated as hard training days.
          </p>

          <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Unavailability Periods</h2>
              <button
                onClick={() => setShowAddUnavailability(true)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                + Add period
              </button>
            </div>
            {unavailability.length === 0 && (
              <p className="text-sm text-slate-400">No unavailability periods. Add one when sick, injured or away.</p>
            )}
            {[...unavailability].sort((a, b) => a.start_date.localeCompare(b.start_date)).map(period => {
              const TYPE_ICONS: Record<string, string> = { sick: '🤒', injury: '🤕', holiday: '🏖️', unavailable: '🚫' }
              const icon = TYPE_ICONS[period.type] ?? '🚫'
              const label = period.type.charAt(0).toUpperCase() + period.type.slice(1)
              const days = periodDurationDays(period)
              const dateRange = period.start_date === period.end_date
                ? period.start_date
                : `${period.start_date} – ${period.end_date}`
              return (
                <div key={period.id} className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{icon} {label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{dateRange} · {days} day{days !== 1 ? 's' : ''}</p>
                    {period.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{period.notes}</p>}
                    <p className="text-xs mt-0.5">
                      {period.impact_plan
                        ? <span className="text-amber-600 font-medium">● impacts plan</span>
                        : <span className="text-slate-400">○ info only</span>}
                      {period.icu_event_id && <span className="ml-2 text-green-600">↑ synced</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => setEditingPeriod(period)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >Edit</button>
                    {confirmingPeriod === period.id ? (
                      <>
                        <span className="text-xs text-slate-600">Delete?</span>
                        <button
                          onClick={() => deletePeriod(period.id)}
                          disabled={deletingPeriod === period.id}
                          className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                        >{deletingPeriod === period.id ? 'Deleting…' : 'Yes'}</button>
                        <button
                          onClick={() => setConfirmingPeriod(null)}
                          className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                        >Cancel</button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmingPeriod(period.id)}
                        className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                      >Delete</button>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
        </div>

        {showAddEvent && (
          <AddEventModal
            onConfirm={addEvent}
            onClose={() => setShowAddEvent(false)}
            hasPlan={planName !== null}
            onRegenerate={(note) => startAdaptation(note)}
          />
        )}
        {editingEvent && (
          <AddEventModal
            initialEvent={editingEvent}
            onConfirm={updated => updateEvent(editingEvent, updated)}
            onClose={() => setEditingEvent(null)}
            hasPlan={planName !== null}
            onRegenerate={(note) => startAdaptation(note)}
          />
        )}
        {showAddUnavailability && (
          <AddUnavailabilityModal
            onClose={() => setShowAddUnavailability(false)}
            onSaved={handlePeriodSaved}
          />
        )}
        {editingPeriod && (
          <AddUnavailabilityModal
            period={editingPeriod}
            onClose={() => setEditingPeriod(null)}
            onSaved={handlePeriodSaved}
          />
        )}

        {pendingAdaptNote && (
          <div className="fixed inset-x-0 bottom-0 z-40 p-4 sm:p-6">
            <div className="max-w-sm mx-auto bg-blue-600 text-white rounded-2xl shadow-xl px-5 py-4 space-y-3">
              <p className="text-sm font-semibold">Adapt your training plan?</p>
              <p className="text-xs text-blue-100">
                This event change may affect your upcoming schedule. Claude can adjust your future workouts to account for it.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { const note = pendingAdaptNote; setPendingAdaptNote(null); startAdaptation(note) }}
                  className="flex-1 bg-white text-blue-700 text-sm font-semibold py-2 rounded-xl hover:bg-blue-50 transition-colors"
                >
                  Adapt plan
                </button>
                <button
                  onClick={() => setPendingAdaptNote(null)}
                  className="px-4 text-sm text-blue-200 hover:text-white transition-colors"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {showReviewModal && (
        <PlanReviewModal
          plan={reviewPlan}
          loading={reviewLoading}
          workoutsFound={reviewWorkoutsFound}
          estimatedWorkouts={reviewEstimatedWorkouts}
          onApprove={handleAdaptationApprove}
          onReject={() => { setShowReviewModal(false); setReviewPlan(null) }}
        />
      )}
    </div>
  )
}
