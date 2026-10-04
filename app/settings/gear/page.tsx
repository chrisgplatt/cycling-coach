'use client'
import { useState } from 'react'
import Link from 'next/link'
import { gearFetch, useGear } from '@/lib/gear/client'
import BikeCard from '@/components/gear/BikeCard'
import BikeDetail from '@/components/gear/BikeDetail'
import BikeSheet from '@/components/gear/BikeSheet'
import BackfillPrompt from '@/components/gear/BackfillPrompt'
import { primaryBtn } from '@/components/gear/fields'

export default function GearPage() {
  const { bikes, error, reload } = useGear()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [backfill, setBackfill] = useState<{ bikeName: string; count: number } | null>(null)

  const selected = bikes?.find(b => b.id === selectedId) ?? null
  const active = bikes?.filter(b => !b.retired_at) ?? []
  const retired = bikes?.filter(b => b.retired_at) ?? []

  async function addBike(v: { name: string; kind: string }) {
    const d = await gearFetch<{ bike: { name: string }; unassignedRideCount: number }>('/api/gear/bikes', 'POST', v)
    if (d.unassignedRideCount > 0) setBackfill({ bikeName: d.bike.name, count: d.unassignedRideCount })
    await reload()
  }

  async function runBackfill(from?: string) {
    await gearFetch('/api/gear/backfill', 'POST', from ? { from } : {})
    setBackfill(null)
    await reload()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <Link href="/settings" className="min-h-[44px] flex items-center text-blue-600 text-sm font-medium">← Settings</Link>
      </div>
      <h1 className="text-xl font-bold text-slate-900">Bikes &amp; components</h1>

      {error && !bikes && <p className="text-sm text-red-600">{error}</p>}
      {!bikes && !error && <p className="text-sm text-slate-400">Loading…</p>}

      {backfill && (
        <BackfillPrompt bikeName={backfill.bikeName} count={backfill.count} onConfirm={runBackfill} onSkip={() => setBackfill(null)} />
      )}

      {bikes && selected && (
        <BikeDetail bike={selected} onBack={() => setSelectedId(null)} reload={reload} />
      )}

      {bikes && !selected && (
        <>
          {bikes.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 text-center space-y-3">
              <p className="text-base font-semibold text-slate-900">No bikes yet</p>
              <p className="text-sm text-slate-500">Add your bike to track mileage and get reminders for things like chain waxing and replacement.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {active.map(b => <BikeCard key={b.id} bike={b} onOpen={() => setSelectedId(b.id)} />)}
            </div>
          )}

          <button onClick={() => setAdding(true)} className={primaryBtn}>Add bike</button>

          {retired.length > 0 && (
            <details className="space-y-2">
              <summary className="min-h-[44px] flex items-center text-sm font-medium text-slate-600 cursor-pointer">Retired bikes ({retired.length})</summary>
              <div className="space-y-2 pt-2">
                {retired.map(b => <BikeCard key={b.id} bike={b} onOpen={() => setSelectedId(b.id)} />)}
              </div>
            </details>
          )}
        </>
      )}

      {adding && (
        <BikeSheet
          title="Add bike"
          onSave={v => addBike(v)}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
