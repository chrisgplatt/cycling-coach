'use client'
import type { ICUActivity, ActivityMetrics } from '@/types'

export interface RideStatsData {
  avgWatts: number | null
  np: number | null
  tss: number | null
  best: { p1: number | null; p5: number | null; p10: number | null; p20: number | null }
  distanceM: number | null
  elevationM: number | null
  durationSecs: number
  avgHr: number | null
  maxHr: number | null
  minHr: number | null
  lrBalanceLeft: number | null   // left %, e.g. 52.3
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

export function rideStatsFromActivity(a: ICUActivity): RideStatsData {
  return {
    avgWatts: a.average_watts,
    np: a.weighted_average_watts,
    tss: a.training_load,
    best: {
      p1: a.power_1min ?? null, p5: a.power_5min ?? null,
      p10: a.power_10min ?? null, p20: a.power_20min ?? null,
    },
    distanceM: a.distance,
    elevationM: a.total_elevation_gain,
    durationSecs: a.moving_time,
    avgHr: a.average_heartrate,
    maxHr: a.max_heartrate ?? null,
    minHr: null,
    lrBalanceLeft: a.left_right_balance,
  }
}

export function rideStatsFromMetrics(m: ActivityMetrics, durationSecs: number, tss: number | null): RideStatsData {
  const effort = (secs: number) => m.best_efforts?.find(e => e.secs === secs)?.watts ?? null
  return {
    avgWatts: m.avg_power,
    np: m.np,
    tss,
    best: { p1: effort(60), p5: effort(300), p10: effort(600), p20: effort(1200) },
    distanceM: m.distance_m,
    elevationM: m.elevation_m,
    durationSecs,
    avgHr: m.avg_hr,
    maxHr: m.max_hr ?? null,
    minHr: m.min_hr ?? null,
    lrBalanceLeft: m.lr_balance,
  }
}

export function StatCell({
  label, value, unit, valueClass = 'text-gray-900',
}: { label: string; value: string; unit?: string; valueClass?: string }) {
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

export function SectionCard({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
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

// Per-ride stat cards (Power / Best Power / Totals / Heart Rate / L-R Balance). Cards
// whose data is absent are hidden. Shared by the stats page and the ride modals.
export default function RideStats({ data }: { data: RideStatsData }) {
  const hasBest = data.best.p1 != null || data.best.p5 != null || data.best.p10 != null || data.best.p20 != null
  const balance = data.lrBalanceLeft !== null
    ? `${data.lrBalanceLeft.toFixed(1)}% L / ${(100 - data.lrBalanceLeft).toFixed(1)}% R`
    : null
  const num = (v: number | null) => (v !== null ? String(Math.round(v)) : '—')

  return (
    <div className="space-y-4">
      <SectionCard title="Power" accent="bg-orange-400">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Avg W" value={num(data.avgWatts)} unit={data.avgWatts !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="NP" value={num(data.np)} unit={data.np !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="TSS" value={num(data.tss)} valueClass="text-orange-500" />
        </div>
      </SectionCard>

      {hasBest && (
        <SectionCard title="Best Power" accent="bg-orange-400">
          <div className="flex divide-x divide-gray-100">
            <StatCell label="1 min" value={num(data.best.p1)} unit={data.best.p1 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="5 min" value={num(data.best.p5)} unit={data.best.p5 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="10 min" value={num(data.best.p10)} unit={data.best.p10 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="20 min" value={num(data.best.p20)} unit={data.best.p20 != null ? 'w' : undefined} valueClass="text-orange-500" />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Ride Totals" accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Distance" value={data.distanceM !== null ? (Math.round(data.distanceM / 100) / 10).toFixed(1) : '—'} unit={data.distanceM !== null ? 'km' : undefined} valueClass="text-blue-600" />
          <StatCell label="Elevation" value={num(data.elevationM)} unit={data.elevationM !== null ? 'm' : undefined} valueClass="text-emerald-600" />
          <StatCell label="Duration" value={formatDuration(data.durationSecs)} valueClass="text-violet-600" />
        </div>
      </SectionCard>

      {(data.avgHr !== null || data.maxHr !== null) && (
        <SectionCard title="Heart Rate" accent="bg-red-400">
          <div className="flex divide-x divide-gray-100">
            {data.minHr !== null && <StatCell label="Min HR" value={num(data.minHr)} unit="bpm" valueClass="text-red-300" />}
            {data.avgHr !== null && <StatCell label="Avg HR" value={num(data.avgHr)} unit="bpm" valueClass="text-red-500" />}
            {data.maxHr !== null && <StatCell label="Max HR" value={num(data.maxHr)} unit="bpm" valueClass="text-red-600" />}
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
