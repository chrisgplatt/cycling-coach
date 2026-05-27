'use client'
import { useEffect, useRef, useState } from 'react'
import WorkoutCard from '@/components/WorkoutCard'
import type { Workout, ICUWellness, TrainingEvent } from '@/types'

interface Props {
  workout: Workout | null
  wellness: ICUWellness | null
  todayEvent?: TrainingEvent | null
  extraSessionCount?: number
  onWorkoutClick?: (workout: Workout) => void
  onChatWithCoach?: () => void
}

function readinessLabel(tsb: number | null): { label: string; colour: string } {
  if (tsb === null) return { label: '—', colour: 'text-slate-400' }
  if (tsb > 0) return { label: 'Ready', colour: 'text-emerald-600' }
  if (tsb >= -30) return { label: 'Moderate', colour: 'text-amber-500' }
  return { label: 'Fatigued', colour: 'text-red-500' }
}

function tsbColour(tsb: number | null): string {
  if (tsb === null) return 'text-slate-400'
  if (tsb > 0) return 'text-emerald-600'
  if (tsb >= -30) return 'text-amber-500'
  return 'text-red-500'
}

const BRIEFING_CACHE_KEY = 'cycling_coach_briefing'

export default function TodayCard({ workout, wellness, todayEvent, extraSessionCount, onWorkoutClick, onChatWithCoach }: Props) {
  const [coachNote, setCoachNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // workoutCompleted state recorded when the cached note was last generated
  const [cacheWorkoutCompleted, setCacheWorkoutCompleted] = useState<boolean | null>(null)
  // prevent the auto-refresh from firing more than once per session
  const hasAutoRefreshed = useRef(false)

  async function fetchNote(refresh = false) {
    const today = new Date().toISOString().split('T')[0]
    const isCompleted = workout?.status === 'completed'

    if (!refresh) {
      try {
        const raw = localStorage.getItem(BRIEFING_CACHE_KEY)
        if (raw) {
          const cached = JSON.parse(raw)
          if (cached.date === today && cached.coach_note) {
            setCoachNote(cached.coach_note)
            setCacheWorkoutCompleted(cached.workoutCompleted ?? false)
            setLoading(false)
            return
          }
        }
      } catch { /* ignore cache errors */ }
    }

    try {
      const url = refresh ? '/api/briefing/today?refresh=true' : '/api/briefing/today'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setCoachNote(data.coach_note)
        setCacheWorkoutCompleted(isCompleted)
        try {
          localStorage.setItem(BRIEFING_CACHE_KEY, JSON.stringify({
            date: today,
            coach_note: data.coach_note,
            workoutCompleted: isCompleted,
          }))
        } catch { /* ignore storage errors */ }
      }
    } catch { /* silent */ } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Initial load — reads from localStorage cache if available, otherwise fetches
  useEffect(() => { fetchNote() }, [])

  // Auto-refresh when a ride is completed or a race result is recorded, but cache still has morning note.
  // Only triggers once per session (hasAutoRefreshed ref).
  useEffect(() => {
    if (cacheWorkoutCompleted !== false) return
    if (hasAutoRefreshed.current) return
    const rideCompleted = workout?.status === 'completed'
    const raceResultRecorded = todayEvent?.result_tss != null
    if (rideCompleted || raceResultRecorded) {
      hasAutoRefreshed.current = true
      setRefreshing(true)
      fetchNote(true)
    }
  }, [workout, todayEvent, cacheWorkoutCompleted])

  async function handleRefresh() {
    setRefreshing(true)
    await fetchNote(true)
  }

  const tsb = wellness?.form ?? (
    wellness?.ctl !== null && wellness?.atl !== null && wellness?.ctl !== undefined && wellness?.atl !== undefined
      ? wellness.ctl - wellness.atl
      : null
  )
  const readiness = readinessLabel(tsb)

  const today = new Date()
  const dateLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const dayType = workout
    ? workout.type.charAt(0).toUpperCase() + workout.type.slice(1) + ' day'
    : todayEvent
      ? todayEvent.type.charAt(0).toUpperCase() + todayEvent.type.slice(1) + ' day'
      : 'Rest day'

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Today</p>
        <p className="text-sm font-medium text-slate-700 mt-0.5">{dateLabel} · {dayType}</p>
      </div>

      {/* Today's workout or event */}
      {workout ? (
        <>
          <WorkoutCard workout={workout} onClick={() => onWorkoutClick?.(workout)} />
          {extraSessionCount != null && extraSessionCount > 0 && (
            <p className="text-xs text-slate-400 pl-1">+{extraSessionCount} more session{extraSessionCount > 1 ? 's' : ''} today — see weekly strip below</p>
          )}
        </>
      ) : todayEvent ? (
        <div className="bg-red-50 rounded-xl border border-red-100 px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-base">🏁</span>
            <p className="text-sm font-semibold text-slate-800">{todayEvent.name}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            <span className="capitalize font-medium text-red-600">{todayEvent.type}</span>
            <span>·</span>
            <span>Priority {todayEvent.priority}</span>
            {todayEvent.race_type && <><span>·</span><span className="capitalize">{todayEvent.race_type.replace(/_/g, ' ')}</span></>}
            {todayEvent.start_time && <><span>·</span><span>Starts {todayEvent.start_time}</span></>}
            {todayEvent.distance_km && <><span>·</span><span>~{todayEvent.distance_km}km</span></>}
          </div>
          {todayEvent.result_tss != null ? (
            <p className="text-xs text-emerald-600 font-medium">Result recorded · TSS {todayEvent.result_tss}</p>
          ) : (
            <p className="text-xs text-slate-400">Good luck — no training session scheduled today.</p>
          )}
        </div>
      ) : (
        <div className="bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
          <p className="text-sm text-slate-500">No session planned — rest and recover.</p>
        </div>
      )}

      {/* Training state strip */}
      <div className="flex items-center gap-6 text-sm border-t border-slate-100 pt-3">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Readiness</p>
          <p className={`font-semibold ${readiness.colour}`}>{readiness.label}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Form (TSB)</p>
          <p className={`font-semibold ${tsbColour(tsb)}`}>
            {tsb !== null ? (tsb > 0 ? `+${Math.round(tsb)}` : Math.round(tsb).toString()) : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Fitness (CTL)</p>
          <p className="font-semibold text-slate-700">
            {wellness?.ctl !== null && wellness?.ctl !== undefined ? Math.round(wellness.ctl) : '—'}
          </p>
        </div>
        {wellness?.hrv !== null && wellness?.hrv !== undefined && (
          <div>
            <p className="text-xs text-slate-400 mb-0.5">HRV</p>
            <p className="font-semibold text-slate-700">{Math.round(wellness.hrv)} ms</p>
          </div>
        )}
      </div>

      {/* Coach note */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        {loading ? (
          <p className="text-sm text-slate-400">Getting your briefing…</p>
        ) : coachNote ? (
          <p className="text-sm text-slate-600 leading-relaxed font-light">{coachNote}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">Coach note unavailable.</p>
        )}
        {!loading && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Getting note…' : todayEvent?.result_tss != null ? 'Get post-race note' : workout?.status === 'completed' ? 'Get post-ride note' : 'Refresh note'}
          </button>
        )}
        {!loading && onChatWithCoach && workout && (
          <button
            onClick={onChatWithCoach}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors py-2 block"
          >
            <span className="flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
              Chat with coach →
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
