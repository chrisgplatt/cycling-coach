'use client'
import { useCallback, useEffect, useState } from 'react'
import type { BikeView } from '@/lib/gear/view'

/** JSON request to a gear/ride endpoint; throws Error(message) from the `{ error }` body on failure. */
export async function gearFetch<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export function useGear() {
  const [bikes, setBikes] = useState<BikeView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const d = await gearFetch<{ bikes: BikeView[] }>('/api/gear')
      setBikes(Array.isArray(d.bikes) ? d.bikes : [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load gear')
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  return { bikes, error, reload }
}
