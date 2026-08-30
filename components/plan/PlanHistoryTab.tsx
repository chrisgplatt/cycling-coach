'use client'
import { useEffect, useState } from 'react'
import PlanHistoryCard from '@/components/plan/PlanHistoryCard'
import PlanSummaryRollup from '@/components/plan/PlanSummaryRollup'
import type { PlanArchiveSummary } from '@/types'

interface HistoryPlan {
  id: string
  name: string
  target_event_name: string
  target_event_date: string
  closed_at: string | null
  archive_summary: PlanArchiveSummary | null
}

export default function PlanHistoryTab() {
  const [plans, setPlans] = useState<HistoryPlan[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/plan/history')
      .then(res => res.json())
      .then(data => { if (!cancelled) setPlans(data.plans ?? []) })
      .catch(() => { if (!cancelled) setError('Failed to load plan history') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-3">
      <PlanSummaryRollup />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && plans === null && <p className="text-sm text-slate-400">Loading…</p>}
      {!error && plans !== null && plans.length === 0 && (
        <p className="text-sm text-slate-500">No closed plans yet — plans you close or replace will show up here.</p>
      )}
      {!error && plans !== null && plans.length > 0 && (
        <div className="space-y-3" data-testid="plan-history-list">
          {plans.map(p => <PlanHistoryCard key={p.id} plan={p} />)}
        </div>
      )}
    </div>
  )
}
