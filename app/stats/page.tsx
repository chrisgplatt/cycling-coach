'use client'
import { useEffect, useState } from 'react'
import type { RidingStats, CrossTrainingGroup, WeightEntry } from '@/types'
import RideStats, { rideStatsFromActivity, StatCell, SectionCard, formatDuration } from '@/components/RideStats'
import { weightAtDate } from '@/lib/weight-helpers'
import AnimatedLogo from '@/components/AnimatedLogo'
import YearView from '@/components/YearView'
import ActivityLogView from '@/components/ActivityLogView'
import { resolveMaxHr } from '@/lib/max-hr'

function formatRideTabLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}

function AggregateView({ stats }: { stats: RidingStats }) {
  const rightPct = stats.avg_left_right_balance
  const balance = rightPct !== null
    ? `${(100 - rightPct).toFixed(1)}% L / ${rightPct.toFixed(1)}% R`
    : '—'

  return (
    <div className="space-y-4">
      <SectionCard title="Best Power" accent="bg-orange-400">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="1 min"
            value={stats.power_1min !== null ? String(Math.round(stats.power_1min)) : '—'}
            unit={stats.power_1min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="5 min"
            value={stats.power_5min !== null ? String(Math.round(stats.power_5min)) : '—'}
            unit={stats.power_5min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="10 min"
            value={stats.power_10min !== null ? String(Math.round(stats.power_10min)) : '—'}
            unit={stats.power_10min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="20 min"
            value={stats.power_20min !== null ? String(Math.round(stats.power_20min)) : '—'}
            unit={stats.power_20min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
        </div>
      </SectionCard>

      <SectionCard title="Totals" accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="Distance"
            value={(Math.round(stats.total_distance_km * 10) / 10).toFixed(1)}
            unit="km"
            valueClass="text-blue-600"
          />
          <StatCell
            label="Elevation"
            value={String(Math.round(stats.total_elevation_m))}
            unit="m"
            valueClass="text-emerald-600"
          />
          <StatCell
            label="Duration"
            value={formatDuration(stats.total_duration_secs)}
            valueClass="text-violet-600"
          />
        </div>
      </SectionCard>

      {(stats.avg_hr !== null || stats.max_hr !== null) && (
        <SectionCard title="Heart Rate · 28 Days" accent="bg-red-400">
          <div className="flex divide-x divide-gray-100">
            {stats.avg_hr !== null && (
              <StatCell label="Avg HR" value={String(stats.avg_hr)} unit="bpm" valueClass="text-red-500" />
            )}
            {stats.max_hr !== null && (
              <StatCell label="Max HR" value={String(stats.max_hr)} unit="bpm" valueClass="text-red-600" />
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title="L/R Balance" accent="bg-rose-400">
        <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-500">{balance}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Avg Left / Right</div>
          {rightPct !== null && (
            <div className="text-[11px] text-gray-400 mt-0.5">from {stats.balance_ride_count} ride{stats.balance_ride_count !== 1 ? 's' : ''}</div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

const ACTIVITY_EMOJI: Record<string, string> = {
  Walk: '🚶', Hike: '🥾', Run: '🏃', VirtualRun: '🏃',
  WeightTraining: '🏋️', Yoga: '🧘', Swim: '🏊',
  Rowing: '🚣', Kayaking: '🛶',
}

function activityEmoji(type: string): string {
  return ACTIVITY_EMOJI[type] ?? '⚡'
}

function CrossTrainingSummary({ groups }: { groups: CrossTrainingGroup[] }) {
  if (!groups.length) return null

  const totalCount = groups.reduce((s, g) => s + g.count, 0)
  const totalSecs = groups.reduce((s, g) => s + g.total_duration_secs, 0)
  const totalDistKm = groups.reduce((s, g) => s + g.total_distance_m, 0) / 1000
  const totalTss = Math.round(groups.reduce((s, g) => s + g.total_tss, 0))

  return (
    <SectionCard title="Other Activity · 28 Days" accent="bg-emerald-500">
      <div className="divide-y divide-gray-100">
        {groups.map(g => (
          <div key={g.type} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="text-base">{activityEmoji(g.type)}</span>
              <div>
                <div className="text-sm font-semibold text-gray-800">{g.type}</div>
                <div className="text-[11px] text-gray-400">
                  {g.count} session{g.count !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-emerald-600">
                {formatDuration(g.total_duration_secs)}
              </div>
              <div className="text-[11px] text-gray-400">
                {g.total_distance_m > 0 && `${(g.total_distance_m / 1000).toFixed(1)} km · `}
                {Math.round(g.total_tss)} TSS
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-400">
        {totalCount} activities · {formatDuration(totalSecs)} total
        {totalDistKm > 0 && ` · ${totalDistKm.toFixed(1)} km`}
        {` · ${totalTss} TSS contributed`}
      </div>
    </SectionCard>
  )
}

export default function StatsPage() {
  const [stats, setStats] = useState<RidingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'year' | 'log' | '28d' | number>('year')
  const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
  const [effectiveMaxHr, setEffectiveMaxHr] = useState<number | null>(null)

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
    fetch('/api/weight-log')
      .then(r => r.json())
      .then(d => setWeightLog(d.entries ?? []))
      .catch(() => {})
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        const maxHr = resolveMaxHr({
          manual: data?.max_hr_manual ?? null,
          dateOfBirth: data?.date_of_birth ?? null,
          observed: data?.observed_max_hr ?? null,
        })
        setEffectiveMaxHr(maxHr?.value ?? null)
      })
      .catch(() => {})
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <AnimatedLogo size={56} />
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

  const rides = stats.recent_rides ?? []

  type TabId = 'year' | 'log' | '28d' | number
  const tabs: { id: TabId; label: string }[] = [
    { id: 'year', label: 'This Year' },
    { id: 'log', label: 'Activity Log' },
    { id: '28d', label: '28 Days' },
    ...rides.map((r, i) => ({ id: i as TabId, label: formatRideTabLabel(r.start_date_local) })),
  ]

  const subtitle = activeTab === 'year'
    ? 'All activities this year'
    : activeTab === 'log'
    ? 'All activities'
    : activeTab === '28d'
    ? `Last 28 days · ${stats.ride_count} ride${stats.ride_count !== 1 ? 's' : ''}`
    : formatRideTabLabel((stats.recent_rides ?? [])[activeTab as number]?.start_date_local ?? '')

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none" style={{ touchAction: 'pan-x' }}>
        {tabs.map(tab => (
          <button
            key={String(tab.id)}
            role="tab"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'year' ? (
        <YearView />
      ) : activeTab === 'log' ? (
        <ActivityLogView />
      ) : activeTab === '28d' ? (
        <>
          <AggregateView stats={stats} />
          <CrossTrainingSummary groups={stats.cross_training} />
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 font-medium truncate">{rides[activeTab as number].name}</p>
          {(() => {
            const ride = rides[activeTab as number]
            const rideStats = rideStatsFromActivity(ride)
            const w = weightAtDate(weightLog, ride.start_date_local.split('T')[0], null)
            if (w) {
              rideStats.avgWkg = rideStats.avgWatts !== null ? parseFloat((rideStats.avgWatts / w).toFixed(2)) : null
              rideStats.npWkg = rideStats.np !== null ? parseFloat((rideStats.np / w).toFixed(2)) : null
            }
            return <RideStats data={rideStats} effectiveMaxHr={effectiveMaxHr} />
          })()}
        </div>
      )}
    </main>
  )
}
