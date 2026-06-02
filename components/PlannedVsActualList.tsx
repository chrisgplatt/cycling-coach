'use client'
import { zoneFor } from './WorkoutProfileChart'
import type { AlignedSegment } from '@/lib/ride/planned-actual'

// Per-step planned → actual watts with a signed delta. Over-target deltas read warm
// (orange), under-target cool (blue), on-target neutral.
export default function PlannedVsActualList({ segments }: { segments: AlignedSegment[] }) {
  if (!segments.length) return null
  return (
    <ol className="divide-y divide-slate-100">
      {segments.map((s, i) => {
        const delta = s.planned_w > 0 ? Math.round(((s.actual_w - s.planned_w) / s.planned_w) * 100) : 0
        const deltaColour = delta > 0 ? 'text-orange-500' : delta < 0 ? 'text-blue-500' : 'text-slate-400'
        return (
          <li key={i} className="flex items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: zoneFor(s.planned_pct).fill }} />
              <span className="text-sm text-slate-700 truncate">{s.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
              <span className="text-slate-400">{s.planned_w}</span>
              <span className="text-slate-300">&rarr;</span>
              <span className="font-semibold text-slate-600">{s.actual_w}w</span>
              <span className={`${deltaColour} w-10 text-right`}>{delta > 0 ? '+' : ''}{delta}%</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
