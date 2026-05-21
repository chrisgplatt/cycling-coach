'use client'
import { useEffect, useState } from 'react'
import WorkoutCard from '@/components/WorkoutCard'
import type { Workout, ICUWellness } from '@/types'

interface Props {
  workout: Workout | null
  wellness: ICUWellness | null
  onWorkoutClick?: (workout: Workout) => void
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

export default function TodayCard({ workout, wellness, onWorkoutClick }: Props) {
  const [coachNote, setCoachNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchNote(refresh = false) {
    try {
      const url = refresh ? '/api/briefing/today?refresh=true' : '/api/briefing/today'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setCoachNote(data.coach_note)
      }
    } catch { /* silent */ } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchNote() }, [])

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
  const dayType = workout ? workout.type.charAt(0).toUpperCase() + workout.type.slice(1) + ' day' : 'Rest day'

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Today</p>
        <p className="text-sm font-medium text-slate-700 mt-0.5">{dateLabel} · {dayType}</p>
      </div>

      {/* Today's workout */}
      {workout ? (
        <WorkoutCard workout={workout} onClick={() => onWorkoutClick?.(workout)} />
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
            {refreshing ? 'Refreshing…' : 'Refresh note'}
          </button>
        )}
      </div>
    </div>
  )
}
