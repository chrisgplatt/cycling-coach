'use client'

export interface TabDef { id: string; label: string }

// Underline tab row (mirrors the stats page tabs). Horizontally scrollable on narrow
// screens; 44px-tall touch targets.
export default function TabBar({ tabs, activeId, onSelect }: {
  tabs: TabDef[]; activeId: string; onSelect: (id: string) => void
}) {
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none px-5" style={{ touchAction: 'pan-x' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          aria-selected={activeId === t.id}
          className={`flex-shrink-0 px-4 min-h-[44px] text-sm font-semibold transition-colors border-b-2 -mb-px ${
            activeId === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
