'use client'
import { useState } from 'react'

type Tab = 'plan' | 'profile' | 'events'

export default function PlanPage() {
  const [tab, setTab] = useState<Tab>('plan')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Training Plan</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your plan, profile, and events</p>
      </div>

      <div className="flex border-b border-slate-200">
        {([['plan', 'My Plan'], ['profile', 'Profile & Schedule'], ['events', 'Events']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div data-testid="tab-plan" style={{ display: tab === 'plan' ? 'block' : 'none' }}>
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
      <div data-testid="tab-profile" style={{ display: tab === 'profile' ? 'block' : 'none' }}>
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
      <div data-testid="tab-events" style={{ display: tab === 'events' ? 'block' : 'none' }}>
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    </div>
  )
}
