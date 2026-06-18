'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import RescheduleConfirmModal from '@/components/RescheduleConfirmModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import SessionChatModal from '@/components/SessionChatModal'
import EventDetailModal from '@/components/EventDetailModal'
import AddEventModal from '@/components/AddEventModal'
import PlanReviewModal from '@/components/PlanReviewModal'
import ActivityCard from '@/components/ActivityCard'
import ActivityDetailModal from '@/components/ActivityDetailModal'
import WorkoutCard from '@/components/WorkoutCard'
import type { Workout, TrainingEvent, ICUActivity, ICUSyncData, GeneratedPlan, UnavailabilityPeriod, WeightEntry } from '@/types'
import { calendarMonthDays, weekDates, formatDuration, toLocalDateStr, weekStartsAround, weekStartsAfter, getDayWorkoutColor, getWeeklySummary } from '@/lib/calendar-helpers'
import { getWeekBounds } from '@/lib/week-bounds'
import AddUnavailabilityModal from '@/components/AddUnavailabilityModal'
import { periodOverlapsWeek, coveredDaysInWeek, periodDurationDays } from '@/lib/utils/unavailability'

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// ─── Session cards ────────────────────────────────────────────────────────────

// Planned workouts are draggable. TouchSensor requires a 200ms press before activating
// so scrolling past cards never triggers a drag accidentally.
function DraggableWorkoutCard({ workout, onClick, ftp }: { workout: Workout; onClick: () => void; ftp?: number }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: workout.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="relative">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-16 h-0.5 rounded-full bg-slate-300 pointer-events-none z-10" />
      <WorkoutCard workout={workout} onClick={onClick} ftp={ftp} />
      {/* Drag zone sits between the two grip bars; relays quick taps as card-open */}
      <div
        {...listeners}
        className="absolute inset-x-0 top-4 bottom-3 z-10 cursor-grab active:cursor-grabbing"
        onClick={onClick}
      />
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-16 h-0.5 rounded-full bg-slate-300 pointer-events-none z-10" />
    </div>
  )
}

