import { normalizeY } from '@/lib/chart-helpers'

interface FitnessPoint {
  date: string
  ctl: number
  form: number
}

interface FitnessTrendChartProps {
  points: FitnessPoint[]
}

const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4'
const HEADING = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2'

export default function FitnessTrendChart({ points }: FitnessTrendChartProps) {
  if (points.length < 3) {
    return (
      <div data-testid="fitness-trend" className={CARD}>
        <p className={HEADING}>Fitness trend</p>
        <p className="text-sm text-slate-400">Not enough data yet.</p>
      </div>
    )
  }

  const W = 300
  const H = 70
  const values = points.flatMap(p => [p.ctl, p.form])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = (i: number) => (i / (points.length - 1)) * W
  const line = (key: 'ctl' | 'form') =>
    points.map((p, i) => `${x(i).toFixed(1)},${normalizeY(p[key], min, max, 8, H - 8).toFixed(1)}`).join(' ')

  const delta = Math.round(points[points.length - 1].ctl - points[0].ctl)
  const form = Math.round(points[points.length - 1].form)

  return (
    <div data-testid="fitness-trend" className={CARD}>
      <p className={HEADING}>Fitness trend</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        <polyline points={line('ctl')} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        <polyline points={line('form')} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
      <p className="text-[10px] text-slate-500 mt-2">
        Fitness (CTL){' '}
        <span className={delta >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
          {delta >= 0 ? '+' : ''}{delta}
        </span>{' '}
        since start · Form {form}
      </p>
    </div>
  )
}
