import type { BikeView } from '@/lib/gear/view'
import { fmtNum } from '@/lib/gear/format'

export function Badge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'slate' | 'amber' }) {
  const tones = { blue: 'bg-blue-50 text-blue-700', slate: 'bg-slate-100 text-slate-600', amber: 'bg-amber-50 text-amber-700' }
  return <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${tones[tone]}`}>{children}</span>
}

export function BikeBadges({ bike }: { bike: BikeView }) {
  return (
    <>
      {bike.is_default && <Badge>Default</Badge>}
      {bike.is_indoor_default && <Badge tone="amber">Trainer</Badge>}
      {bike.retired_at && <Badge tone="slate">Retired</Badge>}
    </>
  )
}

export default function BikeCard({ bike, onOpen }: { bike: BikeView; onOpen: () => void }) {
  const attention = bike.components.filter(c => !c.retired_at).flatMap(c => c.triggers).filter(t => t.progress.status !== 'ok').length
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3.5 min-h-[44px] flex items-center justify-between gap-3"
    >
      <span className="min-w-0 space-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-base font-semibold text-slate-900 truncate">{bike.name}</span>
          <BikeBadges bike={bike} />
        </span>
        <span className="block text-sm text-slate-500 tabular-nums">
          {fmtNum(bike.totals.km)} km · {fmtNum(bike.totals.hours)} h
          {attention > 0 && <span className="text-amber-600 font-medium"> · {attention} to check</span>}
        </span>
      </span>
      <span className="text-slate-400" aria-hidden>›</span>
    </button>
  )
}
