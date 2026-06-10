import type { ICUWellness } from '@/types'
import { computeDailyStrain, computeDailyLifeLoad, strainLabel } from '@/lib/strain'

interface MetricProps {
  label: string
  value: number | null
  valueClass?: string
  unit?: string
  stale?: boolean
}

function Metric({ label, value, valueClass = 'text-gray-900', unit, stale }: MetricProps) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4">
      <div className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${valueClass}`}>
        {value !== null ? Math.round(value) : '—'}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
      {stale && (
        <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">
          prev day
        </span>
      )}
    </div>
  )
}

function formatSyncTime(syncedAt: Date | null): string {
  if (!syncedAt) return ''
  const timeStr = syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const syncedStr = syncedAt.toISOString().split('T')[0]
  if (syncedStr === todayStr) return `Synced today at ${timeStr}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (syncedStr === yesterday.toISOString().split('T')[0]) return `Synced yesterday at ${timeStr}`
  const [, month, day] = syncedStr.split('-').map(Number)
  const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]
  return `Synced ${day} ${monthName} at ${timeStr}`
}

const BAND_BG: Record<string, string> = {
  low:      'bg-emerald-600',
  moderate: 'bg-amber-600',
  high:     'bg-red-600',
}

const BAND_LABEL: Record<string, string> = {
  low: 'Low', moderate: 'Moderate', high: 'High',
}

export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
}) {
  if (!wellness) return null
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)
  const formPositive = form !== null && form >= 0
  const lifeLoad = computeDailyLifeLoad(wellness.stress_avg, wellness.stress_high, wellness.sleep_score, wellness.body_battery_low)
  const dailyStrain = computeDailyStrain(wellness.garmin_training_load, lifeLoad)
  const strainCategory = dailyStrain !== null ? strainLabel(dailyStrain) : null

  return (
    <div className={embedded ? 'overflow-hidden' : 'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden'}>

      {strainCategory ? (
        <>
          {/* Coloured strain band */}
          <div className={`flex items-center justify-between px-4 py-3.5 ${BAND_BG[strainCategory]}`}>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/60 mb-1.5">Strain</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-black tracking-tight text-white leading-none">
                  {dailyStrain}
                </span>
                <span className="text-lg font-medium text-white/55">/21</span>
                <span className="ml-1 text-sm font-bold uppercase tracking-wide text-white/90">
                  {BAND_LABEL[strainCategory]}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-white/60">{formatSyncTime(syncedAt)}</div>
              {lastRideLabel && (
                <div className="text-[11px] text-white/60">
                  Last ride: <span className="font-semibold text-white/85">{lastRideLabel}</span>
                </div>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-[3px] bg-black/10">
            <div
              className="h-full bg-white/40 transition-all"
              style={{ width: `${Math.round((dailyStrain! / 21) * 100)}%` }}
            />
          </div>
        </>
      ) : (
        /* Fallback gray header when no strain data */
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Fitness Stats</h2>
          <div className="text-right">
            <div className="text-xs text-gray-400">{formatSyncTime(syncedAt)}</div>
            {lastRideLabel && (
              <div className="text-[11px] text-gray-400">Last ride: <span className="font-medium text-gray-500">{lastRideLabel}</span></div>
            )}
          </div>
        </div>
      )}

      <div className="flex divide-x divide-gray-100">
        <Metric label="CTL" value={wellness.ctl} valueClass="text-blue-600" />
        <Metric label="ATL" value={wellness.atl} valueClass="text-orange-500" />
        <Metric
          label="Form"
          value={form}
          valueClass={form === null ? 'text-gray-900' : formPositive ? 'text-emerald-600' : 'text-red-500'}
        />
        {wellness.hrv !== null && (
          <Metric label="HRV" value={wellness.hrv} valueClass="text-violet-600" stale={stale.hrv} />
        )}
        {wellness.resting_hr !== null && (
          <Metric label="Resting HR" value={wellness.resting_hr} valueClass="text-rose-500" unit="bpm" stale={stale.restingHr} />
        )}
      </div>
    </div>
  )
}
