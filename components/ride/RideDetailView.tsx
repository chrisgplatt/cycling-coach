'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { RideStreams } from '@/types'
import RideMapGraph from '@/components/ride/RideMapGraph'

interface Props {
  // The streams endpoint to load this ride from (workout- or activity-keyed).
  fetchUrl: string
}

export default function RideDetailView({ fetchUrl }: Props) {
  const router = useRouter()
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    fetch(fetchUrl)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error ?? 'Could not load ride data')
        return d
      })
      .then(d => setStreams(d.streams))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [fetchUrl])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-white">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <button onClick={() => router.back()} className="min-w-[44px] min-h-[44px] flex items-center text-blue-600 text-sm font-medium">
          ← Back
        </button>
        <h1 className="text-base font-bold text-gray-900">Ride detail</h1>
      </div>

      {loading && <p className="text-sm text-gray-400 p-6">Loading ride…</p>}
      {error && !loading && (
        <div className="p-6 space-y-3">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={load} className="text-sm font-medium text-blue-600 py-2.5 px-4 rounded-lg bg-blue-50">Retry</button>
        </div>
      )}
      {streams && !loading && !error && <RideMapGraph streams={streams} />}
    </div>
  )
}
