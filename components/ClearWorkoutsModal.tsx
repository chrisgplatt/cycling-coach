'use client'
import { useState } from 'react'

interface Props {
  onConfirm: () => Promise<string>
  onClose: () => void
}

export default function ClearWorkoutsModal({ onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<'confirm' | 'clearing' | 'done'>('confirm')
  const [result, setResult] = useState('')
  const isError = result.startsWith('Error')

  async function handleConfirm() {
    setPhase('clearing')
    const msg = await onConfirm()
    setResult(msg)
    setPhase('done')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        {phase === 'confirm' && (
          <>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Delete plan?</h2>
              <p className="text-sm text-slate-500 mt-1">
                This will permanently delete all planned workouts from today onwards, from both this app and intervals.icu.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="bg-red-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm"
              >
                Yes, delete
              </button>
            </div>
          </>
        )}

        {phase === 'clearing' && (
          <div className="flex items-center gap-3 py-2">
            <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin shrink-0" />
            <p className="text-sm text-slate-600">Deleting workouts…</p>
          </div>
        )}

        {phase === 'done' && (
          <>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{isError ? 'Something went wrong' : 'Done'}</h2>
              <p className={`text-sm mt-1 ${isError ? 'text-red-600' : 'text-slate-500'}`}>{result}</p>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="bg-slate-800 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-slate-900 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
