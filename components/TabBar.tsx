'use client'

export interface TabDef { id: string; label: string; dot?: boolean }

// Underline tab row (mirrors the stats page tabs). Horizontally scrollable on narrow
// screens; 44px-tall touch targets.
export default function TabBar({ tabs, activeId, onSelect }: {
  tabs: TabDef[]; activeId: string; onSelect: (id: string) => void
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none px-5 flex-shrink-0 min-h-[44px]" style={{ touchAction: 'pan-x' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          onClick={() => onSelect(t.id)}
          aria-selected={activeId === t.id}
          className={`flex-shrink-0 px-4 min-h-[44px] text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center gap-1 ${
            activeId === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
          {t.dot && (
            <span
              data-testid={`tab-dot-${t.id}`}
              aria-hidden="true"
              className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0"
            />
          )}
        </button>
      ))}
    </div>
  )
}
