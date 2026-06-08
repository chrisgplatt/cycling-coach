'use client'
import { useState } from 'react'
import type { SessionDistributions, DistributionBin } from '@/types'
import { SectionCard } from './RideStats'

type Channel = 'power' | 'cadence' | 'hr'

// Power %FTP zone band edges (CLAUDE.md): Z1<55, Z2 56–75, Z3 76–90, Z4 91–105, Z5 106–120, Z6 >120.
const POWER_ZONES: Array<{ from: number; to: number; cls: string }> = [
  { from: 0, to: 55, cls: 'bg-slate-100' },
  { from: 55, to: 75, cls: 'bg-sky-100' },
  { from: 75, to: 90, cls: 'bg-emerald-100' },
  { from: 90, to: 105, cls: 'bg-amber-100' },
  { from: 105, to: 120, cls: 'bg-orange-100' },
  { from: 120, to: 1000, cls: 'bg-rose-100' },
]

// HR zone bands as a fraction of LTHR (Friel-style, adapted for cycling LTHR):
// Z1 <81%, Z2 81–89%, Z3 90–93%, Z4 94–99%, Z5 ≥100%.
const HR_ZONES: Array<{ to: number; cls: string }> = [
  { to: 0.81, cls: 'bg-slate-100' },
  { to: 0.90, cls: 'bg-sky-100' },
  { to: 0.94, cls: 'bg-emerald-100' },
  { to: 1.00, cls: 'bg-amber-100' },
  { to: Infinity, cls: 'bg-rose-100' },
]
const hrBand = (edge: number, lthr: number): string =>
  (HR_ZONES.find(z => edge / lthr < z.to) ?? HR_ZONES[HR_ZONES.length - 1]).cls

function fmtTime(secs: number): string {
  if (secs >= 3600) return `${(secs / 3600).toFixed(1)}h`
  if (secs >= 60) return `${Math.round(secs / 60)}m`
  return `${secs}s`
}

function Bars({ bins, width, barClass, bandFor, xUnit }: {
  bins: DistributionBin[]
  width: number
  barClass: string
  bandFor?: (edge: number) => string | null
  xUnit: string
}) {
  const max = Math.max(...bins.map(b => b.secs), 1)
  const lo = bins[0].edge
  const hi = bins[bins.length - 1].edge + width
  return (
    <div>
      <div className="flex">
        {/* y-axis: time, in quarter steps from the peak down to 0 */}
        <div className="flex flex-col justify-between items-end h-32 w-9 shrink-0 pr-1.5 text-[10px] font-medium text-gray-400 tabular-nums">
          {[1, 0.75, 0.5, 0.25, 0].map((f, i) => (
            <span key={i}>{f === 0 ? '0' : fmtTime(Math.round(max * f))}</span>
          ))}
        </div>
        <div className="flex items-end gap-px h-32 px-1 flex-1 border-l border-b border-gray-200" role="img" aria-label="distribution histogram">
          {bins.map(b => (
            <div key={b.edge} className="flex-1 flex flex-col justify-end relative h-full" title={`${b.edge}–${b.edge + width}: ${Math.round(b.secs / 60)}min`}>
              {bandFor && <div className={`absolute inset-0 ${bandFor(b.edge) ?? ''}`} />}
              <div className={`relative ${barClass} rounded-t`} style={{ height: `${(b.secs / max) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      {/* x-axis: data range in quarter steps, aligned under the bars (spacer matches the y-axis gutter) */}
      <div className="flex">
        <div className="w-9 shrink-0" />
        <div className="flex justify-between flex-1 px-1 mt-0.5 text-[10px] font-medium text-gray-400 tabular-nums">
          {Array.from({ length: 5 }, (_, i) => Math.round(lo + ((hi - lo) * i) / 4)).map((v, i) => (
            <span key={i}>{v}{xUnit}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function SessionHistogram({ distributions }: { distributions: SessionDistributions | null }) {
  const available: Channel[] = []
  if (distributions?.power?.length) available.push('power')
  if (distributions?.cadence?.length) available.push('cadence')
  if (distributions?.hr?.length) available.push('hr')

  const [channel, setChannel] = useState<Channel>(available[0] ?? 'power')
  if (!distributions || available.length === 0) return null
  const active = available.includes(channel) ? channel : available[0]

  const label: Record<Channel, string> = { power: 'Power', cadence: 'Cadence', hr: 'HR' }

  const powerBand = (edge: number): string | null =>
    POWER_ZONES.find(z => edge >= z.from && edge < z.to)?.cls ?? null

  let summary = ''
  if (active === 'power' && distributions.power_vi !== null) {
    summary = `VI ${distributions.power_vi.toFixed(2)}` +
      (distributions.power_steady_pct !== null ? ` · ${distributions.power_steady_pct}% within ±5% NP` : '')
  } else if (active === 'cadence' && distributions.coasting_secs && distributions.coasting_secs >= 60) {
    summary = `Coasted ${Math.round(distributions.coasting_secs / 60)} min`
  } else if (active === 'hr') {
    summary = distributions.hr_lthr !== null ? `LTHR ${distributions.hr_lthr} bpm` : 'Raw bpm (no LTHR set)'
  }

  return (
    <SectionCard title="Distribution" accent="bg-violet-400">
      <div className="p-3 space-y-2">
        <div className="flex gap-1">
          {available.map(c => (
            <button
              key={c}
              type="button"
              aria-pressed={active === c}
              onClick={() => setChannel(c)}
              className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-colors ${
                active === c ? 'bg-violet-500 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {label[c]}
            </button>
          ))}
        </div>

        {active === 'power' && distributions.power && (
          <Bars bins={distributions.power} width={5} barClass="bg-orange-400" bandFor={powerBand} xUnit="%" />
        )}
        {active === 'cadence' && distributions.cadence && (
          <Bars bins={distributions.cadence} width={10} barClass="bg-violet-400" xUnit="" />
        )}
        {active === 'hr' && distributions.hr && (
          <Bars
            bins={distributions.hr}
            width={5}
            barClass="bg-red-400"
            bandFor={distributions.hr_lthr !== null ? (edge) => hrBand(edge, distributions.hr_lthr!) : undefined}
            xUnit=""
          />
        )}

        <p className="text-xs text-gray-500 text-center">
          {active === 'power' ? 'by % FTP' : active === 'cadence' ? 'by rpm' : 'by bpm'}
          {summary && <span className="font-semibold text-gray-600"> · {summary}</span>}
        </p>
      </div>
    </SectionCard>
  )
}
