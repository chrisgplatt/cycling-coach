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

type RegisterRef = (index: number, el: HTMLDivElement | null) => void

function Card({ icon, kind, children, index, active, onRegisterRef, onClick }: {
  icon: string; kind: string; children: React.ReactNode
  index: number; active?: boolean; onRegisterRef?: RegisterRef; onClick?: () => void
}) {
  return (
    <div
      ref={el => onRegisterRef?.(index, el)}
      data-testid="highlight-card"
      onClick={onClick}
      className={`flex items-start gap-3 p-3 rounded-xl bg-white border transition-colors ${
        active ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-100'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{kind}</p>
        {children}
      </div>
    </div>
  )
}

function ClimbCard({ c, index, active, onRegisterRef, onClick }: {
  c: ClimbSegment; index: number; active?: boolean; onRegisterRef?: RegisterRef; onClick?: () => void
}) {
  return (
    <Card icon="🏔️" kind={`Climb · km ${c.start_km}`} index={index} active={active} onRegisterRef={onRegisterRef} onClick={onClick}>
      <p className="text-sm text-gray-900">
        {mins(c.duration_secs)}min · {c.elev_gain_m}m gain{c.avg_watts != null ? ` · ${c.avg_watts}W avg` : ''} · VAM {c.vam}
      </p>
    </Card>
  )
}

function EffortCard({ e, index, active, onRegisterRef, onClick }: {
  e: EffortPeriod; index: number; active?: boolean; onRegisterRef?: RegisterRef; onClick?: () => void
}) {
  return (
    <Card icon="⚡" kind={`Effort · km ${e.start_km}`} index={index} active={active} onRegisterRef={onRegisterRef} onClick={onClick}>
      <p className="text-sm text-gray-900">{mins(e.duration_secs)}min in {ZONE_LABEL[e.zone]} · {e.avg_watts}W avg</p>
    </Card>
  )
}

function SprintCard({ s, index, active, onRegisterRef }: {
  s: RideSprint; index: number; active?: boolean; onRegisterRef?: RegisterRef
}) {
  return (
    <Card icon="🏁" kind="Sprint" index={index} active={active} onRegisterRef={onRegisterRef}>
      <p className="text-sm text-gray-900">{durationLabel(s.duration_secs)} · {s.watts}W</p>
    </Card>
  )
}

function PersonalBestCard({ p, index, active, onRegisterRef }: {
  p: PersonalBest; index: number; active?: boolean; onRegisterRef?: RegisterRef
}) {
  return (
    <Card icon="🏆" kind="Personal best" index={index} active={active} onRegisterRef={onRegisterRef}>
      <p className="text-sm text-gray-900">{durationLabel(p.duration_secs)} power: {p.watts}W ({p.window_days}-day best)</p>
    </Card>
  )
}

export default function RideHighlightsTab({ highlights, activeIndex, onRegisterRef, onCardClick }: {
  highlights: RideHighlight[]; activeIndex?: number | null; onRegisterRef?: RegisterRef
  onCardClick?: (index: number) => void
}) {
  return (
    <div className="space-y-2">
      {highlights.map((h, i) => {
        const active = i === activeIndex
        const onClick = onCardClick ? () => onCardClick(i) : undefined
        if (h.kind === 'climb') return <ClimbCard key={i} c={h.data as ClimbSegment} index={i} active={active} onRegisterRef={onRegisterRef} onClick={onClick} />
        if (h.kind === 'effort') return <EffortCard key={i} e={h.data as EffortPeriod} index={i} active={active} onRegisterRef={onRegisterRef} onClick={onClick} />
        if (h.kind === 'sprint') return <SprintCard key={i} s={h.data as RideSprint} index={i} active={active} onRegisterRef={onRegisterRef} />
        return <PersonalBestCard key={i} p={h.data as PersonalBest} index={i} active={active} onRegisterRef={onRegisterRef} />
      })}
    </div>
  )
}
