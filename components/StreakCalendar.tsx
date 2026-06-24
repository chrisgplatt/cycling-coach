'use client'
import { useState } from 'react'
import type { ActivitySummary } from '@/types'
import { isoWeekStart } from '@/lib/chart-helpers'
import { computeWeeklyStreak, computeStreakActivityCount } from '@/lib/streak'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_LABELS = ['M','T','W','T','F','S','S']

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

interface WeekStatusProps {
  monday: string
  today: string
  dateSet: Set<string>
  streakWeeks: number
}

function WeekStatus({ monday, today, dateSet, streakWeeks }: WeekStatusProps) {
  const sunday = addDays(monday, 6)
  const isCurrentWeek = monday === isoWeekStart(today)
  const isComplete = sunday < today

  const hasActivity = (() => {
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i)
      if (d > today) break
      if (dateSet.has(d)) return true
    }
    return false
  })()

  if (isCurrentWeek && hasActivity && streakWeeks > 0) {
    return (
      <div data-testid="week-flame" className="flex items-center gap-0.5">
        <span className="text-orange-500 text-sm leading-none">🔥</span>
        <span className="text-[10px] font-bold text-orange-500">{streakWeeks}</span>
      </div>
    )
  }
  if (isComplete && hasActivity) {
    return (
      <div data-testid="week-check" className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
        <svg viewBox="0 0 10 10" className="w-3 h-3">
          <path d="M2 5 L4 7.5 L8 3" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    )
  }
  return <div className="w-5 h-5 rounded-full border border-gray-200"/>
}

function getMonthGrid(year: number, month: number): string[][] {
  // month is 1-indexed
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const dow = firstDay.getUTCDay()
  const daysFromMon = dow === 0 ? 6 : dow - 1
  const gridStart = new Date(firstDay)
  gridStart.setUTCDate(gridStart.getUTCDate() - daysFromMon)

  const rows: string[][] = []
  const cursor = new Date(gridStart)
  for (let row = 0; row < 6; row++) {
    const week: string[] = []
    for (let col = 0; col < 7; col++) {
      week.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    const hasMonthDay = week.some(d => {
      const dt = new Date(d + 'T00:00:00Z')
      return dt.getUTCMonth() + 1 === month && dt.getUTCFullYear() === year
    })
    if (hasMonthDay) rows.push(week)
    else if (rows.length > 0) break
  }
  return rows
}

function SportIcon({ type }: { type: string }) {
  if (/ride/i.test(type)) {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.3" className="w-3.5 h-3.5">
        <circle cx="4" cy="11" r="2.8"/>
        <circle cx="12" cy="11" r="2.8"/>
        <path d="M4 11 L8 5.5 L12 11"/>
        <path d="M8 5.5 L10.5 5.5"/>
        <circle cx="7.5" cy="8.2" r="1.2" fill="white" stroke="none"/>
      </svg>
    )
  }
  if (/run|walk/i.test(type)) {
    return (
      <svg viewBox="0 0 16 16" fill="white" className="w-3.5 h-3.5">
        <circle cx="10" cy="2.5" r="1.5"/>
        <path d="M6.5 5.5 L9 3.5 L11.5 5 L10 8.5 L13 12 L11.5 13 L8.5 10 L7 12 L4.5 11 L7 8 Z"/>
      </svg>
    )
  }
  if (/weight|strength|gym/i.test(type)) {
    return (
      <svg viewBox="0 0 16 16" fill="white" className="w-3.5 h-3.5">
        <rect x="1" y="5.5" width="2.5" height="5" rx="0.8"/>
        <rect x="12.5" y="5.5" width="2.5" height="5" rx="0.8"/>
        <rect x="3.5" y="6.8" width="9" height="2.4" rx="0.5"/>
      </svg>
    )
  }
  return <span className="block w-2 h-2 rounded-full bg-white"/>
}

interface Props {
  activities: ActivitySummary[]
  today: string  // YYYY-MM-DD
}

