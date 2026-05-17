import type { ICUWellness } from '@/types'

interface MetricProps {
  label: string
  value: number | null
  valueClass?: string
  unit?: string
}

function Metric({ label, value, valueClass = 'text-slate-900', unit }: MetricProps) {
  return (
    <div className="flex-1 text-center px-4 py-3">
      <div className={`text-2xl font-black tracking-tight ${valueClass}`}>
        {value !== null ? Math.round(value) : '—'}
        {unit && <span className="text-xs font-medium text-slate-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-1">{label}</div>
    </div>
  )
}

function formatWellnessDate(id: string): string {
  const [, month, day] = id.split('-').map(Number)
  const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]
  return `Updated ${day} ${monthName}`
}

export default function MetricsBar({ wellness }: { wellness: ICUWellness | null }) {
  if (!wellness) return null
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)
  const formPositive = form !== null && form >= 0
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Fitness Stats</h2>
        <span className="text-xs text-slate-400">{formatWellnessDate(wellness.id)}</span>
      </div>
      <div className="flex divide-x divide-slate-100">
        <Metric label="CTL" value={wellness.ctl} valueClass="text-blue-600" />
        <Metric label="ATL" value={wellness.atl} valueClass="text-orange-500" />
        <Metric
          label="Form"
          value={form}
          valueClass={form === null ? 'text-slate-900' : formPositive ? 'text-emerald-600' : 'text-red-500'}
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
