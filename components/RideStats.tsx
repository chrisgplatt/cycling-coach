'use client'
import type { ICUActivity, ActivityMetrics } from '@/types'

export interface RideStatsData {
  avgWatts: number | null
  np: number | null
  tss: number | null
  best: { p5s: number | null; p15s: number | null; p30s: number | null; p1: number | null; p5: number | null; p10: number | null; p20: number | null; p60min: number | null }
  distanceM: number | null
  elevationM: number | null
  durationSecs: number
  avgHr: number | null
  maxHr: number | null
  minHr: number | null
  lrBalanceRight: number | null  // right-side %, e.g. 47.7 (intervals.icu stores right-side %)
  npWkg: number | null
  avgWkg: number | null
  avgSpeedKph: number | null
  maxSpeedKph: number | null
  elapsedSecs: number | null
  avgTempC: number | null
  minTempC: number | null
  maxTempC: number | null
}

// Formats a duration in seconds as "1h 30m" (not to be confused with
// lib/calendar-helpers.ts's minutes-based formatDurationMins, or
// lib/ride/graph-math.ts's clock-style formatClockDuration).
export function formatHrsMins(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

// extraBest supplies durations ICUActivity doesn't carry natively (5s/15s/30s/60min) —
// pass the linked workout row's activity_metrics.best_efforts when available.
export function rideStatsFromActivity(a: ICUActivity, extraBest?: Array<{ secs: number; watts: number }> | null): RideStatsData {
  const extra = (secs: number) => extraBest?.find(e => e.secs === secs)?.watts ?? null
  return {
    avgWatts: a.average_watts,
    np: a.weighted_average_watts,
    tss: a.training_load,
    best: {
      p5s: extra(5), p15s: extra(15), p30s: extra(30),
      p1: a.power_1min ?? null, p5: a.power_5min ?? null,
      p10: a.power_10min ?? null, p20: a.power_20min ?? null,
      p60min: extra(3600),
    },
    distanceM: a.distance,
    elevationM: a.total_elevation_gain,
    durationSecs: a.moving_time,
    avgHr: a.average_heartrate,
    maxHr: a.max_heartrate ?? null,
    minHr: null,
    lrBalanceRight: a.left_right_balance,
    npWkg: null,
    avgWkg: null,
    avgSpeedKph: (a.distance != null && a.moving_time > 0) ? (a.distance / 1000) / (a.moving_time / 3600) : null,
    maxSpeedKph: a.max_speed != null ? a.max_speed * 3.6 : null,
    elapsedSecs: a.elapsed_time ?? null,
    avgTempC: a.average_temp ?? null,
    minTempC: a.min_temp ?? null,
    maxTempC: a.max_temp ?? null,
  }
}

export function rideStatsFromMetrics(m: ActivityMetrics, durationSecs: number, tss: number | null): RideStatsData {
  const effort = (secs: number) => m.best_efforts?.find(e => e.secs === secs)?.watts ?? null
  return {
    avgWatts: m.avg_power,
    np: m.np,
    tss,
    best: {
      p5s: effort(5), p15s: effort(15), p30s: effort(30),
      p1: effort(60), p5: effort(300), p10: effort(600), p20: effort(1200),
      p60min: effort(3600),
    },
    distanceM: m.distance_m,
    elevationM: m.elevation_m,
    durationSecs,
    avgHr: m.avg_hr,
    maxHr: m.max_hr ?? null,
    minHr: m.min_hr ?? null,
    lrBalanceRight: m.lr_balance,
    npWkg: null,
    avgWkg: null,
    avgSpeedKph: (m.distance_m != null && durationSecs > 0) ? (m.distance_m / 1000) / (durationSecs / 3600) : null,
    maxSpeedKph: m.max_speed_ms != null ? m.max_speed_ms * 3.6 : null,
    elapsedSecs: m.elapsed_secs ?? null,
    avgTempC: m.avg_temp_c ?? null,
    minTempC: m.min_temp_c ?? null,
    maxTempC: m.max_temp_c ?? null,
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

// Per-ride stat cards (Totals / Power / Best Power / Speed / Heart Rate / Temperature /
// L-R Balance). Cards whose data is absent are hidden. Shared by the stats page and the ride modals.
export default function RideStats({ data, effectiveMaxHr }: { data: RideStatsData; effectiveMaxHr?: number | null }) {
  const hasBest = data.best.p5s != null || data.best.p15s != null || data.best.p30s != null || data.best.p1 != null
    || data.best.p5 != null || data.best.p10 != null || data.best.p20 != null || data.best.p60min != null
  const hasSpeed = data.avgSpeedKph !== null || data.maxSpeedKph !== null
  const hasTemp = data.avgTempC !== null || data.minTempC !== null || data.maxTempC !== null
  const balance = data.lrBalanceRight !== null
    ? `${(100 - data.lrBalanceRight).toFixed(1)}% L / ${data.lrBalanceRight.toFixed(1)}% R`
    : null
  const num = (v: number | null) => (v !== null ? String(Math.round(v)) : '—')

  return (
    <div className="space-y-4">
      <SectionCard title="Ride Totals" accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Distance" value={data.distanceM !== null ? (Math.round(data.distanceM / 100) / 10).toFixed(1) : '—'} unit={data.distanceM !== null ? 'km' : undefined} valueClass="text-blue-600" />
          <StatCell label="Elevation" value={data.elevationM !== null ? String(Math.floor(data.elevationM)) : '—'} unit={data.elevationM !== null ? 'm' : undefined} valueClass="text-emerald-600" />
        </div>
        <div className="flex divide-x divide-gray-100 border-t border-gray-100">
          <StatCell label="Duration" value={formatHrsMins(data.durationSecs)} valueClass="text-violet-600" />
          {data.elapsedSecs !== null && (
            <StatCell label="Elapsed" value={formatHrsMins(data.elapsedSecs)} valueClass="text-violet-400" />
          )}
        </div>
      </SectionCard>

      <SectionCard title="Power" accent="bg-orange-400">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Avg W" value={num(data.avgWatts)} unit={data.avgWatts !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="NP" value={num(data.np)} unit={data.np !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="TSS" value={num(data.tss)} valueClass="text-orange-500" />
        </div>
        {(data.avgWkg !== null || data.npWkg !== null) && (
          <div className="flex divide-x divide-gray-100 border-t border-gray-100">
            {data.avgWkg !== null && (
              <StatCell label="Avg w/kg" value={data.avgWkg.toFixed(2)} valueClass="text-orange-400" />
            )}
            {data.npWkg !== null && (
              <StatCell label="NP w/kg" value={data.npWkg.toFixed(2)} valueClass="text-orange-400" />
            )}
          </div>
        )}
      </SectionCard>

      {hasBest && (
        <SectionCard title="Best Power" accent="bg-orange-400">
          <div className="flex divide-x divide-gray-100">
            <StatCell label="5 sec" value={num(data.best.p5s)} unit={data.best.p5s != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="15 sec" value={num(data.best.p15s)} unit={data.best.p15s != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="30 sec" value={num(data.best.p30s)} unit={data.best.p30s != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="1 min" value={num(data.best.p1)} unit={data.best.p1 != null ? 'w' : undefined} valueClass="text-orange-500" />
          </div>
          <div className="flex divide-x divide-gray-100 border-t border-gray-100">
            <StatCell label="5 min" value={num(data.best.p5)} unit={data.best.p5 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="10 min" value={num(data.best.p10)} unit={data.best.p10 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="20 min" value={num(data.best.p20)} unit={data.best.p20 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="60 min" value={num(data.best.p60min)} unit={data.best.p60min != null ? 'w' : undefined} valueClass="text-orange-500" />
          </div>
        </SectionCard>
      )}

      {hasSpeed && (
        <SectionCard title="Speed" accent="bg-cyan-500">
          <div className="flex divide-x divide-gray-100">
            {data.avgSpeedKph !== null && (
              <StatCell label="Avg Speed" value={data.avgSpeedKph.toFixed(1)} unit="km/h" valueClass="text-cyan-600" />
            )}
            {data.maxSpeedKph !== null && (
              <StatCell label="Max Speed" value={data.maxSpeedKph.toFixed(1)} unit="km/h" valueClass="text-cyan-600" />
            )}
          </div>
        </SectionCard>
      )}

      {(data.avgHr !== null || data.maxHr !== null) && (
        <SectionCard title="Heart Rate" accent="bg-red-400">
          <div className="flex divide-x divide-gray-100">
            {data.minHr !== null && <StatCell label="Min HR" value={num(data.minHr)} unit="bpm" valueClass="text-red-300" />}
            {data.avgHr !== null && <StatCell label="Avg HR" value={num(data.avgHr)} unit="bpm" valueClass="text-red-500" />}
            {data.maxHr !== null && <StatCell label="Max HR" value={num(data.maxHr)} unit="bpm" valueClass="text-red-600" />}
            {data.maxHr !== null && effectiveMaxHr != null && effectiveMaxHr > 0 && (
              <StatCell label="% of Max" value={String(Math.round((data.maxHr / effectiveMaxHr) * 100))} valueClass="text-red-400" unit="%" />
            )}
          </div>
        </SectionCard>
      )}

      {hasTemp && (
        <SectionCard title="Temperature" accent="bg-amber-500">
          <div className="flex divide-x divide-gray-100">
            {data.minTempC !== null && (
              <StatCell label="Min Temp" value={String(Math.round(data.minTempC))} unit="°C" valueClass="text-amber-500" />
            )}
            {data.avgTempC !== null && (
              <StatCell label="Avg Temp" value={String(Math.round(data.avgTempC))} unit="°C" valueClass="text-amber-600" />
            )}
            {data.maxTempC !== null && (
              <StatCell label="Max Temp" value={String(Math.round(data.maxTempC))} unit="°C" valueClass="text-amber-700" />
            )}
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
