'use client'
import { useState, useEffect, useRef } from 'react'

interface Props {
  onExtend: () => void
  onRegenerate: () => void
  onRename: () => void
  onClearFuture: () => void
  onClosePlan: () => void
}

export default function PlanKebabMenu({ onExtend, onRegenerate, onRename, onClearFuture, onClosePlan }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function pick(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Plan options"
        onClick={() => setOpen(o => !o)}
        className="bg-white/20 hover:bg-white/30 text-white rounded-lg px-2 py-1.5 text-sm leading-none transition-colors min-h-[44px]"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-100 py-1 min-w-[170px] z-30">
          <button
            onClick={() => pick(onExtend)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors min-h-[44px]"
          >
            Extend plan
          </button>
          <button
            onClick={() => pick(onRegenerate)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors min-h-[44px]"
          >
            Regenerate plan
          </button>
          <button
            onClick={() => pick(onRename)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors min-h-[44px]"
          >
            Rename plan
          </button>
          <button
            onClick={() => pick(onClearFuture)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-amber-600 hover:bg-amber-50 transition-colors min-h-[44px]"
          >
            Clear future workouts
          </button>
          <div className="mx-3 border-t border-slate-100 my-1" />
          <button
            onClick={() => pick(onClosePlan)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors min-h-[44px]"
          >
            Close plan
          </button>
        </div>
      )}
    </div>
  )
}
