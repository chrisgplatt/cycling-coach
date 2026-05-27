'use client'
import { useEffect, useState } from 'react'
import type { RidingStats, ICUActivity, CrossTrainingGroup } from '@/types'

function StatCell({
  label, value, unit, valueClass = 'text-gray-900',
}: {
  label: string; value: string; unit?: string; valueClass?: string
}) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4">
      <div className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${valueClass}`}>
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
    </div>
  )
}

function SectionCard({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-gray-200 flex items-center gap-2 ${accent ? 'bg-white' : 'bg-gray-50'}`}>
        {accent && <span className={`w-2 h-2 rounded-full ${accent}`} />}
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

function formatRideTabLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}

function RideView({ ride }: { ride: ICUActivity }) {
  const leftPct = ride.left_right_balance
  const balance = leftPct !== null
    ? `${leftPct.toFixed(1)}% L / ${(100 - leftPct).toFixed(1)}% R`
    : null

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 font-medium truncate">{ride.name}</p>

      <SectionCard title="Power" accent="bg-orange-400">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="Avg W"
            value={ride.average_watts !== null ? String(Math.round(ride.average_watts)) : '—'}
            unit={ride.average_watts !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="NP"
            value={ride.weighted_average_watts !== null ? String(Math.round(ride.weighted_average_watts)) : '—'}
            unit={ride.weighted_average_watts !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="TSS"
            value={ride.training_load !== null ? String(Math.round(ride.training_load)) : '—'}
            valueClass="text-orange-500"
          />
        </div>
      </SectionCard>

      {(ride.power_1min != null || ride.power_5min != null || ride.power_10min != null || ride.power_20min != null) && (
        <SectionCard title="Best Power" accent="bg-orange-400">
          <div className="flex divide-x divide-gray-100">
            <StatCell
              label="1 min"
              value={ride.power_1min != null ? String(Math.round(ride.power_1min)) : '—'}
              unit={ride.power_1min != null ? 'w' : undefined}
              valueClass="text-orange-500"
            />
            <StatCell
              label="5 min"
              value={ride.power_5min != null ? String(Math.round(ride.power_5min)) : '—'}
              unit={ride.power_5min != null ? 'w' : undefined}
              valueClass="text-orange-500"
            />
            <StatCell
              label="10 min"
              value={ride.power_10min != null ? String(Math.round(ride.power_10min)) : '—'}
              unit={ride.power_10min != null ? 'w' : undefined}
              valueClass="text-orange-500"
            />
            <StatCell
              label="20 min"
              value={ride.power_20min != null ? String(Math.round(ride.power_20min)) : '—'}
              unit={ride.power_20min != null ? 'w' : undefined}
              valueClass="text-orange-500"
            />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Ride Totals" accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="Distance"
            value={ride.distance !== null ? (Math.round(ride.distance / 100) / 10).toFixed(1) : '—'}
            unit={ride.distance !== null ? 'km' : undefined}
            valueClass="text-blue-600"
          />
          <StatCell
            label="Elevation"
            value={ride.total_elevation_gain !== null ? String(Math.round(ride.total_elevation_gain)) : '—'}
            unit={ride.total_elevation_gain !== null ? 'm' : undefined}
            valueClass="text-emerald-600"
          />
          <StatCell
            label="Duration"
            value={formatDuration(ride.moving_time)}
            valueClass="text-violet-600"
          />
        </div>
      </SectionCard>

      {ride.average_heartrate !== null && (
        <SectionCard title="Heart Rate" accent="bg-red-400">
          <div className="flex justify-center">
            <StatCell
              label="Avg HR"
              value={String(Math.round(ride.average_heartrate))}
              unit="bpm"
              valueClass="text-red-500"
            />
          </div>
        </SectionCard>
      )}

      {balance !== null && (
        <SectionCard title="L/R Balance" accent="bg-rose-400">
          <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
            <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-500">{balance}</div>
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Left / Right</div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function AggregateView({ stats }: { stats: RidingStats }) {
  const leftPct = stats.avg_left_right_balance
  const balance = leftPct !== null
    ? `${leftPct.toFixed(1)}% L / ${(100 - leftPct).toFixed(1)}% R`
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

      <SectionCard title="L/R Balance" accent="bg-rose-400">
        <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-500">{balance}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Avg Left / Right</div>
          {leftPct !== null && (
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
  const [activeTab, setActiveTab] = useState<number>(0)

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

  const rides = stats.recent_rides ?? []
  const tabs = [
    { id: 0, label: '28 Days' },
    ...rides.map((r, i) => ({ id: i + 1, label: formatRideTabLabel(r.start_date_local) })),
  ]

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {activeTab === 0
            ? `Last 28 days · ${stats.ride_count} ride${stats.ride_count !== 1 ? 's' : ''}`
            : formatRideTabLabel((stats.recent_rides ?? [])[activeTab - 1]?.start_date_local ?? '')}
        </p>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto overflow-y-hidden scrollbar-none -mx-4 px-4" style={{ touchAction: 'pan-x' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
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
      )}

      {activeTab === 0 ? (
        <>
          <AggregateView stats={stats} />
          <CrossTrainingSummary groups={stats.cross_training} />
        </>
      ) : (
        <RideView ride={rides[activeTab - 1]} />
      )}
    </main>
  )
}
