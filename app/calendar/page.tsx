'use client'
import { useEffect, useState } from 'react'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { Workout, TrainingEvent } from '@/types'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const TYPE_COLOUR: Record<string, string> = {
  endurance: 'text-blue-500', threshold: 'text-orange-500',
  intervals: 'text-red-500', recovery: 'text-green-500',
}
const EVENT_COLOURS: Record<string, string> = {
  A: 'bg-red-100 border-red-400 text-red-800',
  B: 'bg-amber-100 border-amber-400 text-amber-800',
  C: 'bg-slate-100 border-slate-400 text-slate-600',
}

export default function CalendarPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [planName, setPlanName] = useState('')
  const [athleteId, setAthleteId] = useState('')
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [year, setYear] = useState(() => new Date().getFullYear())

  function loadPlan() {
    fetch('/api/plan').then(r => r.json()).then(plan => {
      setWorkouts(plan?.workouts ?? [])
      setPlanName(plan?.name ?? '')
    }).catch(() => {})
  }

  useEffect(() => {
    loadPlan()
    fetch('/api/sync', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.athlete_id) setAthleteId(data.athlete_id) })
      .catch(() => {})
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.events) setEvents(data.events) })
      .catch(() => {})
  }, [])

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const blanks = Array(firstDay === 0 ? 6 : firstDay - 1).fill(null)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }}
          className="text-gray-400 hover:text-gray-700"
        >&#9664;</button>
        <div>
          <h1 className="text-xl font-semibold text-gray-800">{MONTHS[month]} {year}</h1>
          {planName && <p className="text-sm text-gray-500">{planName}</p>}
        </div>
        <button
          onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }}
          className="text-gray-400 hover:text-gray-700"
        >&#9654;</button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[400px]">
          <div className="grid grid-cols-7 gap-1 text-xs text-center text-gray-400 mb-1">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {blanks.map((_, i) => <div key={`b${i}`} />)}
            {days.map(day => {
              const ds = dateStr(day)
              const workout = workouts.find(w => w.date === ds)
              const event = events.find(e => e.date === ds)

              if (event) {
                return (
                  <button
                    key={day}
                    onClick={() => workout && setSelectedWorkout(workout)}
                    className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm border-2 ${EVENT_COLOURS[event.priority] ?? 'bg-amber-100 border-amber-400 text-amber-800'} ${workout ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="font-semibold">{day}</span>
                    <span className="text-[10px]">🏁</span>
                    <span title={event.name} className="text-[8px] font-semibold text-center leading-tight px-0.5 w-full truncate">
                      {event.name}
                    </span>
                    {workout && (
                      <span className={`text-[8px] font-medium capitalize ${TYPE_COLOUR[workout.type] ?? 'text-gray-500'}`}>
                        {workout.type}
                      </span>
                    )}
                  </button>
                )
              }

              return (
                <button
                  key={day}
                  onClick={() => workout && setSelectedWorkout(workout)}
                  className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm
                    ${workout ? 'bg-white border border-gray-200 hover:border-blue-400 cursor-pointer' : 'text-gray-300'}
                  `}
                >
                  <span>{day}</span>
                  {workout && (
                    <>
                      <span className={`text-[10px] font-medium capitalize ${TYPE_COLOUR[workout.type] ?? 'text-gray-500'}`}>
                        {workout.type}
                      </span>
                      <span className="text-[10px] text-gray-400">{workout.duration_minutes} min</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
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