export default function StreakCalendar({ activities, today }: Props) {
  const [todayYear, todayMonth] = today.split('-').map(Number)
  const [viewYear, setViewYear] = useState(todayYear)
  const [viewMonth, setViewMonth] = useState(todayMonth)

  const dateSet = new Set(activities.map(a => a.date))
  const multiSet = new Map<string, number>()
  for (const a of activities) {
    multiSet.set(a.date, (multiSet.get(a.date) ?? 0) + 1)
  }

  // Primary type per day (first activity's type)
  const typeByDate = new Map<string, string>()
  for (const a of [...activities].reverse()) {
    typeByDate.set(a.date, a.type)
  }

  const streakWeeks = computeWeeklyStreak(activities, today)
  const streakActivities = computeStreakActivityCount(activities, today)

  const rows = getMonthGrid(viewYear, viewMonth)

  function prevMonth() {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1) }
    else setViewMonth(m => m + 1)
  }

  return (
    <div className="px-4 py-3">
      {/* Month nav + stats */}
      <div className="flex items-center justify-between mb-1">
        <button
          aria-label="Previous month"
          onClick={prevMonth}
          className="p-3 text-gray-400 hover:text-gray-600"
        >
          ‹
        </button>
        <span className="text-[13px] font-semibold text-gray-700">
          {MONTH_NAMES[viewMonth - 1]} {viewYear}
        </span>
        <button
          aria-label="Next month"
          onClick={nextMonth}
          className="p-3 text-gray-400 hover:text-gray-600 disabled:opacity-30"
          disabled={viewYear > todayYear || (viewYear === todayYear && viewMonth >= todayMonth)}
        >
          ›
        </button>
      </div>

      {streakWeeks > 0 && (
        <p className="text-[11px] text-gray-500 text-center mb-2">
          {streakWeeks} {streakWeeks === 1 ? 'Week' : 'Weeks'} · {streakActivities} {streakActivities === 1 ? 'Activity' : 'Activities'}
        </p>
      )}

      {/* Day-of-week headers */}
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_28px] gap-x-1 mb-1">
        {DOW_LABELS.map((l, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-gray-400">{l}</div>
        ))}
        <div/> {/* spacer for week-status column */}
      </div>

      {/* Calendar rows */}
      {rows.map((week, ri) => {
        const inMonth = (d: string) => {
          const dt = new Date(d + 'T00:00:00Z')
          return dt.getUTCMonth() + 1 === viewMonth && dt.getUTCFullYear() === viewYear
        }
        const monday = week[0]
        const dayNum = (d: string) => Number(d.split('-')[2])

        return (
          <div key={ri} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_28px] gap-x-1 mb-1 items-center">
            {week.map((day) => {
              const hasAct = dateSet.has(day)
              const isToday = day === today
              const isFuture = day > today
              const isIn = inMonth(day)

              if (!isIn) {
                return (
                  <div key={day} className="flex items-center justify-center h-7">
                    <span className="text-[10px] text-gray-200">{dayNum(day)}</span>
                  </div>
                )
              }

              if (hasAct) {
                return (
                  <div key={day} className="flex flex-col items-center">
                    <div
                      data-testid="activity-circle"
                      className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center"
                    >
                      <SportIcon type={typeByDate.get(day) ?? ''} />
                    </div>
                    {(multiSet.get(day) ?? 0) > 1 && (
                      <div className="w-1 h-1 rounded-full bg-gray-400 mt-0.5"/>
                    )}
                  </div>
                )
              }

              if (isFuture) {
                return (
                  <div key={day} className="flex items-center justify-center h-7">
                    <span className="text-[10px] text-gray-300">{dayNum(day)}</span>
                  </div>
                )
              }

              // Past day with no activity
              return (
                <div key={day} className="flex items-center justify-center h-7">
                  {isToday ? (
                    <div className="w-7 h-7 rounded-full ring-1 ring-gray-400 flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-gray-700">{dayNum(day)}</span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-400">{dayNum(day)}</span>
                  )}
                </div>
              )
            })}
            <div className="flex items-center justify-center">
              <WeekStatus monday={monday} today={today} dateSet={dateSet} streakWeeks={streakWeeks} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
