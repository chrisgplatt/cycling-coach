'use client'

interface MetricRingProps {
  displayValue: string
  pct: number       // 0-100, portion of the ring to fill
  label: string
  bandLabel: string
  color: string      // hex color for the filled arc and band label text
  onTap?: () => void
}

export default function MetricRing({ displayValue, pct, label, bandLabel, color, onTap }: MetricRingProps) {
  const clamped = Math.max(0, Math.min(100, pct))
  const ring = (
    <>
      <div
        className="rounded-full flex items-center justify-center"
        style={{ width: 72, height: 72, background: `conic-gradient(${color} 0% ${clamped}%, #e5e7eb ${clamped}% 100%)` }}
      >
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
