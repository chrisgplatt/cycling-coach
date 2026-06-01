'use client'
import { useEffect, useState } from 'react'
import type { HrvStatus } from '@/lib/hrv/baseline'

const STYLE: Record<string, { dot: string; text: string; label: string }> = {
  suppressed: { dot: 'bg-rose-500', text: 'text-rose-600', label: 'Suppressed' },
  balanced:   { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Balanced' },
  elevated:   { dot: 'bg-violet-500', text: 'text-violet-600', label: 'Elevated' },
  building:   { dot: 'bg-slate-300', text: 'text-slate-500', label: 'Building baseline' },
  no_data:    { dot: 'bg-slate-300', text: 'text-slate-400', label: 'No HRV data' },
}

const ARROW: Record<string, string> = { rising: '↑', falling: '↓', stable: '→' }

export default function HrvStatusChip({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<HrvStatus | null | 'loading'>('loading')

  useEffect(() => {
    fetch('/api/hrv')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setStatus(d?.status ?? null))
      .catch(() => setStatus(null))
  }, [])

  if (status === 'loading' || status === null) return null
  const st = STYLE[status.label]
  const showNumbers = status.sevenDayAvg !== null && status.baselineMean !== null

  return (
    <div className={`px-4 py-3 flex items-center justify-between min-h-[44px] ${embedded ? 'bg-white' : 'bg-white rounded-xl border border-gray-200 shadow-sm'}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em]">HRV</span>
        <span className={`text-sm font-semibold ${st.text}`}>{st.label}</span>
      </div>
      <div className="text-right">
        {showNumbers && (
          <div className="text-xs text-gray-500">
            {status.sevenDayAvg}ms · base {status.baselineMean}ms {ARROW[status.trend]}
          </div>
        )}
        {status.label === 'suppressed' && (
          <div className="text-[11px] font-medium text-rose-500">ease today</div>
        )}
      </div>
    </div>
  )
}
