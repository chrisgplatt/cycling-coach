'use client'
import { useState } from 'react'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i)
  return output
}

interface Props {
  onEnabled: () => void
}

export default function NotificationBanner({ onEnabled }: Props) {
  const [state, setState] = useState<'idle' | 'requesting' | 'denied' | 'done'>('idle')

  async function enable() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setState('denied')
      return
    }
    setState('requesting')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setState('denied')
      return
    }
    try {
      const registration = await navigator.serviceWorker.ready
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) throw new Error('VAPID key not configured')

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      })

      const json = subscription.toJSON()
      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        }),
      })
      if (!res.ok) throw new Error('Subscribe API failed')
      setState('done')
      onEnabled()
    } catch {
      setState('denied')
    }
  }

  if (state === 'done') return null

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
      <p className="text-sm text-blue-700">
        {state === 'denied'
          ? 'Notifications blocked — enable them in your browser settings.'
          : 'Get your daily training briefing each morning.'}
      </p>
      {state !== 'denied' && (
        <button
          onClick={enable}
          disabled={state === 'requesting'}
          className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors"
        >
          {state === 'requesting' ? 'Enabling…' : 'Enable notifications →'}
        </button>
      )}
    </div>
  )
}
