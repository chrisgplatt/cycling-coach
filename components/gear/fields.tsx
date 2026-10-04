'use client'

export const fieldClass =
  'w-full max-w-full min-w-0 block text-sm border border-slate-200 rounded-xl px-3 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white'
// date inputs on iOS ignore CSS width unless appearance-none is set
export const dateClass = `${fieldClass} appearance-none`

export const primaryBtn =
  'w-full min-h-[44px] py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50'
export const secondaryBtn =
  'min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 disabled:opacity-50'

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  )
}

/** Local calendar date as YYYY-MM-DD, for date-input defaults. */
export const localToday = () => new Date().toLocaleDateString('en-CA')

export const errMsg = (e: unknown, fallback = 'Something went wrong') => (e instanceof Error ? e.message : fallback)
