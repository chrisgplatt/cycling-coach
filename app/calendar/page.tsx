'use client'
import { useEffect, useState } from 'react'
import WorkoutCard from '@/components/WorkoutCard'
import FeedbackModal from '@/components/FeedbackModal'
import type { Workout } from '@/types'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const TYPE_DOT: Record<string, string> = {
  endurance: 'bg-blue-400', threshold: 'bg-orange-400',
  intervals: 'bg-red-400', recovery: 'bg-green-400',
}

export default function CalendarPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [selected, setSelected] = useState<Workout | null>(null)
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [year, setYear] = useState(() => new Date().getFullYear())

  useEffect(() => {
    fetch('/api/plan').then(r => r.json()).then(plan => {
      if (plan?.workouts) setWorkouts(plan.workouts)
    })
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
        <button onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }}
          className="text-gray-400 hover:text-gray-700">&#9664;</button>
        <h1 className="text-xl font-semibold text-gray-800">{MONTHS[month]} {year}</h1>
        <button onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }}
          className="text-gray-400 hover:text-gray-700">&#9654;</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs text-center text-gray-400 mb-1">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {blanks.map((_, i) => <div key={`b${i}`} />)}
        {days.map(day => {
          const ds = dateStr(day)
          const workout = workouts.find(w => w.date === ds)
          return (
            <button
              key={day}
              onClick={() => workout && setSelected(workout)}
              className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm
                ${workout ? 'bg-white border border-gray-200 hover:border-blue-400 cursor-pointer' : 'text-gray-300'}
              `}
            >
              <span>{day}</span>
              {workout && <div className={`w-2 h-2 rounded-full mt-0.5 ${TYPE_DOT[workout.type]}`} />}
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-700">{selected.date}</h2>
          <WorkoutCard workout={selected} onFeedback={setFeedbackWorkout} />
          <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
        </div>
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
