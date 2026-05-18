'use client'
import { useEffect, useState } from 'react'

export default function IOSInstallBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const isIOS = /iphone|ipad/i.test(navigator.userAgent)
    const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    const isDismissed = localStorage.getItem('pwa-banner-dismissed') === '1'
    if (isIOS && !isStandalone && !isDismissed) {
      setShow(true)
    }
  }, [])

  function dismiss() {
    localStorage.setItem('pwa-banner-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#1e3a5f] flex items-center gap-3 px-4 pt-3 pb-3"
    >
      <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-xs font-bold leading-tight">Add to Home Screen</p>
        <p className="text-blue-300 text-xs mt-0.5">
          Tap{' '}
          <strong className="text-white">Share</strong>{' '}
          <svg className="inline align-middle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>{' '}
          then{' '}
          <strong className="text-white">Add to Home Screen</strong>
        </p>
      </div>
      <button
        onClick={dismiss}
        className="text-blue-300 hover:text-white text-xl leading-none p-1 shrink-0"
        aria-label="Dismiss install banner"
      >
        ×
      </button>
    </div>
  )
}