// One day's sessions column, droppable so a dragged workout can land on this date.
function DroppableDay({ date, children }: { date: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: date })
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 flex flex-col gap-1.5 min-w-0 py-0.5 rounded-lg transition-colors ${isOver ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''}`}
    >
      {children}
    </div>
  )
}

function EventCard({ event, onClick }: { event: TrainingEvent; onClick: () => void }) {
  const hasResult = event.icu_activity_id != null
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-red-50 border-l-4 border-red-500 rounded-md px-3 py-2.5 active:opacity-70 transition-opacity"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-red-700 truncate">🏁 {event.name}</span>
        {hasResult && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 bg-green-100 text-green-700">
            completed ✓
          </span>
        )}
      </div>
      <div className="flex gap-3 mt-0.5 text-xs text-slate-500">
        {event.result_duration_minutes != null
          ? <span>{formatDuration(event.result_duration_minutes)}</span>
          : event.duration_minutes != null
            ? <span>{formatDuration(event.duration_minutes)}</span>
            : null}
        {event.result_tss != null && <span>TSS {event.result_tss}</span>}
        {event.result_avg_power != null && <span>{event.result_avg_power}W</span>}
      </div>
    </button>
  )
}

const PERIOD_STYLES: Record<string, { bg: string; text: string; border: string; daybg: string }> = {
  sick:        { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-300',    daybg: 'bg-red-50' },
  injury:      { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', daybg: 'bg-orange-50' },
  holiday:     { bg: 'bg-teal-100',   text: 'text-teal-700',   border: 'border-teal-300',   daybg: 'bg-teal-50' },
  unavailable: { bg: 'bg-slate-100',  text: 'text-slate-600',  border: 'border-slate-300',  daybg: 'bg-slate-50' },
}
const PERIOD_ICONS: Record<string, string> = {
  sick: '🤒', injury: '🤕', holiday: '🏖️', unavailable: '🚫',
}

// ─── Month strip ─────────────────────────────────────────────────────────────

interface MonthStripProps {
  displayYear: number
  displayMonth: number
  selectedDateStr: string
  workouts: Workout[]
  events: TrainingEvent[]
  unlinkedActivities: ICUActivity[]
  todayStr: string
  onDateClick: (dateStr: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}

function MonthStrip({
  displayYear, displayMonth, selectedDateStr,
  workouts, events, unlinkedActivities, todayStr,
  onDateClick, onPrevMonth, onNextMonth,
}: MonthStripProps) {
  const cells = calendarMonthDays(displayYear, displayMonth)
  const selectedWeek = weekDates(selectedDateStr)
  const selectedWeekSet = new Set(selectedWeek)

  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={onPrevMonth} aria-label="Previous month" className="p-2 text-slate-400 hover:text-slate-700 text-lg leading-none min-h-[44px]">‹</button>
        <span className="text-sm font-semibold text-slate-700">{MONTHS[displayMonth]} {displayYear}</span>
        <button onClick={onNextMonth} aria-label="Next month" className="p-2 text-slate-400 hover:text-slate-700 text-lg leading-none min-h-[44px]">›</button>
      </div>

      {/* Day-of-week headers — blank left cell keeps columns aligned with summary */}
      <div className="flex mb-1">
        <div className="w-10 shrink-0" />
        <div className="grid grid-cols-7 flex-1 text-center">
          {['M','T','W','T','F','S','S'].map((d, i) => (
            <div key={i} className="text-[9px] text-slate-400 font-medium">{d}</div>
          ))}
        </div>
      </div>

      {/* Week rows: [summary column] + [7 day cells] */}
      {weeks.map((weekCells, weekIndex) => {
        const weekDateStrs = weekCells.filter((d): d is string => d !== null)
        const summary = getWeeklySummary(weekDateStrs, workouts, unlinkedActivities)
        const isCurrentWeek = weekDateStrs.includes(todayStr)
        const isPastWeek = !isCurrentWeek && weekDateStrs.length > 0 && weekDateStrs.every(d => d < todayStr)
        const hasActual = summary.actualTss > 0 || summary.actualMins > 0
        const showActual = isPastWeek || (isCurrentWeek && hasActual)
        const showTss = showActual ? summary.actualTss : summary.plannedTss
        const showMins = showActual ? summary.actualMins : summary.plannedMins
        const summaryColor = isPastWeek ? 'text-emerald-600' : isCurrentWeek ? 'text-orange-500' : 'text-slate-300'
        return (
          <div key={weekIndex} className="flex">
            {/* Weekly summary: past=green actual, current=orange planned, future=slate-300 planned */}
            <div className="w-10 shrink-0 flex flex-col justify-center items-end pr-1.5">
              {(showTss > 0 || showMins > 0) && (
                <>
                  {showTss > 0 && (
                    <span className={`text-[9px] leading-tight ${summaryColor}`}>
                      {Math.round(showTss)}
                    </span>
                  )}
                  {showMins > 0 && (
                    <span className={`text-[9px] leading-tight ${summaryColor}`}>
                      {formatDuration(showMins)}
                    </span>
                  )}
                </>
              )}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 flex-1">
              {weekCells.map((dateStr, i) => {
                if (!dateStr) return <div key={`b${weekIndex}-${i}`} />
                const inSelectedWeek = selectedWeekSet.has(dateStr)
                const isToday = dateStr === todayStr
                const workoutColor = getDayWorkoutColor(dateStr, workouts)
                const dots: string[] = []
                if (events.some(e => e.date === dateStr)) dots.push('bg-red-400')
                if (workoutColor) dots.push(workoutColor)
                if (unlinkedActivities.some(a => a.start_date_local.startsWith(dateStr))) dots.push('bg-sky-400')
                return (
                  <button
                    key={dateStr}
                    onClick={() => onDateClick(dateStr)}
                    aria-label={dateStr}
                    className={`flex flex-col items-center justify-center min-h-[44px] w-full cursor-pointer rounded-sm ${inSelectedWeek ? 'bg-blue-50' : ''}`}
                  >
                    <span className={`text-[11px] w-6 h-6 flex items-center justify-center leading-none rounded-full
                      ${isToday ? 'bg-blue-500 text-white font-bold' : 'text-slate-600'}`}>
                      {parseInt(dateStr.split('-')[2], 10)}
                    </span>
                    <div className="flex gap-0.5 mt-0.5 h-1.5 items-center">
                      {dots.slice(0, 3).map((color, j) => (
                        <div key={j} className={`w-1 h-1 rounded-full ${color}`} />
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Week detail ─────────────────────────────────────────────────────────────

interface WeekDetailProps {
  selectedDateStr: string
  workouts: Workout[]
  events: TrainingEvent[]
  unlinkedActivities: ICUActivity[]
  todayStr: string
  onWorkoutClick: (w: Workout) => void
  onEventClick: (e: TrainingEvent) => void
  onActivityClick: (a: ICUActivity) => void
  unavailability: UnavailabilityPeriod[]
  onAddUnavailability: (date: string) => void
  ftp?: number
}

function WeekDetail({
  selectedDateStr, workouts, events, unlinkedActivities, todayStr,
  onWorkoutClick, onEventClick, onActivityClick, unavailability, onAddUnavailability, ftp,
}: WeekDetailProps) {
  const dates = weekDates(selectedDateStr)
  const overlappingPeriods = unavailability.filter(p => periodOverlapsWeek(p, dates))
  const coveredMap = new Map(
    overlappingPeriods.map(p => [p.id, coveredDaysInWeek(p, dates)])
  )
  return (
    <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
      {overlappingPeriods.map(period => {
        const style = PERIOD_STYLES[period.type] ?? PERIOD_STYLES.unavailable
        const icon = PERIOD_ICONS[period.type] ?? '🚫'
        const label = period.type.charAt(0).toUpperCase() + period.type.slice(1)
        const days = periodDurationDays(period)
        return (
          <div
            key={period.id}
            className={`mx-3 mt-2 mb-1 px-3 py-1.5 rounded-lg border flex items-center gap-2 text-xs font-semibold ${style.bg} ${style.text} ${style.border}`}
          >
            <span>{icon}</span>
            <span>{label}{period.notes ? ` · ${period.notes}` : ''}</span>
            <span className="font-normal ml-auto opacity-70">{period.start_date} – {period.end_date} · {days}d</span>
          </div>
        )
      })}
      {dates.map((dateStr, i) => {
        const dayWorkouts = workouts.filter(w => w.date === dateStr)
        const dayEvents = events.filter(e => e.date === dateStr)
        const dayActivities = unlinkedActivities.filter(a => a.start_date_local.startsWith(dateStr))
        const hasEvent = dayEvents.length > 0
        const isToday = dateStr === todayStr
        const isEmpty = !dayWorkouts.length && !dayEvents.length && !dayActivities.length
        const dayNum = parseInt(dateStr.split('-')[2], 10)

        // Build a map from workout id → linked event (event whose icu_activity_id matches the workout's)
        const workoutByActivityId = new Map(
          dayWorkouts
            .filter(w => w.icu_activity_id != null)
            .map(w => [w.icu_activity_id!, w])
        )
        const linkedEventByWorkoutId = new Map<string, TrainingEvent>()
        const standaloneEvents: TrainingEvent[] = []
        for (const e of dayEvents) {
          const matchedWorkout = e.icu_activity_id ? workoutByActivityId.get(e.icu_activity_id) : undefined
          if (matchedWorkout) {
            linkedEventByWorkoutId.set(matchedWorkout.id, e)
          } else {
            standaloneEvents.push(e)
          }
        }

        const isCovered = overlappingPeriods.some(p => coveredMap.get(p.id)?.[i])
        const coveringPeriod = overlappingPeriods.find(p => coveredMap.get(p.id)?.[i])
        const dayStyle = coveringPeriod ? (PERIOD_STYLES[coveringPeriod.type] ?? PERIOD_STYLES.unavailable) : null

        return (
          <div key={dateStr} className={`flex gap-3 px-3 py-2.5 items-start${isCovered && dayStyle ? ` ${dayStyle.daybg}` : ''}`}>
            {/* Date column */}
            <div className="w-10 flex-shrink-0 text-center pt-0.5">
              <div className={`text-[10px] font-semibold uppercase
                ${hasEvent ? 'text-red-500' : isToday ? 'text-blue-500' : 'text-slate-400'}`}>
                {DAY_NAMES[i]}
              </div>
              <button
                onClick={() => onAddUnavailability(dateStr)}
                className={`text-lg font-bold leading-tight w-full active:opacity-70 ${
                  hasEvent ? 'text-red-600' : isToday ? 'text-blue-600' : 'text-slate-500'
                }`}
                aria-label={`Add unavailability on ${dateStr}`}
              >
                {dayNum}
              </button>
            </div>
            {/* Sessions column — droppable target for rescheduling */}
            <DroppableDay date={dateStr}>
              {isEmpty && <p className="text-sm text-slate-300 italic py-1.5">Rest day</p>}
              {dayWorkouts.map(w => {
                const linkedEvent = linkedEventByWorkoutId.get(w.id)
                return (
                  <div key={w.id}>
                    {w.status === 'planned'
                      ? <DraggableWorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} />
                      : <WorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} />}
                    {linkedEvent && (
                      <div className="relative ml-4 mt-1">
                        <div className="absolute -top-2 -left-3 h-6 w-3 border-l-2 border-b-2 border-gray-200 rounded-bl-md" />
                        <EventCard event={linkedEvent} onClick={() => onEventClick(linkedEvent)} />
                      </div>
                    )}
                  </div>
                )
              })}
              {standaloneEvents.map(e => (
                <EventCard key={`${e.date}-${e.name}`} event={e} onClick={() => onEventClick(e)} />
              ))}
              {dayActivities.map(a => (
                <ActivityCard key={a.id} activity={a} onClick={() => onActivityClick(a)} />
              ))}
            </DroppableDay>
          </div>
        )
      })}
    </div>
  )
}

// ─── Continuous week list ──────────────────────────────────────────────────────

// Short label for a week given its Monday, e.g. "25–31 May" or "29 Jun – 5 Jul".
function WeekHeader({ monday, todayStr, workouts }: { monday: string; todayStr: string; workouts: Workout[] }) {
  const { start, end } = getWeekBounds(monday)
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  const sMonth = MONTHS[s.getUTCMonth()]
  const eMonth = MONTHS[e.getUTCMonth()]
  const label = sMonth === eMonth
    ? `${s.getUTCDate()}–${e.getUTCDate()} ${sMonth}`
    : `${s.getUTCDate()} ${sMonth} – ${e.getUTCDate()} ${eMonth}`
  const isThisWeek = todayStr >= start && todayStr <= end

  const weekWorkouts = workouts.filter(w => w.date >= start && w.date <= end && w.status !== 'skipped')
  const totalMins = weekWorkouts.reduce((sum, w) => sum + w.duration_minutes, 0)
  const totalTss = weekWorkouts.reduce((sum, w) => sum + (w.tss ?? 0), 0)
  const hasTss = weekWorkouts.some(w => w.tss != null)

  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      {isThisWeek && (
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">This week</span>
      )}
      {weekWorkouts.length > 0 && (
        <span className="ml-auto text-[10px] text-slate-400">
          {formatDuration(totalMins)}{hasTss ? ` · ${Math.round(totalTss)} TSS` : ''}
        </span>
      )}
    </div>
  )
}

type ContinuousWeeksProps = Omit<WeekDetailProps, 'selectedDateStr'> & {
  navTarget: { date: string; seq: number }
  onWeekInView: (monday: string) => void
  scrollVersion: number
}

// A scrollable run of weeks that flows continuously: scrolling past Sunday brings
// in the next week. The visible week is reported via onWeekInView (keeps the month
// strip in sync); the list extends forward as you near the bottom; tapping a date
// re-anchors and scrolls that week to the top.
function ContinuousWeeks({ navTarget, onWeekInView, scrollVersion, ...week }: ContinuousWeeksProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const weekEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const lastWeek = useRef('')
  const appending = useRef(false)
  const pendingScrollTo = useRef<string>(getWeekBounds(navTarget.date).start)
  // The window re-anchors on explicit navigation by remounting (see `key` at the
  // call site), so the initial state below is the anchor; scroll forward extends it.
  const [weeks, setWeeks] = useState<string[]>(() => weekStartsAround(navTarget.date, 4, 16))

  // Reset the append lock whenever the weeks list changes.
  useEffect(() => { appending.current = false }, [weeks])

  // Scroll to the nav target each time data loads (plan then sync), since activity
  // cards rendered after sync inflate week heights. Position is computed by summing
  // preceding element heights — avoids offsetParent ambiguity; Map iterates in
  // insertion (chronological) order. pendingScrollTo is cleared after the second
  // trigger so subsequent user scrolling isn't interrupted.
  useEffect(() => {
    if (scrollVersion === 0) return
    const target = pendingScrollTo.current
    if (!target) return
    const c = scrollRef.current
    if (!c) return
    let scrollTo = 0
    for (const [monday, el] of weekEls.current) {
      if (monday === target) break
      scrollTo += el.offsetHeight + 12  // 12px = space-y-3 gap between weeks
    }
    c.scrollTop = scrollTo
    lastWeek.current = target
    if (scrollVersion >= 2) pendingScrollTo.current = ''  // done after sync loads
  }, [scrollVersion])

  function handleScroll() {
    const c = scrollRef.current
    if (!c) return
    // Current week = the last block whose top has scrolled to/above the container top.
    let current = weeks[0]
    for (const monday of weeks) {
      const el = weekEls.current.get(monday)
      if (el && el.offsetTop - c.scrollTop <= 8) current = monday
    }
    if (current && current !== lastWeek.current) {
      lastWeek.current = current
      onWeekInView(current)
    }
    if (!appending.current && c.scrollHeight - c.scrollTop - c.clientHeight < 400) {
      appending.current = true
      setWeeks(w => (w.length ? [...w, ...weekStartsAfter(w[w.length - 1], 8)] : w))
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="relative overflow-y-auto max-h-[calc(100vh-13rem)] space-y-3 pb-4"
    >
      {weeks.map(monday => (
        <div
          key={monday}
          ref={el => { if (el) weekEls.current.set(monday, el); else weekEls.current.delete(monday) }}
        >
          <WeekHeader monday={monday} todayStr={week.todayStr} workouts={week.workouts} />
          <WeekDetail selectedDateStr={monday} {...week} />
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [todayStr] = useState(() => toLocalDateStr(new Date()))

  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [planName, setPlanName] = useState('')
  const [athleteId, setAthleteId] = useState('')
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
  const [chatWorkout, setChatWorkout] = useState<Workout | null>(null)
  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<TrainingEvent | null>(null)
  const [eventActivities, setEventActivities] = useState<ICUActivity[]>([])
  const [eventActivitiesLoading, setEventActivitiesLoading] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TrainingEvent | null>(null)
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [selectedDateStr, setSelectedDateStr] = useState(todayStr)
  // Explicit navigation target for the continuous week list (tap a date / Today).
  // `seq` bumps on every nav so the list re-anchors even when the date repeats.
  const [navTarget, setNavTarget] = useState<{ date: string; seq: number }>({ date: todayStr, seq: 0 })
  const [displayYear, setDisplayYear] = useState(() => new Date().getFullYear())
  const [displayMonth, setDisplayMonth] = useState(() => new Date().getMonth())

  // Scroll in the continuous list reports the week now in view: keep the month
  // strip highlight and the displayed month following along.
  function handleWeekInView(monday: string) {
    setSelectedDateStr(monday)
    const [y, mo] = monday.split('-').map(Number)
    setDisplayYear(y)
    setDisplayMonth(mo - 1)
  }
  function navigateTo(date: string) {
    setSelectedDateStr(date)
    setNavTarget(t => ({ date, seq: t.seq + 1 }))
  }

  const [scrollVersion, setScrollVersion] = useState(0)
  const [currentFTP, setCurrentFTP] = useState<number | undefined>(undefined)
  const [unavailability, setUnavailability] = useState<UnavailabilityPeriod[]>([])
  const [addUnavailDate, setAddUnavailDate] = useState<string | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<ICUActivity | null>(null)

  // Drag-to-reschedule: a planned workout can be dragged onto another day.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null)
  const [pendingReschedule, setPendingReschedule] = useState<{ workout: Workout; toDate: string } | null>(null)

  function handleDragStart(event: DragStartEvent) {
    setActiveWorkout(workouts.find(w => w.id === String(event.active.id)) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveWorkout(null)
    const { active, over } = event
    if (!over) return
    const workout = workouts.find(w => w.id === String(active.id))
    if (!workout || workout.status !== 'planned') return
    const toDate = String(over.id)
    if (toDate === workout.date) return
    setPendingReschedule({ workout, toDate })
  }

  const reviewAbortRef = useRef<AbortController | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewPlan, setReviewPlan] = useState<GeneratedPlan | null>(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewWorkoutsFound, setReviewWorkoutsFound] = useState(0)
  const [reviewEstimatedWorkouts, setReviewEstimatedWorkouts] = useState(0)

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

  function loadPlan() {
    fetch('/api/plan').then(r => r.json()).then(plan => {
      setWorkouts(plan?.workouts ?? [])
      setPlanName(plan?.name ?? '')
      setScrollVersion(v => v + 1)
    }).catch(() => { setScrollVersion(v => v + 1) })
  }

  useEffect(() => {
    loadPlan()
    fetch('/api/sync', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.athlete_id) setAthleteId(data.athlete_id)
        if (data) setSyncData(data)
        setScrollVersion(v => v + 1)  // re-scroll after sync — activity cards affect heights
      })
      .catch(() => { setScrollVersion(v => v + 1) })
    fetch('/api/weight-log')
      .then(r => r.json())
      .then(d => setWeightLog(d.entries ?? []))
      .catch(() => {})
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.events) setEvents(data.events)
        if (data?.current_ftp) setCurrentFTP(data.current_ftp)
        if (data) setUnavailability(data.unavailability ?? [])
      })
      .catch(() => {})
  }, [])

  function prevMonth() {
    if (displayMonth === 0) { setDisplayMonth(11); setDisplayYear(y => y - 1) }
    else setDisplayMonth(m => m - 1)
  }
  function nextMonth() {
    if (displayMonth === 11) { setDisplayMonth(0); setDisplayYear(y => y + 1) }
    else setDisplayMonth(m => m + 1)
  }

  function handlePeriodSaved(period: UnavailabilityPeriod, impactPlan: boolean) {
    setUnavailability(prev => {
      const idx = prev.findIndex(p => p.id === period.id)
      if (idx !== -1) { const next = [...prev]; next[idx] = period; return next }
      return [...prev, period]
    })
    setAddUnavailDate(null)
    if (impactPlan && planName) {
      const label = period.type.charAt(0).toUpperCase() + period.type.slice(1)
      const note = period.notes ? `${label}: ${period.notes}` : label
      startAdaptation(`I've added a ${note} period from ${period.start_date} to ${period.end_date}. Please adapt my training plan around it.`)
    }
  }

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

  async function updateEvent(original: TrainingEvent, updated: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original_name: original.name, original_date: original.date, ...updated }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to update event')
    setEvents(prev => prev.map(e => e.name === original.name && e.date === original.date ? data.event : e))
  }

  const linkedIds = new Set<string>([
    ...workouts.map(w => w.icu_activity_id).filter((id): id is string => id != null),
    ...events.map(e => e.icu_activity_id).filter((id): id is string => id != null),
  ])
  const unlinkedActivities = (syncData?.activities ?? []).filter(
    a => /ride/i.test(a.type) && !linkedIds.has(a.id)
  )

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">Calendar</h1>
          {planName && <p className="text-sm text-gray-500">{planName}</p>}
        </div>
        {selectedDateStr !== todayStr && (
          <button
            onClick={() => {
              navigateTo(todayStr)
              setDisplayMonth(new Date().getMonth())
              setDisplayYear(new Date().getFullYear())
            }}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-md px-2.5 py-1 transition-colors"
          >
            Today
          </button>
        )}
      </div>

      {/* Month strip */}
      <MonthStrip
        displayYear={displayYear}
        displayMonth={displayMonth}
        selectedDateStr={selectedDateStr}
        workouts={workouts}
        events={events}
        unlinkedActivities={unlinkedActivities}
        todayStr={todayStr}
        onDateClick={navigateTo}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
      />

      {/* Continuous, scrollable run of weeks — wrapped in a DnD context so planned
          workouts can be dragged to another day (including across weeks). */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <ContinuousWeeks
          key={navTarget.seq}
          navTarget={navTarget}
          onWeekInView={handleWeekInView}
          scrollVersion={scrollVersion}
          workouts={workouts}
          events={events}
          unlinkedActivities={unlinkedActivities}
          todayStr={todayStr}
          onWorkoutClick={(w) => setSelectedWorkout(w)}
          onEventClick={openEvent}
          onActivityClick={(a) => setSelectedActivity(a)}
          unavailability={unavailability}
          onAddUnavailability={date => setAddUnavailDate(date)}
          ftp={currentFTP}
        />
        <DragOverlay>
          {activeWorkout ? <WorkoutCard workout={activeWorkout} onClick={() => {}} ftp={currentFTP} /> : null}
        </DragOverlay>
      </DndContext>

      {pendingReschedule && (
        <RescheduleConfirmModal
          workout={pendingReschedule.workout}
          toDate={pendingReschedule.toDate}
          onConfirm={() => { setPendingReschedule(null); loadPlan() }}
          onCancel={() => setPendingReschedule(null)}
        />
      )}

      {addUnavailDate && (
        <AddUnavailabilityModal
          defaultStartDate={addUnavailDate}
          onClose={() => setAddUnavailDate(null)}
          onSaved={handlePeriodSaved}
        />
      )}

      {selectedActivity && (
        <ActivityDetailModal
          activity={selectedActivity}
          onClose={() => setSelectedActivity(null)}
        />
      )}

      {/* Modals — all unchanged from original */}
      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          onClose={() => setSelectedWorkout(null)}
          onChat={() => {
            setChatWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
          onStatusChange={() => { setSelectedWorkout(null); loadPlan() }}
          onDelete={() => { setSelectedWorkout(null); loadPlan() }}
          onReschedule={() => { setSelectedWorkout(null); loadPlan() }}
          nearbyEvents={events.filter(e => {
            if (!selectedWorkout) return false
            const diff = Math.abs(
              Math.floor(new Date(e.date + 'T00:00:00Z').getTime() / 86400000) -
              Math.floor(new Date(selectedWorkout.date + 'T00:00:00Z').getTime() / 86400000)
            )
            return diff <= 7
          })}
          onEventLinked={(updated) => {
            setEvents(prev => prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e))
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
            setEvents(prev => prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e))
            setSelectedEvent(updated)
          }}
          onEdit={() => {
            setEditingEvent(selectedEvent)
            setSelectedEvent(null)
            setEventActivities([])
          }}
        />
      )}

      {editingEvent && (
        <AddEventModal
          initialEvent={editingEvent}
          onConfirm={async (updated) => { await updateEvent(editingEvent, updated) }}
          onClose={() => setEditingEvent(null)}
          hasPlan={!!planName}
          onRegenerate={(note) => startAdaptation(note)}
        />
      )}

      {showReviewModal && (
        <PlanReviewModal
          plan={reviewPlan}
          loading={reviewLoading}
          workoutsFound={reviewWorkoutsFound}
          estimatedWorkouts={reviewEstimatedWorkouts}
          onApprove={() => { setShowReviewModal(false); setReviewPlan(null); loadPlan() }}
          onReject={() => { setShowReviewModal(false); setReviewPlan(null) }}
        />
      )}
    </div>
  )
}
