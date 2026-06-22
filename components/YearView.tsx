'use client'
import { useEffect, useState } from 'react'
import AnimatedLogo from '@/components/AnimatedLogo'
import { StatCell, SectionCard, formatDuration } from '@/components/RideStats'

interface MonthlyBucket { month: number; km: number }

interface YearStats {
  year: number
  totalRides: number
  totalKm: number
  totalElevationM: number
  totalMovingTimeSecs: number
  monthly: MonthlyBucket[]
}

const MONTHS_SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function MonthlyBarChart({ monthly, year }: { monthly: MonthlyBucket[]; year: number }) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const maxKm = Math.max(...monthly.map(b => b.km), 1)
  const svgLeft = 28, svgRight = 332, svgTop = 8, svgBottom = 88
  const chartW = svgRight - svgLeft
  const chartH = svgBottom - svgTop
  const slotW = chartW / 12
  const barW = Math.max(slotW - 4, 4)
  const yOf = (km: number) => svgBottom - (km / maxKm) * chartH
  const ticks = [0, Math.round(maxKm / 2), Math.round(maxKm)]

  return (
    <svg viewBox="0 0 360 104" className="w-full">
      {ticks.map(v => (
        <g key={v}>
          <line x1={svgLeft - 2} y1={yOf(v)} x2={svgRight} y2={yOf(v)} stroke="#f1f5f9" strokeWidth="1" />
          <text x={svgLeft - 4} y={yOf(v)} textAnchor="end" dominantBaseline="middle" fontSize="8" fill="#9ca3af">
            {v}
          </text>
        </g>
      ))}
      {monthly.map(({ month, km }) => {
        const isFuture = year === currentYear && month > currentMonth
        const isCurrent = year === currentYear && month === currentMonth
        const x = svgLeft + (month - 1) * slotW + (slotW - barW) / 2
        const barH = isFuture ? 0 : Math.max((km / maxKm) * chartH, km > 0 ? 2 : 0)
        const y = svgBottom - barH
        return (
          <g key={month}>
            {isFuture
              ? <rect x={x} y={svgBottom - 4} width={barW} height={4} rx={1} fill="#e5e7eb" />
              : <rect x={x} y={y} width={barW} height={barH} rx={1} fill={isCurrent ? '#3b82f6' : '#93c5fd'} />
            }
            <text
              x={svgLeft + (month - 1) * slotW + slotW / 2}
              y={svgBottom + 10}
              textAnchor="middle"
              fontSize="8"
              fill={isCurrent ? '#3b82f6' : '#9ca3af'}
              fontWeight={isCurrent ? 'bold' : 'normal'}
            >
              {MONTHS_SHORT[month - 1]}
            </text>
          </g>
        )
      })}
    </svg>
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
      .then(r => r.json())
      .then((d: YearStats & { error?: string }) => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch((e: Error) => setError(e.message))
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
    <div className="space-y-4">
      <SectionCard title={`${year} Totals`} accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Rides" value={String(data.totalRides)} valueClass="text-blue-600" />
          <StatCell
            label="Distance"
            value={(Math.round(data.totalKm * 10) / 10).toFixed(1)}
            unit="km"
            valueClass="text-blue-600"
          />
          <StatCell
            label="Elevation"
            value={String(data.totalElevationM)}
            unit="m"
            valueClass="text-emerald-600"
          />
          <StatCell
            label="Hours"
            value={formatDuration(data.totalMovingTimeSecs)}
            valueClass="text-violet-600"
          />
        </div>
      </SectionCard>

      <SectionCard title="Distance by Month" accent="bg-blue-400">
        <div className="px-3 py-3">
          <MonthlyBarChart monthly={data.monthly} year={year} />
        </div>
      </SectionCard>

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
