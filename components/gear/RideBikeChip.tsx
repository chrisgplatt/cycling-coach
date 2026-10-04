'use client'
import { useEffect, useState } from 'react'
import { gearFetch, useGear } from '@/lib/gear/client'
import { resolveBikeForRide } from '@/lib/gear/resolve-bike'
import GearSheet from '@/components/gear/GearSheet'

interface Props {
  activityId: string
  isIndoor: boolean
}

/** "Bike: X" chip on a ride, with a picker to override the bike. Hidden until the user has bikes and the ride has a workout row. */
export default function RideBikeChip({ activityId, isIndoor }: Props) {
  const { bikes } = useGear()
  const [ride, setRide] = useState<{ workoutId: string; bikeId: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    gearFetch<{ workoutId: string; bikeId: string | null }>(`/api/rides/activity/${activityId}/bike`)
      .then(d => { if (!cancelled && d?.workoutId) setRide({ workoutId: d.workoutId, bikeId: d.bikeId ?? null }) })
      .catch(() => { /* no workout row for this activity → no chip */ })
    return () => { cancelled = true }
  }, [activityId])

  if (!bikes?.length || !ride) return null

  const choices = bikes.filter(b => !b.retired_at)
  const current = bikes.find(b => b.id === ride.bikeId)

  async function assign(bikeId: string) {
    if (!ride) return
    setSaving(true)
    setError(null)
    try {
      await gearFetch(`/api/workouts/${ride.workoutId}/bike`, 'PATCH', { bike_id: bikeId })
      setRide({ ...ride, bikeId })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const defaultId = resolveBikeForRide({ isIndoor }, choices)

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true) }}
        className="inline-flex items-center min-h-[44px] px-3 rounded-full bg-slate-100 text-sm font-medium text-slate-700"
      >
        Bike: {current?.name ?? 'None'}
      </button>
      {open && (
        <GearSheet title="Bike for this ride" onClose={() => setOpen(false)}>
          <div className="space-y-2">
            {choices.map(b => (
              <button
                key={b.id}
                disabled={saving}
                aria-current={b.id === ride.bikeId ? 'true' : undefined}
                onClick={() => assign(b.id)}
                className={`w-full flex items-center justify-between text-left px-4 py-3 min-h-[44px] rounded-xl border text-sm font-medium ${b.id === ride.bikeId ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-800'}`}
              >
                {b.name}
                {b.id === ride.bikeId && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
          {defaultId && (
            <button
              disabled={saving}
              onClick={() => assign(defaultId)}
              className="w-full min-h-[44px] py-2.5 text-sm font-medium text-blue-600"
            >
              Reset to default
            </button>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </GearSheet>
      )}
    </>
  )
}
