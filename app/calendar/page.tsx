'use client'
import { useEffect, useState } from 'react'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import SessionChatModal from '@/components/SessionChatModal'
import EventDetailModal from '@/components/EventDetailModal'
import type { Workout, TrainingEvent, SessionFeedback, ICUActivity } from '@/types'
import { EVENT_COLOURS } from '@/lib/event-colours'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const TYPE_COLOUR: Record<string, string> = {
  endurance: 'text-blue-500', threshold: 'text-orange-500',
  intervals: 'text-red-500', recovery: 'text-green-500',
}
const IF_BY_TYPE: Record<string, number> = {
  recovery: 0.50, endurance: 0.68, threshold: 0.85, intervals: 0.90,
}
const STATUS_STYLE: Record<string, string> = {
  completed:    'text-emerald-600',
  needs_review: 'text-amber-500',
  planned:      'text-blue-400',
  skipped:      'text-slate-400',
}
const STATUS_LABEL: Record<string, string> = {
  completed:    '✓ done',
  needs_review: 'review',
  planned:      'planned',
  skipped:      'missed',
}
function tssLabel(workout: Workout): string | null {
  if (workout.tss !== null) return `${workout.tss} TSS`
  if (workout.status === 'planned') {
    const if_ = IF_BY_TYPE[workout.type] ?? 0.68
    return `~${Math.round((workout.duration_minutes * 60 * if_ * if_) / 36)} TSS`
  }
  return null
}

export default function CalendarPage() {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [planName, setPlanName] = useState('')
  const [athleteId, setAthleteId] = useState('')
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [initialFeedback, setInitialFeedback] = useState<SessionFeedback | null>(null)
  const [chatWorkout, setChatWorkout] = useState<Workout | null>(null)
  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [selectedEvent, setSelectedEvent] = useState<TrainingEvent | null>(null)
  const [eventActivities, setEventActivities] = useState<ICUActivity[]>([])
  const [eventActivitiesLoading, setEventActivitiesLoading] = useState(false)

  async function openEvent(event: TrainingEvent) {
    setSelectedEvent(event)
    setEventActivities([])
    setEventActivitiesLoading(true)
    try {
      const res = await fetch(`/api/activities?date=${event.date}`)
      const data = res.ok ? await res.json() : { activities: [] }
      setEventActivities(data.activities ?? [])
    } catch {
      setEventActivities([])
    } finally {
      setEventActivitiesLoading(false)
    }
  }

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
        {(() => { const now = new Date(); return (now.getMonth() !== month || now.getFullYear() !== year) })() && (
          <button
            onClick={() => { const now = new Date(); setMonth(now.getMonth()); setYear(now.getFullYear()) }}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-md px-2.5 py-1 transition-colors"
          >
            Today
          </button>
        )}
      </div>

      <div>
        <div>
          <div className="grid grid-cols-7 gap-0.5 text-xs text-center text-gray-400 mb-1">
            {['M','T','W','T','F','S','S'].map((d, i) => <div key={i}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {blanks.map((_, i) => <div key={`b${i}`} />)}
            {days.map(day => {
              const ds = dateStr(day)
              const workout = workouts.find(w => w.date === ds)
              const event = events.find(e => e.date === ds)

              if (event) {
                return (
                  <button
                    key={day}
                    onClick={() => openEvent(event)}
                    className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm border-2 cursor-pointer hover:brightness-95 transition-all ${EVENT_COLOURS[event.priority]}`}
                  >
                    <span className="font-semibold">{day}</span>
                    <span className="text-[10px]">🏁</span>
                    <span title={event.name} className="text-[8px] font-semibold text-center leading-tight px-0.5 w-full truncate">
                      {event.name}
                    </span>
                    {event.icu_activity_id && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-0.5" title="Result recorded" />
                    )}
                    {workout && (
                      <>
                        <span className={`text-[8px] font-medium capitalize ${TYPE_COLOUR[workout.type] ?? 'text-gray-500'}`}>
                          {workout.type}
                        </span>
                        {tssLabel(workout) && (
                          <span className="text-[8px] text-gray-400">{tssLabel(workout)}</span>
                        )}
                        <span className={`text-[7px] font-semibold ${STATUS_STYLE[workout.status] ?? 'text-gray-400'}`}>
                          {STATUS_LABEL[workout.status] ?? workout.status}
                        </span>
                      </>
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
                      <span className="text-[10px] text-gray-400">{workout.duration_minutes}m</span>
                      {tssLabel(workout) && (
                        <span className="text-[9px] text-gray-400">{tssLabel(workout)}</span>
                      )}
                      <span className={`text-[8px] font-semibold ${STATUS_STYLE[workout.status] ?? 'text-gray-400'}`}>
                        {STATUS_LABEL[workout.status] ?? workout.status}
                      </span>
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
          onFeedback={(existingFeedback) => {
            setInitialFeedback(existingFeedback ?? null)
            setFeedbackWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
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

      {feedbackWorkout && (
        <FeedbackModal
          workout={feedbackWorkout}
          initialFeedback={initialFeedback ?? undefined}
          onClose={() => {
            setFeedbackWorkout(null)
            setInitialFeedback(null)
          }}
        />
      )}

      {chatWorkout && (
        <SessionChatModal
          workout={chatWorkout}
          wellness={null}
          onClose={() => setChatWorkout(null)}
          onWorkoutUpdated={updated => {
            setWorkouts(prev => prev.map(w => w.id === updated.id ? updated : w))
            setChatWorkout(null)
          }}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          activitiesOnDate={eventActivities}
          activitiesLoading={eventActivitiesLoading}
          onClose={() => { setSelectedEvent(null); setEventActivities([]) }}
          onResultSaved={(updated) => {
            setEvents(prev =>
              prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e)
            )
            setSelectedEvent(updated)
          }}
        />
      )}
    </div>
  )
}
