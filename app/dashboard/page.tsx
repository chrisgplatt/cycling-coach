'use client'
import { useEffect, useState } from 'react'
import MetricsBar from '@/components/MetricsBar'
import WorkoutCard from '@/components/WorkoutCard'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent } from '@/types'
import { EVENT_COLOURS } from '@/lib/event-colours'

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

export default function DashboardPage() {
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [athleteId, setAthleteId] = useState('')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [planName, setPlanName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [events, setEvents] = useState<TrainingEvent[]>([])

  async function doSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setSyncData(data)
        if (data.athlete_id) setAthleteId(data.athlete_id)
      }
    } finally {
      setSyncing(false)
    }
  }

  async function loadPlan() {
    const res = await fetch('/api/plan')
    if (res.ok) {
      const plan = await res.json()
      if (plan?.workouts) {
        const today = new Date().toISOString().split('T')[0]
        const sunday = new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0]
        setWorkouts(plan.workouts.filter((w: Workout) => w.date >= today && w.date <= sunday))
      }
      if (plan?.name) setPlanName(plan.name)
    }
  }

  useEffect(() => {
    doSync()
    loadPlan()
    fetch('/api/profile').then(r => r.json()).then(data => {
      const name: string = data?.full_name ?? ''
      if (name) setFirstName(name.split(' ')[0])
      if (data?.events) setEvents(data.events)
    }).catch(() => {})
  }, [])

  const latestWellness: ICUWellness | null = syncData?.wellness?.slice(-1)[0] ?? null

  const lastRide = syncData?.activities
    ?.slice()
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0] ?? null

  function formatLastRide(): string {
    if (!lastRide) return ''
    const rideDate = new Date(lastRide.start_date_local)
    const diffDays = Math.floor((Date.now() - rideDate.getTime()) / 864e5)
    const timeStr = rideDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const dateStr = rideDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    if (diffDays === 0) return `today at ${timeStr}`
    if (diffDays === 1) return `yesterday at ${timeStr}`
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {firstName ? `Hi, ${firstName}` : 'This Week'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {firstName ? 'This week' : ''}{planName ? (firstName ? ` — ${planName}` : planName) : ''}
          </p>
        </div>
        <button
          onClick={doSync}
          disabled={syncing}
          className="text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50 transition-colors"
        >
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      <MetricsBar wellness={latestWellness} />

      {latestWellness && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Readiness</h2>
            {lastRide && (
              <span className="text-xs text-slate-400">Last ride: <span className="font-medium text-slate-600">{formatLastRide()}</span></span>
            )}
          </div>
          <p className="text-sm text-slate-600">{getReadinessSummary(latestWellness)}</p>
        </div>
      )}

      <div className="space-y-2">
        {weekDates.map((date, i) => {
          const dayWorkout = workouts.find(w => w.date === date)
          const dayEvent = events.find(e => e.date === date)
          return (
            <div key={date} className="flex gap-4 items-start">
              <div className="w-10 text-center pt-3.5">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{days[i]}</div>
                <div className="text-sm font-bold text-slate-700 mt-0.5">{date.slice(8)}</div>
              </div>
              <div className="flex-1 space-y-2">
                {dayWorkout && (
                  <WorkoutCard
                    workout={dayWorkout}
                    onClick={() => setSelectedWorkout(dayWorkout)}
                  />
                )}
                {dayEvent && (
                  <div className={`rounded-xl border-2 px-4 py-3 ${EVENT_COLOURS[dayEvent.priority]}`}>
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
                  <div className="text-sm text-slate-300 py-3.5 pl-1">Rest</div>
                )}
              </div>
            </div>
          )
        })}
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
        />
      )}

      {feedbackWorkout && (
        <FeedbackModal
          workout={feedbackWorkout}
          onClose={() => setFeedbackWorkout(null)}
        />
      )}
    </div>
  )
}
