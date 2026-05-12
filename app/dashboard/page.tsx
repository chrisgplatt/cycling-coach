'use client'
import { useEffect, useState } from 'react'
import MetricsBar from '@/components/MetricsBar'
import WorkoutCard from '@/components/WorkoutCard'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { ICUSyncData, Workout, ICUWellness } from '@/types'

export default function DashboardPage() {
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [athleteId, setAthleteId] = useState('')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [planName, setPlanName] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)

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

  useEffect(() => { doSync(); loadPlan() }, [])

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
          <h1 className="text-xl font-semibold text-gray-800">This Week</h1>
          {planName && <p className="text-sm text-gray-500">{planName}</p>}
        </div>
        <button
          onClick={doSync}
          disabled={syncing}
          className="text-sm text-blue-600 hover:underline disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>

      <MetricsBar wellness={latestWellness} />

      <div className="space-y-3">
        {weekDates.map((date, i) => {
          const dayWorkout = workouts.find(w => w.date === date)
          return (
            <div key={date} className="flex gap-4 items-start">
              <div className="w-10 text-center">
                <div className="text-xs text-gray-400">{days[i]}</div>
                <div className="text-sm font-medium text-gray-700">{date.slice(8)}</div>
              </div>
              <div className="flex-1">
                {dayWorkout ? (
                  <WorkoutCard
                    workout={dayWorkout}
                    onClick={() => setSelectedWorkout(dayWorkout)}
                  />
                ) : (
                  <div className="text-sm text-gray-300 py-2">Rest</div>
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
