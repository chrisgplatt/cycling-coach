import { normalizeY } from '@/lib/chart-helpers'
import type { ForecastResult } from '@/lib/plan/forecast'

interface FitnessPoint {
  date: string
  ctl: number
  form: number
}

interface FitnessTrendChartProps {
  points: FitnessPoint[]
  forecast?: ForecastResult | null
}

const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4'
const HEADING = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2'

export default function FitnessTrendChart({ points, forecast }: FitnessTrendChartProps) {
  if (points.length < 3) {
    return (
      <div data-testid="fitness-trend" className={CARD}>
        <p className={HEADING}>Fitness trend</p>
        <p className="text-sm text-slate-400">Not enough data yet.</p>
      </div>
    )
  }

  const hasForecast = !!forecast && forecast.horizonDays > 0
  const W = 300
  const H = 70
  const histSpan = points.length - 1
  const totalSpan = histSpan + (hasForecast ? forecast!.horizonDays : 0)

  const allValues = [
    ...points.flatMap(p => [p.ctl, p.form]),
    ...(hasForecast ? [...forecast!.planSeries, ...forecast!.paceSeries] : []),
  ]
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const x = (i: number) => (i / totalSpan) * W
  const y = (v: number) => normalizeY(v, min, max, 8, H - 8)

  const histLine = (key: 'ctl' | 'form') =>
    points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')

  // Projection polylines start at the last history index (their first value == last actual CTL).
  const projLine = (series: number[]) =>
    series.map((v, k) => `${x(histSpan + k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const delta = Math.round(points[points.length - 1].ctl - points[0].ctl)
  const form = Math.round(points[points.length - 1].form)

  return (
    <div data-testid="fitness-trend" className={CARD}>
      <p className={HEADING}>{hasForecast ? 'Fitness → event day' : 'Fitness trend'}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        {hasForecast && (
          <line x1={x(histSpan)} y1="0" x2={x(histSpan)} y2={H} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="2 2" />
        )}
        <polyline points={histLine('ctl')} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        <polyline points={histLine('form')} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 4" />
        {hasForecast && (
          <>
            <polyline points={projLine(forecast!.planSeries)} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" />
            <polyline points={projLine(forecast!.paceSeries)} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="1 3" />
          </>
        )}
      </svg>
      {hasForecast ? (
        <p className="text-[10px] text-slate-500 mt-2">
          Stick to plan: CTL ~{Math.round(forecast!.planCtl)}. At current pace: ~{Math.round(forecast!.paceCtl)}.
        </p>
      ) : (
        <p className="text-[10px] text-slate-500 mt-2">
          Fitness (CTL){' '}
          <span className={delta >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
            {delta >= 0 ? '+' : ''}{delta}
          </span>{' '}
          since start · Form {form}
        </p>
      )}
    </div>
  )
}
