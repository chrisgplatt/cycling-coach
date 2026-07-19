'use client'
import type { RideHighlight } from '@/lib/ride-highlights'
import type { ClimbSegment, EffortPeriod, RideSprint, PersonalBest } from '@/types'

const ZONE_LABEL: Record<'z4' | 'z5' | 'z6', string> = {
  z4: 'Z4 Threshold', z5: 'Z5 VO2max', z6: 'Z6 Anaerobic',
}

function mins(secs: number): number {
  return Math.round(secs / 60)
}

function durationLabel(secs: number): string {
  return secs < 60 ? `${secs}s` : `${mins(secs)}min`
}

function Card({ icon, kind, children }: { icon: string; kind: string; children: React.ReactNode }) {
  return (
    <div data-testid="highlight-card" className="flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-100">
      <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{kind}</p>
        {children}
      </div>
    </div>
  )
}

function ClimbCard({ c }: { c: ClimbSegment }) {
  return (
    <Card icon="🏔️" kind={`Climb · km ${c.start_km}`}>
      <p className="text-sm text-gray-900">
        {mins(c.duration_secs)}min · {c.elev_gain_m}m gain{c.avg_watts != null ? ` · ${c.avg_watts}W avg` : ''} · VAM {c.vam}
      </p>
    </Card>
  )
}

function EffortCard({ e }: { e: EffortPeriod }) {
  return (
    <Card icon="⚡" kind={`Effort · km ${e.start_km}`}>
      <p className="text-sm text-gray-900">{mins(e.duration_secs)}min in {ZONE_LABEL[e.zone]} · {e.avg_watts}W avg</p>
    </Card>
  )
}

function SprintCard({ s }: { s: RideSprint }) {
  return (
    <Card icon="🏁" kind="Sprint">
      <p className="text-sm text-gray-900">{durationLabel(s.duration_secs)} · {s.watts}W</p>
    </Card>
  )
}

function PersonalBestCard({ p }: { p: PersonalBest }) {
  return (
    <Card icon="🏆" kind="Personal best">
      <p className="text-sm text-gray-900">{durationLabel(p.duration_secs)} power: {p.watts}W ({p.window_days}-day best)</p>
    </Card>
  )
}

export default function RideHighlightsTab({ highlights }: { highlights: RideHighlight[] }) {
  return (
    <div className="space-y-2">
      {highlights.map((h, i) => {
        if (h.kind === 'climb') return <ClimbCard key={i} c={h.data as ClimbSegment} />
        if (h.kind === 'effort') return <EffortCard key={i} e={h.data as EffortPeriod} />
        if (h.kind === 'sprint') return <SprintCard key={i} s={h.data as RideSprint} />
        return <PersonalBestCard key={i} p={h.data as PersonalBest} />
      })}
    </div>
  )
}
