'use client'
import { useState } from 'react'
import type { ICUWellness } from '@/types'
import HrvChart from '@/components/HrvChart'

// Collapsible HRV trend graph, placed directly below HrvStatusChip's "HRV · Balanced"
// summary row on the dashboard. Hidden entirely when there's no HRV history to show.
export default function HrvTrendPanel({ wellness }: { wellness: ICUWellness[] }) {
  const [open, setOpen] = useState(false)
  const hasHrvHistory = wellness.some(w => w.hrv !== null)
  if (!hasHrvHistory) return null

  return (
    <div className="bg-white overflow-hidden">
      <div
        className="flex items-center justify-between px-3.5 py-2 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`text-[11px] font-bold uppercase tracking-[0.06em] ${open ? 'text-gray-600' : 'text-gray-400'}`}>
          HRV trend
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          {open
            ? <path d="M3 9l4-4 4 4" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            : <path d="M3 5l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          }
        </svg>
      </div>

      {open && (
        <div className="border-t border-gray-100">
          <HrvChart wellness={wellness} defaultRangeDays={7} />
        </div>
      )}
    </div>
  )
}
