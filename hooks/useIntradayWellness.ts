'use client'
import { useState, useEffect } from 'react'

export interface IntradayWellness {
  bodyBatteryMax: number | null
  bodyBatteryMin: number | null
  batteryDrain: number | null
  asOf: Date | null
  isPostWake: boolean
}

const POLL_INTERVAL_MS = 30 * 60 * 1000

export function useIntradayWellness(): IntradayWellness {
  const [state, setState] = useState<IntradayWellness>({
    bodyBatteryMax: null,
    bodyBatteryMin: null,
    batteryDrain: null,
    asOf: null,
    isPostWake: false,
  })

  useEffect(() => {
    let cancelled = false

    async function poll() {
      const isPostWake = new Date().getHours() >= 8
      try {
        const res = await fetch('/api/wellness/today')
        if (!res.ok || cancelled) return
        const json = await res.json()
        const today = json.today
        if (!today || cancelled) return
        const max: number | null = today.bodyBatteryMax ?? null
        const min: number | null = today.bodyBatteryMin ?? null
        const drain = max !== null && min !== null ? Math.max(0, max - min) : null
        setState({ bodyBatteryMax: max, bodyBatteryMin: min, batteryDrain: drain, asOf: new Date(), isPostWake })
      } catch {
        // silent on network failure — keep previous state
      }
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return state
}
