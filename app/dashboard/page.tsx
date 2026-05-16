'use client'
import { useEffect, useState } from 'react'
import MetricsBar from '@/components/MetricsBar'
import WorkoutCard from '@/components/WorkoutCard'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent } from '@/types'

const EVENT_COLOURS: Record<string, string> = {
  A: 'bg-red-100 border-red-400 text-red-800',
  B: 'bg-amber-100 border-amber-400 text-amber-800',
  C: 'bg-slate-100 border-slate-400 text-slate-600',
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
                  <div className={`rounded-xl border-2 px-4 py-3 ${EVENT_COLOURS[dayEvent.priority] ?? 'bg-amber-100 border-amber-400 text-amber-800'}`}>
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
