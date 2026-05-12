'use client'
import { useState } from 'react'
import type { GeneratedPlan } from '@/types'

interface Props {
  plan: GeneratedPlan
  onApprove: () => void
  onReject: () => void
}

export default function PlanApprovalModal({ plan, onApprove, onReject }: Props) {
  const [name, setName] = useState('')
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setApproving(true)
    try {
      const res = await fetch('/api/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, name: name.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Failed to save plan')
        return
      }
      if (data.upload_warnings?.length) {
        setError(`Plan saved, but ${data.upload_warnings.length} workout(s) failed to upload to intervals.icu: ${data.upload_warnings[0]}`)
      }
      onApprove()
    } catch {
      setError('Network error')
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="font-semibold text-gray-800">New Training Plan</h2>
          <p className="text-sm text-gray-500 mt-1">
            {plan.target_event_name} — {plan.target_event_date} ({plan.phase} phase)
          </p>
          <div className="mt-3">
            <label htmlFor="plan-name" className="text-xs font-medium text-gray-600 block mb-1">Plan name</label>
            <input
              id="plan-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Base Block 1"
              maxLength={100}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="border border-gray-200 rounded p-4 space-y-3">
            {plan.rationale.split('\n\n').map((para, i) => (
              <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
            ))}
          </div>

          <h3 className="text-sm font-medium text-gray-700">
            {plan.workouts.length} workouts scheduled
          </h3>

          <div className="space-y-2">
            {plan.workouts.slice(0, 10).map((w, i) => (
              <div key={i} className="flex gap-3 text-sm items-start">
                <span className="text-gray-400 w-20 shrink-0">{w.date}</span>
                <span className="font-medium w-24 shrink-0 capitalize">{w.type}</span>
                <span className="text-gray-600">{w.duration_minutes}min — {w.description}</span>
              </div>
            ))}
            {plan.workouts.length > 10 && (
              <p className="text-xs text-gray-400">…and {plan.workouts.length - 10} more workouts</p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 px-6 pb-2">{error}</p>}

        <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onReject} className="text-sm text-gray-500 hover:text-gray-700">
            Reject
          </button>
          <button
            onClick={approve}
            disabled={approving || name.trim() === ''}
            className="bg-blue-600 text-white text-sm px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {approving ? 'Saving…' : 'Approve & Upload to intervals.icu'}
          </button>
        </div>
      </div>
    </div>
  )
}
