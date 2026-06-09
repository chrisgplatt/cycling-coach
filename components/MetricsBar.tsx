import type { ICUWellness } from '@/types'
import { computeDailyStrain, strainLabel } from '@/lib/strain'

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

export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
}) {
  if (!wellness) return null
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)
  const formPositive = form !== null && form >= 0
  const dailyStrain = computeDailyStrain(
    wellness.garmin_training_load,
    wellness.stress_avg,
  )
  const strainColor =
    dailyStrain === null ? 'text-gray-900'
    : strainLabel(dailyStrain) === 'low' ? 'text-emerald-600'
    : strainLabel(dailyStrain) === 'moderate' ? 'text-amber-500'
    : 'text-red-500'
  return (
    <div className={embedded ? 'overflow-hidden' : 'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden'}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Fitness Stats</h2>
        <span className="text-xs text-gray-400">{formatSyncTime(syncedAt)}</span>
      </div>
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
        {dailyStrain !== null && (
          <Metric label="Strain" value={dailyStrain} valueClass={strainColor} unit="/21" />
        )}
      </div>
    </div>
  )
}
