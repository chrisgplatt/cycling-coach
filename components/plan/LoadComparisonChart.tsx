interface LoadComparisonChartProps {
  weeks: { plannedTss: number; actualTss: number }[]
  currentWeek: number
}

export default function LoadComparisonChart({ weeks, currentWeek }: LoadComparisonChartProps) {
  const max = Math.max(1, ...weeks.flatMap(w => [w.plannedTss, w.actualTss]))
  const mid = Math.round(max / 2)

  return (
    <div data-testid="load-chart" className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Load — planned vs actual</p>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between h-20 text-[9px] text-slate-400 text-right leading-none">
          <span>{max}</span>
          <span>{mid}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1 h-20">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            <div className="border-t border-slate-100" />
            <div className="border-t border-slate-100" />
            <div className="border-t border-slate-200" />
          </div>
          <div className="relative flex items-end gap-1.5 h-full">
            {weeks.map((w, i) => (
              <div key={i} data-week-col className="flex-1 flex items-end gap-0.5 h-full">
                <span
                  data-bar
                  title={`Planned: ${w.plannedTss} TSS`}
                  className="flex-1 bg-slate-300 rounded-t"
                  style={{ height: `${(w.plannedTss / max) * 100}%` }}
                />
                <span
                  data-bar
                  title={`Actual: ${w.actualTss} TSS${i === currentWeek ? ' (week in progress)' : ''}`}
                  className={`flex-1 rounded-t ${i === currentWeek ? 'bg-blue-300' : 'bg-blue-600'}`}
                  style={{ height: `${(w.actualTss / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-slate-300" />Planned</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-600" />Actual</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-300" />This week (in progress)</span>
      </div>
    </div>
  )
}
