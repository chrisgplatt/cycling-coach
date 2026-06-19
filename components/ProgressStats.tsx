'use client'
import { useState, useEffect } from 'react'
import type { ProgressMetrics, WeeklyProgress, EventCountdown, TrainingEvent } from '@/types'

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
  weeksRemainingInPlan?: number | null
  form?: number | null
}

function fmtH(mins: number) {
  return `${(mins / 60).toFixed(1)}h`
}

export default function ProgressStats({ syncVersion, weeklyProgress, eventCountdown, upcomingEvents, weeksRemainingInPlan, form }: Props) {
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (!hasSeasonStats && !hasWeek && !eventCountdown && !upcomingEvents?.length) return null

  const m = data?.metrics_snapshot

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Progress</h2>
        {weeksRemainingInPlan != null && (
          <span className="text-[10px] font-semibold text-gray-400">{weeksRemainingInPlan}wk plan remaining</span>
        )}
      </div>
      {(upcomingEvents?.length ? upcomingEvents : eventCountdown ? [{ name: eventCountdown.name, date: '', type: 'race' as const, priority: 'A' as const, _daysAway: eventCountdown.daysAway }] : []).map((e, i) => {
        const daysAway = '_daysAway' in e ? (e as { _daysAway: number })._daysAway : Math.ceil((new Date(e.date).getTime() - Date.now()) / 86400000)
        const priorityColour = (e.priority === 'A') ? 'text-red-500' : (e.priority === 'B') ? 'text-amber-500' : 'text-slate-400'
        const icon = EVENT_ICON[e.type] ?? '🏁'
        return (
          <div key={i} className="px-4 py-1.5 border-b border-gray-100 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-gray-700 truncate">{icon} {e.name}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] font-bold ${priorityColour}`}>{e.priority}</span>
              <span className="text-[11px] font-bold text-gray-500">
                {daysAway <= 0 ? 'Today!' : daysAway < 7 ? `${daysAway}d` : `${daysAway}d / ${Math.round(daysAway / 7)}w`}
              </span>
            </div>
          </div>
        )
      })}
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
{form != null && (
            <Tile
              label="Form"
              value={form > 0 ? `+${form}` : String(form)}
              sub={form > 5 ? 'fresh' : form >= -15 ? 'building' : 'tired'}
              subColour={form > 5 ? 'text-emerald-600' : form >= -15 ? 'text-amber-500' : 'text-red-500'}
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
