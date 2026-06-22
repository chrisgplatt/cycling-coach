'use client'
import { useEffect, useState } from 'react'
import AnimatedLogo from '@/components/AnimatedLogo'
import { StatCell, SectionCard, formatDuration } from '@/components/RideStats'

interface MonthlyBucket { month: number; km: number; count: number }

interface ActivityGroupStats {
  key: string
  label: string
  emoji: string
  chartMetric: 'km' | 'count'
  totalActivities: number
  totalKm: number
  totalElevationM: number
  totalMovingTimeSecs: number
  monthly: MonthlyBucket[]
}

interface YearStats {
  year: number
  groups: ActivityGroupStats[]
}

const MONTHS_SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

const GROUP_CONFIG: Record<string, {
  accent: string
  valueClass: string
  barActive: string
  barInactive: string
  chartLabel: string
}> = {
  ride:  { accent: 'bg-blue-500',    valueClass: 'text-blue-600',   barActive: '#3b82f6', barInactive: '#93c5fd', chartLabel: 'km'      },
  run:   { accent: 'bg-orange-400',  valueClass: 'text-orange-500', barActive: '#f97316', barInactive: '#fdba74', chartLabel: 'km'      },
  walk:  { accent: 'bg-emerald-500', valueClass: 'text-emerald-600',barActive: '#10b981', barInactive: '#6ee7b7', chartLabel: 'km'      },
  other: { accent: 'bg-violet-500',  valueClass: 'text-violet-600', barActive: '#8b5cf6', barInactive: '#c4b5fd', chartLabel: 'sessions'},
}

const DEFAULT_CONFIG = GROUP_CONFIG.ride

function getConfig(key: string) {
  return GROUP_CONFIG[key] ?? DEFAULT_CONFIG
}

function MonthlyBarChart({
  monthly, year, metric, barActive, barInactive,
}: {
  monthly: MonthlyBucket[]
  year: number
  metric: 'km' | 'count'
  barActive: string
  barInactive: string
}) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const getValue = (b: MonthlyBucket) => metric === 'km' ? b.km : b.count
  const maxVal = Math.max(...monthly.map(getValue), 1)
  const svgLeft = 28, svgRight = 332, svgTop = 8, svgBottom = 88
  const chartW = svgRight - svgLeft
  const chartH = svgBottom - svgTop
  const slotW = chartW / 12
  const barW = Math.max(slotW - 4, 4)
  const yOf = (v: number) => svgBottom - (v / maxVal) * chartH
  const ticks = [0, Math.round(maxVal / 2), Math.round(maxVal)]

  return (
    <svg viewBox="0 0 360 104" className="w-full">
      {ticks.map((v, i) => (
        <g key={`tick-${i}`}>
          <line x1={svgLeft - 2} y1={yOf(v)} x2={svgRight} y2={yOf(v)} stroke="#f1f5f9" strokeWidth="1" />
          <text x={svgLeft - 4} y={yOf(v)} textAnchor="end" dominantBaseline="middle" fontSize="8" fill="#9ca3af">
            {v}
          </text>
        </g>
      ))}
      {monthly.map(b => {
        const isFuture = year === currentYear && b.month > currentMonth
        const isCurrent = year === currentYear && b.month === currentMonth
        const val = getValue(b)
        const x = svgLeft + (b.month - 1) * slotW + (slotW - barW) / 2
        const barH = isFuture ? 0 : Math.max((val / maxVal) * chartH, val > 0 ? 2 : 0)
        const y = svgBottom - barH
        return (
          <g key={b.month}>
            {isFuture
              ? <rect x={x} y={svgBottom - 4} width={barW} height={4} rx={1} fill="#e5e7eb" />
              : <rect x={x} y={y} width={barW} height={barH} rx={1} fill={isCurrent ? barActive : barInactive} />
            }
            <text
              x={svgLeft + (b.month - 1) * slotW + slotW / 2}
              y={svgBottom + 10}
              textAnchor="middle"
              fontSize="8"
              fill={isCurrent ? barActive : '#9ca3af'}
              fontWeight={isCurrent ? 'bold' : 'normal'}
            >
              {MONTHS_SHORT[b.month - 1]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function GroupPanel({ group, year }: { group: ActivityGroupStats; year: number }) {
  const cfg = getConfig(group.key)
  return (
    <div className="space-y-3">
      <SectionCard title={`${year} ${group.label}`} accent={cfg.accent}>
        <div className="flex divide-x divide-gray-100">
          <StatCell label={group.label} value={String(group.totalActivities)} valueClass={cfg.valueClass} />
          {group.totalKm > 0 && (
            <StatCell label="Distance" value={group.totalKm.toFixed(1)} unit="km" valueClass={cfg.valueClass} />
          )}
          {group.totalElevationM > 0 && (
            <StatCell label="Elevation" value={String(group.totalElevationM)} unit="m" valueClass="text-emerald-600" />
          )}
          <StatCell label="Hours" value={formatDuration(group.totalMovingTimeSecs)} valueClass="text-violet-600" />
        </div>
      </SectionCard>

      <SectionCard title={`${group.label} by Month (${cfg.chartLabel})`} accent={cfg.accent}>
        <div className="px-3 py-3">
          <MonthlyBarChart
            monthly={group.monthly}
            year={year}
            metric={group.chartMetric}
            barActive={cfg.barActive}
            barInactive={cfg.barInactive}
          />
        </div>
      </SectionCard>
    </div>
  )
}

export default function YearView() {
  const currentYear = new Date().getFullYear()
  const minYear = currentYear - 4

  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<YearStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData(null)
    fetch(`/api/stats/year?year=${year}`)
      .then(r => {
        if (!r.ok) throw new Error(`Request failed: ${r.status}`)
        return r.json()
      })
      .then((d: YearStats & { error?: string }) => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [year])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <AnimatedLogo size={48} />
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-6">
      {data.groups.length === 0 && (
        <p className="text-sm text-gray-400 p-4 text-center">No activities recorded in {year}.</p>
      )}

      {data.groups.map(group => (
        <GroupPanel key={group.key} group={group} year={year} />
      ))}

      <div className="flex items-center justify-center gap-6 py-2">
        <button
          onClick={() => setYear(y => y - 1)}
          disabled={year <= minYear}
          className="text-2xl text-gray-400 disabled:opacity-30 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Previous year"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-gray-700 w-12 text-center">{year}</span>
        <button
          onClick={() => setYear(y => y + 1)}
          disabled={year >= currentYear}
          className="text-2xl text-gray-400 disabled:opacity-30 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Next year"
        >
          →
        </button>
      </div>
    </div>
  )
}
