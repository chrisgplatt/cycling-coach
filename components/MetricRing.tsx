'use client'

interface MetricRingProps {
  displayValue: string
  pct: number       // 0-100, portion of the ring to fill
  label: string
  bandLabel: string
  color: string      // hex color for the filled arc and band label text
  onTap?: () => void
  targetLowPct?: number   // 0-100, optional tick mark position on the ring's rim
  targetHighPct?: number  // 0-100, optional tick mark position on the ring's rim
}

// A tick is rendered as a small dot at the top of a full-size wrapper div, then the
// whole wrapper is rotated around the ring's center — the classic CSS clock-hand
// technique. 0% = top (unrotated), rotating clockwise, matching the conic-gradient
// fill's own 0%-at-top convention so a tick at pct=X lines up with the fill at X%.
function RingTick({ pct, testId }: { pct: number; testId: string }) {
  const angle = (Math.max(0, Math.min(100, pct)) / 100) * 360
  return (
    <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }} data-testid={testId}>
      <div
        className="absolute rounded-full bg-gray-700"
        style={{ width: 3, height: 3, top: 1, left: '50%', marginLeft: -1.5 }}
      />
    </div>
  )
}

export default function MetricRing({
  displayValue, pct, label, bandLabel, color, onTap, targetLowPct, targetHighPct,
}: MetricRingProps) {
  const clamped = Math.max(0, Math.min(100, pct))
  const ring = (
    <>
      <div
        className="relative rounded-full flex items-center justify-center"
        style={{ width: 72, height: 72, background: `conic-gradient(${color} 0% ${clamped}%, #e5e7eb ${clamped}% 100%)` }}
      >
        {targetLowPct != null && <RingTick pct={targetLowPct} testId="ring-tick-low" />}
        {targetHighPct != null && <RingTick pct={targetHighPct} testId="ring-tick-high" />}
        <div className="rounded-full bg-white flex items-center justify-center" style={{ width: 56, height: 56 }}>
          <span className="text-[19px] font-black text-gray-900">{displayValue}</span>
        </div>
      </div>
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1.5">{label}</span>
      <span className="text-[10px] font-bold" style={{ color }}>{bandLabel}</span>
    </>
  )

  if (onTap) {
    return (
      <button
        type="button"
        onClick={onTap}
        className="flex flex-col items-center flex-1 min-h-[44px]"
        aria-label={`${label} breakdown`}
      >
        {ring}
      </button>
    )
  }
  return <div className="flex flex-col items-center flex-1">{ring}</div>
}
