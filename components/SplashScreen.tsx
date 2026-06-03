'use client'
import { useEffect, useState } from 'react'
import AnimatedLogo from './AnimatedLogo'

// Shown once per app open (per browser session). The bike rides in from the left
// with its wheels spinning, settles centre, the name fades in, then the whole
// overlay fades out. Gated on sessionStorage so in-app navigation doesn't replay
// it — only a fresh launch / cold load does.
const SESSION_KEY = 'cc_splash_shown'

const RIDE_MS = 700      // logo ride-in duration (matches the ride-in keyframe)
const HOLD_MS = 700      // settled, spinning, before we start leaving
const FADE_MS = 350      // overlay fade-out duration

export default function SplashScreen() {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let alreadyShown = false
    try {
      alreadyShown = sessionStorage.getItem(SESSION_KEY) === '1'
    } catch {
      /* sessionStorage unavailable (private mode) — show the splash this once */
    }
    if (alreadyShown) return
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      /* ignore storage errors */
    }

    setVisible(true)
    const fadeTimer = setTimeout(() => setLeaving(true), RIDE_MS + HOLD_MS)
    const doneTimer = setTimeout(() => setVisible(false), RIDE_MS + HOLD_MS + FADE_MS)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      data-testid="splash-screen"
      role="status"
      aria-label="Loading My Cycling Coach"
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#2563EB] transition-opacity ease-out ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="animate-[ride-in_0.7s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none">
          <AnimatedLogo size={150} bare />
        </div>
        <span className="text-lg font-bold tracking-tight text-white animate-[splash-fade-up_0.4s_ease-out_0.55s_both] motion-reduce:animate-none">
          My Cycling Coach
        </span>
      </div>
    </div>
  )
}
