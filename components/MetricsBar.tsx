import type { ICUWellness } from '@/types'

interface MetricProps {
  label: string
  value: number | null
  valueClass?: string
  unit?: string
}

function Metric({ label, value, valueClass = 'text-gray-900', unit }: MetricProps) {
  return (
    <div className="flex-1 text-center px-3 py-4">
      <div className={`text-3xl font-extrabold tracking-tight ${valueClass}`}>
        {value !== null ? Math.round(value) : '—'}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
    </div>
  )
}

function formatWellnessDate(id: string, syncedAt: Date | null): string {
  const [, month, day] = id.split('-').map(Number)
  const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]
  const timeStr = syncedAt
    ? syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null
  return timeStr ? `Updated ${day} ${monthName} at ${timeStr}` : `Updated ${day} ${monthName}`
}

export default function MetricsBar({ wellness, syncedAt = null }: { wellness: ICUWellness | null; syncedAt?: Date | null }) {
  if (!wellness) return null
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)
  const formPositive = form !== null && form >= 0
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Fitness Stats</h2>
        <span className="text-xs text-gray-400">{formatWellnessDate(wellness.id, syncedAt)}</span>
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
          <Metric label="HRV" value={wellness.hrv} valueClass="text-violet-600" />
        )}
        {wellness.resting_hr !== null && (
          <Metric label="Resting HR" value={wellness.resting_hr} valueClass="text-rose-500" unit="bpm" />
        )}
      </div>
    </div>
  )
}
