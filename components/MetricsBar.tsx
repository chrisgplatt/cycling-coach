import type { ICUWellness } from '@/types'

const COLOUR_CODES: Record<string, string> = {
  CTL: 'text-blue-600',
  ATL: 'text-orange-500',
  Form: 'text-green-600',
}

function Metric({ label, value }: { label: string; value: number | null }) {
  const colour = COLOUR_CODES[label] ?? 'text-gray-700'
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${colour}`}>
        {value !== null ? Math.round(value) : '—'}
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

export default function MetricsBar({ wellness }: { wellness: ICUWellness | null }) {
  if (!wellness) return null
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex gap-8 justify-center">
      <Metric label="CTL" value={wellness.ctl} />
      <Metric label="ATL" value={wellness.atl} />
      <Metric label="Form" value={form} />
      {wellness.hrv !== null && (
        <div className="text-center">
          <div className="text-2xl font-bold text-purple-600">{wellness.hrv}</div>
          <div className="text-xs text-gray-500 mt-1">HRV</div>
        </div>
      )}
      {wellness.resting_hr !== null && (
        <div className="text-center">
          <div className="text-2xl font-bold text-red-500">{wellness.resting_hr}</div>
          <div className="text-xs text-gray-500 mt-1">Resting HR</div>
        </div>
      )}
    </div>
  )
}
