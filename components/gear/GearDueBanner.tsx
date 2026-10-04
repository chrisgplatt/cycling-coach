import Link from 'next/link'
import type { BikeView } from '@/lib/gear/view'
import { fmtNum } from '@/lib/gear/format'

interface Props {
  bikes: BikeView[]
}

/** Dashboard banner listing gear triggers that are due soon (>=80%) or overdue. Renders nothing otherwise. */
export default function GearDueBanner({ bikes }: Props) {
  const items = bikes
    .filter(b => !b.retired_at)
    .flatMap(b => b.components.filter(c => !c.retired_at))
    .flatMap(c => c.triggers
      .filter(t => t.progress.status !== 'ok')
      .map(t => ({ id: t.id, status: t.progress.status, text: `${c.name}: ${t.label} ${t.progress.status === 'overdue' ? 'due' : 'coming up'} — ${fmtNum(t.progress.used)} / ${fmtNum(t.progress.interval)} ${t.metric}` })))
  if (items.length === 0) return null

  const overdue = items.some(i => i.status === 'overdue')
  return (
    <Link
      href="/settings/gear"
      className={`block rounded-xl border px-4 py-3 space-y-1 ${overdue ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}
    >
      <p className={`text-xs font-bold uppercase tracking-wide ${overdue ? 'text-red-700' : 'text-amber-700'}`}>Bike maintenance</p>
      {items.map(i => (
        <p key={i.id} className="text-sm text-slate-800">{i.text}</p>
      ))}
    </Link>
  )
}
