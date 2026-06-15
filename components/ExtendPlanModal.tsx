'use client'
import { useRef, useState } from 'react'
import { computeMethodology } from '@/lib/claude/methodology'
import type { GeneratedPlan, TrainingEvent, TrainingPhilosophy } from '@/types'

interface Props {
  planEndDate: string
  planCreatedAt: string
  planWeeks: number
  currentPhilosophy: TrainingPhilosophy | null
  weeklyHours: number
  events: TrainingEvent[]
  currentCTL: number | null
  onSuccess: () => void
  onClose: () => void
}

type Phase = 'select' | 'loading' | 'review' | 'applying'

const WEEK_CHIPS = [2, 4, 6, 8]

function weeksFromPlanEnd(eventDate: string, planEndDate: string): number {
  return Math.max(1, Math.ceil(
    (new Date(eventDate).getTime() - new Date(planEndDate).getTime()) / (7 * 86400000)
  ))
}

export default function ExtendPlanModal({
  planEndDate,
  planCreatedAt,
  planWeeks,
  currentPhilosophy,
  weeklyHours,
  events,
  currentCTL,
  onSuccess,
  onClose,
}: Props) {
  const today = new Date().toISOString().split('T')[0]

  const upcomingEvents = [...events]
    .filter(e => e.date > planEndDate && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)

  const preselectedEvent = upcomingEvents.find(
    e => e.priority === 'A' || e.priority === 'B'
  ) ?? null

  const [selectedEventDate, setSelectedEventDate] = useState<string | null>(
    preselectedEvent?.date ?? null
  )
  const [selectedWeeks, setSelectedWeeks] = useState(
    preselectedEvent ? weeksFromPlanEnd(preselectedEvent.date, planEndDate) : 2
  )
  const [phase, setPhase] = useState<Phase>('select')
  const [workoutsFound, setWorkoutsFound] = useState(0)
  const [totalWorkouts, setTotalWorkouts] = useState(0)
  const [pendingResult, setPendingResult] = useState<{
    plan: GeneratedPlan
    extra_weeks: number
    new_total_weeks: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const selectedEvent = upcomingEvents.find(e => e.date === selectedEventDate) ?? null

  function pickEvent(e: TrainingEvent) {
    setSelectedEventDate(e.date)
    setSelectedWeeks(weeksFromPlanEnd(e.date, planEndDate))
  }

  function pickChip(w: number) {
    setSelectedEventDate(null)
    setSelectedWeeks(w)
  }

  async function handleGenerate() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('loading')
    setError(null)
    setWorkoutsFound(0)
    setTotalWorkouts(0)
    try {
      const res = await fetch('/api/plan/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_weeks: selectedWeeks }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Request failed (${res.status})`)
        setPhase('select')
        return
      }
      if (!res.body) {
        setError('No response from server')
        setPhase('select')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done || controller.signal.aborted) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'total') setTotalWorkouts(event.count)
            else if (event.type === 'progress') setWorkoutsFound(event.found)
            else if (event.type === 'plan') {
              setPendingResult({
                plan: event.plan,
                extra_weeks: event.extra_weeks,
                new_total_weeks: event.new_total_weeks,
              })
              setPhase('review')
              return
            } else if (event.type === 'error') {
              setError(event.message ?? 'Generation failed')
              setPhase('select')
              return
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Network error')
      setPhase('select')
    }
  }

  async function handleApply() {
    if (!pendingResult) return
    setPhase('applying')
    setError(null)
    try {
      const res = await fetch('/api/plan/extend/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extra_weeks: pendingResult.extra_weeks,
          plan: pendingResult.plan,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Apply failed (${res.status})`)
        setPhase('review')
        return
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setPhase('review')
    }
  }

  const blocked = phase === 'loading' || phase === 'applying'

  const weeksCompleted = Math.max(0, Math.floor(
    (new Date(today).getTime() - new Date(planCreatedAt.split('T')[0]).getTime()) / (7 * 86400000)
  ))
  const remainingWeeks = Math.max(1, planWeeks - weeksCompleted)
  const newTotal = weeksCompleted + remainingWeeks + selectedWeeks

  const updatedPhilosophy = computeMethodology({
    weeklyHours,
    weeksToEvent: newTotal,
    eventType: selectedEvent?.type ?? null,
    eventPriority: selectedEvent?.priority ?? null,
    currentCTL,
    goals: '',
  })

  const pw = updatedPhilosophy.phase_weeks
  const phases = [
    { key: 'Base', weeks: pw.base, colour: '#0ea5e9' },
    { key: 'Build', weeks: pw.build, colour: '#6366f1' },
    { key: 'Peak', weeks: pw.peak, colour: '#8b5cf6' },
    { key: 'Taper', weeks: pw.taper, colour: '#64748b' },
  ].filter(p => p.weeks > 0)

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  const ctaLabel = selectedEvent
    ? `Extend to ${selectedEvent.name}`
    : `Extend plan by ${selectedWeeks} week${selectedWeeks === 1 ? '' : 's'}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={blocked ? undefined : onClose}
    >
      <div
        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {phase === 'loading' && (
          <div className="py-8 space-y-4 text-center">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
            <div>
              <p className="text-sm font-semibold text-slate-700">Generating extension…</p>
              {totalWorkouts > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  {workoutsFound} of {totalWorkouts} sessions generated
                </p>
              )}
            </div>
          </div>
        )}

        {phase === 'review' && pendingResult && (
          <>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Review extension</p>
              <p className="text-lg font-extrabold text-slate-900">Your extended plan is ready</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-1">
              <p className="text-sm font-semibold text-blue-800">
                {pendingResult.plan.workouts.length} sessions generated
              </p>
              {pendingResult.plan.workouts.length > 0 && (
                <p className="text-xs text-blue-600">
                  {fmtDate(pendingResult.plan.workouts[0].date)} → {fmtDate(pendingResult.plan.workouts[pendingResult.plan.workouts.length - 1].date)}
                </p>
              )}
              <p className="text-xs text-blue-500">
                Plan extended to {pendingResult.new_total_weeks} weeks total
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={handleApply}
                className="w-full bg-blue-600 text-white text-sm font-bold rounded-xl py-3 hover:bg-blue-700 transition-colors min-h-[44px]"
              >
                Apply extension
              </button>
              <button
                onClick={() => { setPendingResult(null); setPhase('select') }}
                className="w-full text-slate-400 text-sm py-2 min-h-[44px]"
              >
                Go back
              </button>
            </div>
          </>
        )}

        {phase === 'applying' && (
          <div className="py-8 space-y-4 text-center">
            <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-700">Applying extension…</p>
          </div>
        )}

        {phase === 'select' && (
          <>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Extend plan</p>
              <p className="text-lg font-extrabold text-slate-900">When do you want to extend to?</p>
              <p className="text-sm text-slate-500 mt-0.5">
                Currently ends {fmtDate(planEndDate)} · Week {planWeeks} of {planWeeks}
              </p>
            </div>

            <div className="space-y-3">
              {upcomingEvents.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Your events</p>
                  {upcomingEvents.map(e => {
                    const w = weeksFromPlanEnd(e.date, planEndDate)
                    const isSelected = selectedEventDate === e.date
                    return (
                      <button
                        key={e.date + e.name}
                        onClick={() => pickEvent(e)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors min-h-[44px] ${
                          isSelected
                            ? 'bg-blue-50 border-blue-500 border-2'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <span className={`text-sm font-semibold ${isSelected ? 'text-blue-800' : 'text-slate-700'}`}>{e.name}</span>
                        <span className={`text-xs font-medium shrink-0 ml-3 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`}>
                          {fmtDate(e.date)} · +{w}w
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                  {upcomingEvents.length > 0 ? 'Or add weeks' : 'Add weeks'}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {WEEK_CHIPS.map(w => {
                    const isSelected = selectedEventDate === null && selectedWeeks === w
                    return (
                      <button
                        key={w}
                        onClick={() => pickChip(w)}
                        className={`rounded-xl py-3 text-center transition-colors ${
                          isSelected
                            ? 'bg-blue-50 border-2 border-blue-500'
                            : 'bg-slate-50 border border-slate-200'
                        }`}
                      >
                        <p className={`text-base font-extrabold ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>+{w}</p>
                        <p className={`text-[9px] font-semibold ${isSelected ? 'text-blue-500' : 'text-slate-400'}`}>weeks</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
              <p className="text-xs text-green-800">{updatedPhilosophy.rationale}</p>
            </div>

            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-2">Updated structure</p>
              <div className="flex rounded-lg overflow-hidden h-5">
                {phases.map(p => (
                  <div
                    key={p.key}
                    style={{ background: p.colour, flex: p.weeks }}
                    className="flex items-center justify-center"
                  >
                    <span className="text-[8px] font-bold text-white truncate px-1">{p.key} {p.weeks}w</span>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={handleGenerate}
                className="w-full bg-blue-600 text-white text-sm font-bold rounded-xl py-3 hover:bg-blue-700 transition-colors min-h-[44px]"
              >
                {ctaLabel}
              </button>
              <button
                onClick={onClose}
                className="w-full text-slate-400 text-sm py-2 min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
