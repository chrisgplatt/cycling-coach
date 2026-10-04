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

interface GearResult { bikes: BikeView[] | null; error: string | null }

async function loadGear(): Promise<GearResult> {
  try {
    const d = await gearFetch<{ bikes: BikeView[] }>('/api/gear')
    return { bikes: Array.isArray(d.bikes) ? d.bikes : [], error: null }
  } catch (e) {
    return { bikes: null, error: e instanceof Error ? e.message : 'Could not load gear' }
  }
}

export function useGear() {
  const [bikes, setBikes] = useState<BikeView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A failed refresh keeps the last good data on screen and just reports the error.
  const apply = useCallback((r: GearResult) => {
    if (r.bikes) setBikes(r.bikes)
    setError(r.error)
  }, [])

  const reload = useCallback(async () => { apply(await loadGear()) }, [apply])

  useEffect(() => {
    let cancelled = false
    loadGear().then(r => { if (!cancelled) apply(r) })
    return () => { cancelled = true }
  }, [apply])

  return { bikes, error, reload }
}
