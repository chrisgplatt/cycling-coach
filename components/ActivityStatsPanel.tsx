'use client'
import { useState } from 'react'
import type { ActivitySummary } from '@/types'
import { classifyTab, type ActivityTab } from '@/lib/streak'
import { isoWeekStart } from '@/lib/chart-helpers'

const TABS: ActivityTab[] = ['Ride', 'Walk', 'Run', 'Other']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const TAB_ICONS: Record<ActivityTab, string> = {
  Ride: '🚲',
  Walk: '🚶',
  Run: '👟',
  Other: '●',
}

const TAB_LABELS: Record<ActivityTab, string> = {
  Ride: 'Rides',
  Walk: 'Walks',
  Run: 'Runs',
  Other: 'Other',
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

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
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

const W = 320, H = 82
const PAD_T = 16, PAD_B = 18, PAD_L = 30, PAD_R = 4
const CW = W - PAD_L - PAD_R
const CH = H - PAD_T - PAD_B

interface TypePanelProps {
  tab: ActivityTab
  buckets: WeekBucket[]
  today: string
}

function TypePanel({ tab, buckets, today }: TypePanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(11)

  const vals = buckets.map(b => tab === 'Other' ? b.sessions : b.distanceKm)
  const maxVal = Math.max(...vals, 1)
  const hasData = maxVal > 1

  const sel = buckets[selectedIdx]
  const selIsCurrentWeek = selectedIdx === 11

  const xOf = (i: number) => PAD_L + (i / 11) * CW
  const yOf = (v: number) => PAD_T + CH - (v / maxVal) * CH

  const areaD = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')
    + ` L${xOf(11).toFixed(1)},${(PAD_T + CH).toFixed(1)} L${xOf(0).toFixed(1)},${(PAD_T + CH).toFixed(1)} Z`

  const lineD = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')

  const xLabels = buckets.map((b, i) => {
    if (i === 0) return MONTHS[new Date(b.weekStart + 'T00:00:00Z').getUTCMonth()]
    const prev = new Date(buckets[i - 1].weekStart + 'T00:00:00Z').getUTCMonth()
    const cur  = new Date(b.weekStart + 'T00:00:00Z').getUTCMonth()
    return cur !== prev ? MONTHS[cur] : null
  })

  const fmtAxisVal = (v: number) =>
    tab === 'Other' ? `${Math.round(v)}` : v >= 10 ? `${Math.round(v)}` : `${v.toFixed(1)}`

  const selCallout = tab === 'Other'
    ? `${sel.sessions}`
    : sel.distanceKm > 0 ? `${sel.distanceKm.toFixed(1)}` : '0'

  // Current-week headline for the panel header
  const currentBucket = buckets[11]
  const headline = tab === 'Other'
    ? currentBucket.sessions > 0 ? `${currentBucket.sessions} ${currentBucket.sessions === 1 ? 'session' : 'sessions'}` : null
    : currentBucket.distanceKm > 0 ? `${currentBucket.distanceKm.toFixed(1)} km` : null

  return (
    <div className="px-4 pt-3 pb-2">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-gray-700">
          {TAB_ICONS[tab]} {TAB_LABELS[tab]}
        </span>
        {headline && (
          <span className="text-[11px] text-gray-400">{headline} this week</span>
        )}
      </div>

      {/* Week label */}
      <p className="text-[10px] text-gray-400 text-center mb-1">
        {selIsCurrentWeek ? 'This week' : `w/c ${fmtDate(sel.weekStart)}`}
      </p>

      {/* Stats row */}
      <div className={`grid gap-2 mb-3 ${tab === 'Other' ? 'grid-cols-2' : 'grid-cols-4'}`}>
        {tab === 'Other' ? (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Sessions</div>
              <div className="text-base font-bold text-gray-900">
                {sel.sessions === 1 ? '1 session' : `${sel.sessions} sessions`}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Distance</div>
              <div className="text-base font-bold text-gray-900">{sel.distanceKm > 0 ? `${sel.distanceKm.toFixed(1)} km` : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Elevation</div>
              <div className="text-base font-bold text-gray-900">{sel.elevationM > 0 ? `${sel.elevationM} m` : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{TAB_LABELS[tab]}</div>
              <div className="text-base font-bold text-gray-900">{sel.sessions}</div>
            </div>
          </>
        )}
      </div>

      {/* Chart */}
      <div className="relative w-full">
        <svg
          data-testid="activity-chart"
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: H }}
        >
          {hasData && (
            <>
              <line x1={PAD_L - 1} y1={PAD_T} x2={PAD_L - 1} y2={PAD_T + CH} stroke="#e5e7eb" strokeWidth="1"/>
              <text x={PAD_L - 4} y={PAD_T + 3} textAnchor="end" fontSize="8" fill="#9ca3af">{fmtAxisVal(maxVal)}</text>
              <text x={PAD_L - 4} y={PAD_T + CH} textAnchor="end" fontSize="8" fill="#9ca3af">0</text>
            </>
          )}
          <path d={areaD} fill="rgb(255 237 213)" opacity="0.8"/>
          <path d={lineD} fill="none" stroke="#f97316" strokeWidth="1.5"/>
          {vals.map((v, i) => {
            const isCurrentWeek = i === 11
            const isSelected = i === selectedIdx
            const cx = xOf(i)
            const cy = yOf(v)
            const calloutAnchor = i <= 1 ? 'start' : i >= 10 ? 'end' : 'middle'
            const hitX = i === 0 ? PAD_L : (xOf(i - 1) + cx) / 2
            const hitRight = i === 11 ? PAD_L + CW : (cx + xOf(i + 1)) / 2
            return (
              <g key={i}>
                {isCurrentWeek && (
                  <line x1={cx.toFixed(1)} y1={PAD_T} x2={cx.toFixed(1)} y2={PAD_T + CH}
                    stroke="#f97316" strokeWidth="1" strokeDasharray="2 2"/>
                )}
                <circle cx={cx} cy={cy} r={isSelected ? 5 : 3}
                  fill={isSelected || isCurrentWeek ? '#f97316' : 'white'}
                  stroke="#f97316" strokeWidth={isSelected ? 0 : 1.2}/>
                {isSelected && (
                  <text x={cx} y={Math.max(cy - 7, PAD_T - 2)}
                    textAnchor={calloutAnchor} fontSize="9" fontWeight="600" fill="#f97316">
                    {selCallout}
                  </text>
                )}
                <rect x={hitX} y={PAD_T} width={hitRight - hitX} height={CH}
                  fill="transparent" style={{ cursor: 'pointer' }} onClick={() => setSelectedIdx(i)}/>
              </g>
            )
          })}
          {xLabels.map((label, i) =>
            label ? (
              <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">{label}</text>
            ) : null
          )}
        </svg>
      </div>
    </div>
  )
}

interface Props {
  activities: ActivitySummary[]
  today: string
}

export default function ActivityStatsPanel({ activities, today }: Props) {
  const allBuckets = Object.fromEntries(
    TABS.map(tab => [tab, buildBuckets(activities, tab, today)])
  ) as Record<ActivityTab, WeekBucket[]>

  const activeTabs = TABS.filter(tab =>
    allBuckets[tab].some(b => tab === 'Other' ? b.sessions > 0 : b.distanceKm > 0)
  )

  if (activeTabs.length === 0) {
    return (
      <div className="px-4 py-4 text-[13px] text-gray-400 text-center">
        No activities in the last 12 weeks
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {activeTabs.map(tab => (
        <TypePanel key={tab} tab={tab} buckets={allBuckets[tab]} today={today} />
      ))}
    </div>
  )
}
