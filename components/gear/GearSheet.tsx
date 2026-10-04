'use client'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
}

/** Bottom sheet on mobile, centred card on larger screens. Shared by every gear form. */
export default function GearSheet({ title, onClose, children }: Props) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-3">
          <h2 className="text-lg font-bold text-slate-900 truncate">{title}</h2>
          <button onClick={onClose} className="min-h-[44px] px-2 text-sm font-medium text-slate-400 shrink-0">Close</button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden flex-1 px-5 pb-5 pt-2 space-y-4">{children}</div>
      </div>
    </div>
  )
}
