'use client'
import { useState } from 'react'
import type { ActivitySummary } from '@/types'
import { classifyTab, type ActivityTab } from '@/lib/streak'
import { isoWeekStart } from '@/lib/chart-helpers'

const TABS: ActivityTab[] = ['Ride', 'Run', 'Walk', 'Other']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const TAB_ICONS: Record<ActivityTab, string> = {
  Ride: '🚲',
  Run: '👟',
  Walk: '🚶',
  Other: '●',
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

interface WeekBucket {
  weekStart: string
  distanceKm: number
  elevationM: number
  timeSecs: number
  sessions: number
}

function buildBuckets(activities: ActivitySummary[], tab: ActivityTab, today: string): WeekBucket[] {
  const monday = isoWeekStart(today)
  return Array.from({ length: 12 }, (_, i) => {
    const weekStart = addDays(monday, -(11 - i) * 7)
    const weekEnd = addDays(weekStart, 6)
    const week = activities.filter(a =>
      a.date >= weekStart && a.date <= weekEnd && a.date <= today && classifyTab(a.type) === tab
    )
    return {
      weekStart,
      distanceKm: week.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000,
      elevationM: Math.round(week.reduce((s, a) => s + (a.elevationM ?? 0), 0)),
      timeSecs: week.reduce((s, a) => s + a.movingTimeSecs, 0),
      sessions: week.length,
    }
  })
}

const W = 320, H = 70
const PAD_T = 8, PAD_B = 18, PAD_L = 4, PAD_R = 4
const CW = W - PAD_L - PAD_R
const CH = H - PAD_T - PAD_B

interface Props {
  activities: ActivitySummary[]
  today: string  // YYYY-MM-DD
}

export default function ActivityStatsPanel({ activities, today }: Props) {
  const defaultTab = TABS.find(tab =>
    activities.some(a => {
      const monday = isoWeekStart(today)
      return classifyTab(a.type) === tab && a.date >= addDays(monday, -11 * 7)
    })
  ) ?? 'Ride'

  const [tab, setTab] = useState<ActivityTab>(defaultTab)

  const monday = isoWeekStart(today)
  const thisWeek = activities.filter(a =>
    classifyTab(a.type) === tab && a.date >= monday && a.date <= today
  )
  const thisWeekKm   = thisWeek.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000
  const thisWeekElev = Math.round(thisWeek.reduce((s, a) => s + (a.elevationM ?? 0), 0))
  const thisWeekSecs = thisWeek.reduce((s, a) => s + a.movingTimeSecs, 0)
  const thisWeekSessions = thisWeek.length

  const buckets = buildBuckets(activities, tab, today)
  const vals = buckets.map(b => tab === 'Other' ? b.sessions : b.distanceKm)
  const maxVal = Math.max(...vals, 1)

  const xOf = (i: number) => PAD_L + (i / 11) * CW
  const yOf = (v: number) => PAD_T + CH - (v / maxVal) * CH

  // SVG area fill
  const areaD = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')
    + ` L${xOf(11).toFixed(1)},${(PAD_T + CH).toFixed(1)} L${xOf(0).toFixed(1)},${(PAD_T + CH).toFixed(1)} Z`

  // SVG line
  const lineD = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')

  // x-axis month labels
  const xLabels = buckets.map((b, i) => {
    if (i === 0) return MONTHS[new Date(b.weekStart + 'T00:00:00Z').getUTCMonth()]
    const prev = new Date(buckets[i - 1].weekStart + 'T00:00:00Z').getUTCMonth()
    const cur  = new Date(b.weekStart + 'T00:00:00Z').getUTCMonth()
    return cur !== prev ? MONTHS[cur] : null
  })

  return (
    <div className="px-4 py-3">
      {/* Tab row */}
      <div className="flex gap-2 mb-3 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            role="button"
            aria-label={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1 px-3 py-2.5 rounded-full text-[12px] font-semibold border shrink-0 min-h-[44px] ${
              tab === t
                ? 'border-orange-400 text-orange-500 bg-orange-50'
                : 'border-gray-200 text-gray-500 bg-white'
            }`}
          >
            <span>{TAB_ICONS[t]}</span>
            <span>{t}</span>
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className={`grid gap-2 mb-3 ${tab === 'Other' ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {tab === 'Other' ? (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Sessions</div>
              <div className="text-base font-bold text-gray-900">
                {thisWeekSessions === 1 ? '1 session' : `${thisWeekSessions} sessions`}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{thisWeekSecs > 0 ? fmtTime(thisWeekSecs) : '—'}</div>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Distance</div>
              <div className="text-base font-bold text-gray-900">{thisWeekKm > 0 ? `${thisWeekKm.toFixed(1)} km` : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{thisWeekSecs > 0 ? fmtTime(thisWeekSecs) : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Elevation</div>
              <div className="text-base font-bold text-gray-900">{thisWeekElev > 0 ? `${thisWeekElev} m` : '—'}</div>
            </div>
          </>
        )}
      </div>

      {/* Line chart */}
      <div className="relative w-full">
        <svg
          data-testid="activity-chart"
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 70 }}
        >
          {/* Area fill */}
          <path d={areaD} fill="rgb(255 237 213)" opacity="0.8"/>

          {/* Line */}
          <path d={lineD} fill="none" stroke="#f97316" strokeWidth="1.5"/>

          {/* Dots */}
          {vals.map((v, i) => {
            const isCurrentWeek = i === 11
            return isCurrentWeek ? (
              <g key={i}>
                <line
                  x1={xOf(i).toFixed(1)} y1={PAD_T}
                  x2={xOf(i).toFixed(1)} y2={PAD_T + CH}
                  stroke="#f97316" strokeWidth="1" strokeDasharray="2 2"
                />
                <circle cx={xOf(i)} cy={yOf(v)} r="4" fill="#f97316"/>
              </g>
            ) : (
              <circle key={i} cx={xOf(i)} cy={yOf(v)} r="3" fill="white" stroke="#f97316" strokeWidth="1.2"/>
            )
          })}

          {/* x-axis month labels */}
          {xLabels.map((label, i) =>
            label ? (
              <text
                key={i}
                x={xOf(i)}
                y={H - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#9ca3af"
              >
                {label}
              </text>
            ) : null
          )}
        </svg>
      </div>
    </div>
  )
}
