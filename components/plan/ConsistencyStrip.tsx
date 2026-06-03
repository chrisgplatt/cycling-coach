interface ConsistencyStripProps {
  hitPct: number
  streak: number
  hours: number
}

export default function ConsistencyStrip({ hitPct, streak, hours }: ConsistencyStripProps) {
  const stats = [
    { v: `${hitPct}%`, l: 'sessions hit' },
    { v: `🔥${streak}`, l: 'week streak' },
    { v: `${hours}h`, l: 'this plan' },
  ]
  return (
    <div data-testid="consistency-strip" className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex gap-3">
      {stats.map((s, i) => (
        <div key={i} className="flex-1 text-center">
          <div className="text-xl font-extrabold text-blue-600 leading-tight">{s.v}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{s.l}</div>
        </div>
      ))}
    </div>
  )
}
