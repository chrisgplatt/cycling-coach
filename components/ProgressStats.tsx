'use client'
import { useState, useEffect } from 'react'
import type { ProgressMetrics, WeeklyProgress, EventCountdown, TrainingEvent, Workout } from '@/types'
import StreakCalendar from '@/components/StreakCalendar'
import ActivityStatsPanel from '@/components/ActivityStatsPanel'
import { computeWeeklyStreak, classifyTab, type ActivityTab } from '@/lib/streak'
import { isoWeekStart } from '@/lib/chart-helpers'
import { localDateStr } from '@/lib/local-date'
import type { ActivitySummary } from '@/types'

interface StatsData {
  metrics_snapshot: ProgressMetrics
}

const EVENT_ICON: Record<string, string> = {
  race: '🏆',
  sportive: '🚴',
  holiday: '🌴',
  fitness: '💪',
}

interface Props {
  syncVersion: number
  weeklyProgress?: WeeklyProgress | null
  eventCountdown?: EventCountdown | null
  upcomingEvents?: TrainingEvent[]
  upcomingTests?: Workout[]
  weeksRemainingInPlan?: number | null
  form?: number | null
  activities?: ActivitySummary[]
}

function fmtH(mins: number) {
  return `${(mins / 60).toFixed(1)}h`
}

