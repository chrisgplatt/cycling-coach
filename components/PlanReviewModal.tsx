'use client'
import { useState } from 'react'
import type { GeneratedPlan } from '@/types'
import AnimatedLogo from './AnimatedLogo'

interface Props {
  plan: GeneratedPlan | null
  loading?: boolean
  workoutsFound?: number
  estimatedWorkouts?: number
  onApprove: () => void
  onReject: () => void
}

const PHASE_LABELS: Record<string, string> = {
  base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper',
}
const TYPE_COLOURS: Record<string, string> = {
  endurance: 'bg-blue-100 text-blue-700',
  threshold: 'bg-orange-100 text-orange-700',
  intervals: 'bg-red-100 text-red-700',
  recovery: 'bg-green-100 text-green-700',
}

export default function PlanReviewModal({
  plan,
  loading = false,
  workoutsFound = 0,
  estimatedWorkouts = 0,
  onApprove,
  onReject,
}: Props) {
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    if (!plan) return
    setApproving(true)
    try {
      const res = await fetch('/api/plan/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Failed to apply adapted plan')
        return
      }
      onApprove()
    } catch {
      setError('Network error')
    } finally {
      setApproving(false)
    }
  }

  if (loading || !plan) {
    const pct = estimatedWorkouts > 0 ? Math.min(100, (workoutsFound / estimatedWorkouts) * 100) : 0
    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-10 flex flex-col items-center gap-6">
          <AnimatedLogo size={64} />
          <div className="text-center w-full space-y-3">
            <p className="text-base font-semibold text-slate-800">Adapting your training plan…</p>
            {workoutsFound > 0 ? (
              <>
                <p className="text-sm text-slate-500">
                  {workoutsFound} workout{workoutsFound !== 1 ? 's' : ''} scheduled
                  {estimatedWorkouts > 0 ? ` of ${estimatedWorkouts}` : ''}
                </p>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">Reviewing last week and adjusting your plan…</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="plan-review-modal-title" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="plan-review-modal-title" className="text-lg font-bold text-slate-900">Adapted Training Plan</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {plan.target_event_name} &mdash; {plan.target_event_date}
              </p>
            </div>
            <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full shrink-0">
              {PHASE_LABELS[plan.phase] ?? plan.phase} phase
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Coach&apos;s Rationale</p>
            <div className="border-l-4 border-blue-500 bg-blue-50/60 rounded-r-xl px-5 py-4 space-y-3">
              {plan.rationale.split(/\n+/).filter(Boolean).map((para, i) => (
                <p key={i} className="text-sm text-slate-700 leading-relaxed">{para}</p>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
              {plan.workouts.length} Workouts Scheduled
            </p>
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              {plan.workouts.slice(0, 10).map((w, i) => (
                <div
                  key={i}
                  className={`flex gap-4 items-center px-4 py-3 text-sm ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                >
                  <span className="text-slate-400 w-20 shrink-0 font-mono text-xs">{w.date}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 capitalize ${TYPE_COLOURS[w.type] ?? 'bg-slate-100 text-slate-600'}`}>
                    {w.type}
                  </span>
                  <span className="text-slate-400 text-xs shrink-0">{w.duration_minutes}m</span>
                  <span className="text-slate-600 text-xs truncate">{w.description}</span>
                </div>
              ))}
              {plan.workouts.length > 10 && (
                <div className="px-4 py-3 bg-slate-50 text-xs text-slate-400 text-center border-t border-slate-100">
                  and {plan.workouts.length - 10} more workouts
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">{error}</div>
        )}

        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onReject}
            disabled={approving}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={approve}
            disabled={approving}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {approving ? 'Saving…' : 'Approve Adapted Plan'}
          </button>
        </div>
      </div>
    </div>
  )
}
