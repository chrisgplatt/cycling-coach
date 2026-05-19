'use client'
import { useEffect, useState } from 'react'
import type { RidingStats } from '@/types'

function StatCell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

export default function StatsPage() {
  const [stats, setStats] = useState<RidingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        if (!data.stats) throw new Error('No stats returned')
        setStats(data.stats)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  if (!stats) return null

  const balance = stats.avg_left_right_balance !== null
    ? `${stats.avg_left_right_balance.toFixed(1)}% L / ${(100 - stats.avg_left_right_balance).toFixed(1)}% R`
    : '—'

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Last 28 days · {stats.ride_count} ride{stats.ride_count !== 1 ? 's' : ''}
        </p>
      </div>

      <SectionCard title="Best Power">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="5 min"
            value={stats.power_5min !== null ? String(Math.round(stats.power_5min)) : '—'}
            unit={stats.power_5min !== null ? 'w' : undefined}
          />
          <StatCell
            label="10 min"
            value={stats.power_10min !== null ? String(Math.round(stats.power_10min)) : '—'}
            unit={stats.power_10min !== null ? 'w' : undefined}
          />
          <StatCell
            label="20 min"
            value={stats.power_20min !== null ? String(Math.round(stats.power_20min)) : '—'}
            unit={stats.power_20min !== null ? 'w' : undefined}
          />
        </div>
      </SectionCard>

      <SectionCard title="Totals">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Distance" value={(Math.round(stats.total_distance_km * 10) / 10).toFixed(1)} unit="km" />
          <StatCell label="Elevation" value={String(Math.round(stats.total_elevation_m))} unit="m" />
          <StatCell label="Duration" value={formatDuration(stats.total_duration_secs)} />
        </div>
      </SectionCard>

      <SectionCard title="L/R Balance">
        <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">{balance}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Avg Left / Right</div>
          {stats.avg_left_right_balance !== null && (
            <div className="text-[11px] text-gray-400 mt-0.5">from {stats.balance_ride_count} ride{stats.balance_ride_count !== 1 ? 's' : ''}</div>
          )}
        </div>
      </SectionCard>
    </main>
  )
}