export default function ProgressStats({ syncVersion, weeklyProgress, eventCountdown, upcomingEvents, upcomingTests, weeksRemainingInPlan, form, activities }: Props) {
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [streakOpen, setStreakOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    fetch('/api/progress-brief', { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { if (e.name !== 'AbortError') setLoading(false) })
    return () => ac.abort()
  }, [syncVersion])

  if (loading) return <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />

  const hasSeasonStats = data && (data.metrics_snapshot.ftp || data.metrics_snapshot.ctl || data.metrics_snapshot.adherence || data.metrics_snapshot.streak != null)
  const hasWeek = weeklyProgress && weeklyProgress.sessionsTotal > 0

  if (!hasSeasonStats && !hasWeek && !eventCountdown && !upcomingEvents?.length && !upcomingTests?.length && !activities?.length) return null

  const m = data?.metrics_snapshot

  const todayStr = localDateStr(new Date())
  const streakWeeks = activities?.length ? computeWeeklyStreak(activities, todayStr) : 0

  const activityHeaderSummary = (() => {
    if (!activities?.length) return null
    const monday = isoWeekStart(todayStr)
    const TABS: ActivityTab[] = ['Ride', 'Run', 'Walk', 'Other']
    const defaultTab = TABS.find(tab =>
      activities.some(a => {
        const d = new Date(monday + 'T00:00:00Z')
        d.setUTCDate(d.getUTCDate() - 11 * 7)
        return classifyTab(a.type) === tab && a.date >= d.toISOString().slice(0, 10)
      })
    ) ?? 'Ride'
    const thisWeek = activities.filter(a =>
      classifyTab(a.type) === defaultTab && a.date >= monday && a.date <= todayStr
    )
    if (defaultTab === 'Other') {
      const secs = thisWeek.reduce((s, a) => s + a.movingTimeSecs, 0)
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
      const t = h > 0 ? `${h}h ${m}m` : `${m}m`
      return thisWeek.length > 0 ? `${thisWeek.length} sessions · ${t}` : null
    }
    const km = thisWeek.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000
    const secs = thisWeek.reduce((s, a) => s + a.movingTimeSecs, 0)
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
    const t = h > 0 ? `${h}h ${m}m` : `${m}m`
    return km > 0 ? `${km.toFixed(1)} km · ${t}` : null
  })()

  const roundedForm = form != null ? Math.round(form) : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Progress</h2>
        {weeksRemainingInPlan != null && (
          <span className="text-[10px] font-semibold text-gray-400">{weeksRemainingInPlan}wk plan remaining</span>
        )}
      </div>
      {(() => {
        type EventRow = { kind: 'event'; date: string; label: string; icon: string; priority: string; priorityColour: string }
        type TestRow  = { kind: 'test';  date: string; label: string }
        const rows: (EventRow | TestRow)[] = []

        const eventList = upcomingEvents?.length
          ? upcomingEvents
          : eventCountdown
            ? [{ name: eventCountdown.name, date: '', type: 'race' as const, priority: 'A' as const, _daysAway: eventCountdown.daysAway }]
            : []

        for (const e of eventList) {
          const priorityColour = e.priority === 'A' ? 'text-red-500' : e.priority === 'B' ? 'text-amber-500' : 'text-slate-400'
          rows.push({ kind: 'event', date: e.date, label: e.name, icon: EVENT_ICON[e.type] ?? '🏁', priority: e.priority, priorityColour })
        }
        for (const t of upcomingTests ?? []) {
          const raw = t.description || 'Test session'
          const label = raw.split(/[,.]/)[ 0].trim() || raw
          rows.push({ kind: 'test', date: t.date, label })
        }

        rows.sort((a, b) => a.date.localeCompare(b.date))

        return rows.map((row, i) => {
          const daysAway = row.date
            ? Math.ceil((new Date(row.date).getTime() - Date.now()) / 86400000)
            : (eventCountdown?.daysAway ?? 0)
          const daysLabel = daysAway <= 0 ? 'Today!' : daysAway < 7 ? `${daysAway}d` : `${daysAway}d / ${Math.round(daysAway / 7)}w`
          return (
            <div key={i} className="px-4 py-1.5 border-b border-gray-100 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-gray-700 truncate">
                {row.kind === 'event' ? `${row.icon} ${row.label}` : `🧪 ${row.label}`}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {row.kind === 'event' && (
                  <span className={`text-[10px] font-bold ${row.priorityColour}`}>{row.priority}</span>
                )}
                <span className="text-[11px] font-bold text-gray-500">{daysLabel}</span>
              </div>
            </div>
          )
        })
      })()}
      {hasSeasonStats && m && (
        <div className="p-3 grid grid-cols-3 gap-2">
          {m.ftp && (
            <Tile label="FTP" value={`${m.ftp.current}W`} delta={m.ftp.delta} deltaSuffix="W" goodWhenPositive />
          )}
          {m.ctl && (
            <Tile label="Fitness" value={String(m.ctl.current)} delta={m.ctl.delta} deltaSuffix="pts" goodWhenPositive />
          )}
          {m.adherence && m.adherence.total > 0 && (
            <Tile
              label="Sessions"
              value={`${m.adherence.completed}/${m.adherence.total}`}
              pct={Math.round((m.adherence.completed / m.adherence.total) * 100)}
            />
          )}
          {m.streak != null && (
            <Tile label="Streak" value={m.streak > 0 ? `🔥 ${m.streak}` : `${m.streak}`} sub="weeks" />
          )}
          {roundedForm != null && (
            <Tile
              label="Form"
              value={roundedForm > 0 ? `+${roundedForm}` : String(roundedForm)}
              sub={roundedForm > 5 ? 'fresh' : roundedForm >= -15 ? 'building' : 'tired'}
              subColour={roundedForm > 5 ? 'text-emerald-600' : roundedForm >= -15 ? 'text-amber-500' : 'text-red-500'}
            />
          )}
        </div>
      )}
      {hasWeek && weeklyProgress && (
        <>
          {hasSeasonStats && <div className="mx-3 border-t border-gray-100" />}
          <div className="px-4 pt-2 pb-1">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.06em]">This Week</span>
          </div>
          <div className="px-3 pb-3 grid grid-cols-3 gap-2">
            <Tile
              label="Sessions"
              value={`${weeklyProgress.sessionsCompleted}/${weeklyProgress.sessionsTotal}`}
              pct={Math.round((weeklyProgress.sessionsCompleted / weeklyProgress.sessionsTotal) * 100)}
            />
            <Tile
              label="TSS"
              value={String(weeklyProgress.tssActual)}
              sub={`of ${weeklyProgress.tssPlanned}`}
            />
            <Tile
              label="Time"
              value={fmtH(weeklyProgress.timeActualMins)}
              sub={`of ${fmtH(weeklyProgress.timePlannedMins)}`}
            />
            <Tile label="Fitness" value={weeklyProgress.fitnessCtl !== null ? String(weeklyProgress.fitnessCtl) : '—'} sub="CTL" />
            <Tile
              label="Distance"
              value={weeklyProgress.distanceKm > 0
                ? `${weeklyProgress.distanceKm < 10 ? weeklyProgress.distanceKm.toFixed(1) : Math.round(weeklyProgress.distanceKm)}km`
                : '—'}
            />
            <Tile
              label="Elevation"
              value={weeklyProgress.elevationM > 0 ? `${Math.floor(weeklyProgress.elevationM)}m` : '—'}
            />
          </div>
        </>
      )}
      {activities && activities.length > 0 && (
        <>
          {/* Streak collapsible */}
          <div className="border-t border-gray-100">
            <button
              onClick={() => setStreakOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-2.5 min-h-[44px]"
            >
              <span className="text-[12px] font-semibold text-gray-700">
                🔥 Streak{streakWeeks > 0 ? ` · ${streakWeeks} wks` : ''}
              </span>
              <svg
                viewBox="0 0 10 6"
                className={`w-3 h-3 text-gray-400 transition-transform ${streakOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="1.5"
              >
                <path d="M1 1 L5 5 L9 1"/>
              </svg>
            </button>
            {streakOpen && <StreakCalendar activities={activities} today={todayStr} />}
          </div>

          {/* Activity stats collapsible */}
          <div className="border-t border-gray-100">
            <button
              onClick={() => setActivityOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-2.5 min-h-[44px]"
            >
              <span className="text-[12px] font-semibold text-gray-700">
                Activity{activityHeaderSummary ? ` · ${activityHeaderSummary}` : ''}
              </span>
              <svg
                viewBox="0 0 10 6"
                className={`w-3 h-3 text-gray-400 transition-transform ${activityOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="1.5"
              >
                <path d="M1 1 L5 5 L9 1"/>
              </svg>
            </button>
            {activityOpen && <ActivityStatsPanel activities={activities} today={todayStr} />}
          </div>
        </>
      )}
    </div>
  )
}

interface TileProps {
  label: string
  value: string
  delta?: number
  goodWhenPositive?: boolean
  pct?: number
  sub?: string
  subColour?: string
  deltaSuffix?: string
}

function Tile({ label, value, delta, goodWhenPositive, pct, sub, subColour, deltaSuffix = '' }: TileProps) {
  let badge = ''
  let badgeColour = 'text-gray-400'

  if (pct !== undefined) {
    badge = `${pct}%`
    badgeColour = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'
  } else if (sub) {
    badge = sub
    if (subColour) badgeColour = subColour
  } else if (delta !== undefined && delta !== 0) {
    badge = `${delta > 0 ? '+' : ''}${delta}${deltaSuffix}`
    const isGood = goodWhenPositive ? delta > 0 : delta < 0
    badgeColour = isGood ? 'text-emerald-600' : 'text-amber-500'
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 px-2 py-2 text-center">
      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide truncate mb-0.5">{label}</div>
      <div className="text-sm font-bold text-gray-900 leading-tight">{value}</div>
      {badge && <div className={`text-[10px] font-semibold mt-0.5 ${badgeColour}`}>{badge}</div>}
    </div>
  )
}
