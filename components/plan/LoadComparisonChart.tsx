interface LoadComparisonChartProps {
  weeks: { plannedTss: number; actualTss: number }[]
  currentWeek: number
}

export default function LoadComparisonChart({ weeks, currentWeek }: LoadComparisonChartProps) {
  const max = Math.max(1, ...weeks.flatMap(w => [w.plannedTss, w.actualTss]))
  return (
    <div data-testid="load-chart" className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Load — planned vs actual</p>
      <div className="flex items-end gap-1.5 h-20">
        {weeks.map((w, i) => (
          <div key={i} data-week-col className="flex-1 flex items-end gap-0.5 h-full">
            <span data-bar className="flex-1 bg-slate-300 rounded-t" style={{ height: `${(w.plannedTss / max) * 100}%` }} />
            <span data-bar className={`flex-1 rounded-t ${i === currentWeek ? 'bg-blue-300' : 'bg-blue-600'}`} style={{ height: `${(w.actualTss / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">▥ planned · █ actual TSS, by week</p>
    </div>
  )
}
