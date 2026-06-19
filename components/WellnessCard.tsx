import type { DailyWellness } from '@/types'

interface Props {
  date: string
  wellness: DailyWellness | undefined
  onTap: () => void
  restDay?: boolean
}

const METRICS: Array<{ key: keyof DailyWellness; label: string }> = [
  { key: 'energy', label: 'Energy' },
  { key: 'leg_freshness', label: 'Legs' },
  { key: 'mood', label: 'Mood' },
  { key: 'stress', label: 'Stress' },
  { key: 'sleep_quality', label: 'Sleep' },
]

function DotScale({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ${i <= value ? 'bg-emerald-400' : 'bg-slate-200'}`}
        />
      ))}
    </span>
  )
}

export default function WellnessCard({ date, wellness, onTap, restDay = false }: Props) {
  if (restDay && !wellness) {
    return (
      <button
        onClick={onTap}
        className="text-[10px] text-slate-400 border border-dashed border-slate-200 rounded-md px-2 min-h-[44px] flex items-center justify-center mt-1 active:opacity-70"
      >
        + wellness
      </button>
    )
  }

  if (!wellness) {
    return (
      <button
        onClick={onTap}
        className="w-full flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-2.5 py-2 mt-1.5 active:opacity-70"
      >
        <span className="text-lg">😐</span>
        <div className="text-left">
          <p className="text-[11px] font-semibold text-slate-500">How are you feeling?</p>
          <p className="text-[10px] text-slate-400">Tap to log wellness</p>
        </div>
        <span className="ml-auto text-slate-300 text-sm">›</span>
      </button>
    )
  }

  const filledMetrics = METRICS.filter(m => wellness[m.key] != null)

  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 mt-1.5 active:opacity-70"
    >
      <span className="text-lg">😊</span>
      <div className="flex-1 text-left">
        <p className="text-[10px] font-semibold text-slate-600 mb-1">Wellness logged</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {filledMetrics.slice(0, 3).map(m => (
            <span key={m.key} className="inline-flex items-center gap-1 text-[9px] text-slate-500">
              {m.label} <DotScale value={wellness[m.key] as number} />
            </span>
          ))}
        </div>
      </div>
      <span className="text-slate-300 text-sm">›</span>
    </button>
  )
}
