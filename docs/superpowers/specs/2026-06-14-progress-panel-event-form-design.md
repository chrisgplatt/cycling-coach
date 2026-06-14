# Progress Panel — Event Countdown & Form Tile Design

## Goal

Add two motivational/actionable tiles to the Progress panel on the dashboard: an event countdown banner showing days until the nearest upcoming event, and a Form (TSB) tile showing current training stress balance.

## Architecture

Extends the existing props pattern established by `weeklyProgress`. Two new optional props are added to `ProgressStats` — `eventCountdown` and `form` — computed by the dashboard from data already in memory. No new API calls, no new state, no new fetches.

## Data Flow

```
dashboard/page.tsx
  ├── events (TrainingEvent[]) ──► compute eventCountdown
  ├── syncData (ICUSyncData)   ──► compute form (from wellness[].form)
  └── <ProgressStats syncVersion={...} weeklyProgress={...}
         eventCountdown={eventCountdown} form={form} />
```

### eventCountdown computation

```typescript
const nearestEvent = events
  .filter(e => e.date >= todayStr)
  .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null

const eventCountdown: EventCountdown | null = nearestEvent ? {
  name: nearestEvent.name,
  daysAway: Math.ceil(
    (new Date(nearestEvent.date).getTime() - new Date(todayStr).getTime())
    / (1000 * 60 * 60 * 24)
  ),
} : null
```

### form computation

```typescript
const todayWellness = syncData?.wellness.find(w => w.id === todayStr)
// wellness array is ordered newest-first from the sync API; find first entry with a non-null form
const recentWellness = [...(syncData?.wellness ?? [])].sort((a, b) => b.id.localeCompare(a.id)).find(w => w.form !== null)
const form: number | null = todayWellness?.form ?? recentWellness?.form ?? null
```

`ICUWellness.form` is the pre-computed TSB (CTL − ATL) from intervals.icu.

## New Type

Add to `types/index.ts` after `WeeklyProgress`:

```typescript
export interface EventCountdown {
  name: string
  daysAway: number
}
```

## ProgressStats Component Changes

### New props

```typescript
interface Props {
  syncVersion: number
  weeklyProgress?: WeeklyProgress | null
  eventCountdown?: EventCountdown | null  // new
  form?: number | null                    // new
}
```

### Event banner

Renders between the "Progress" header and the season tile grid. Only shown when `eventCountdown` is non-null.

```tsx
{eventCountdown && (
  <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
    <span className="text-[11px] font-semibold text-blue-700 truncate">🏁 {eventCountdown.name}</span>
    <span className="text-[11px] font-bold text-blue-700 ml-2 shrink-0">
      {eventCountdown.daysAway === 0 ? 'Today!' : `${eventCountdown.daysAway}d`}
    </span>
  </div>
)}
```

### Form tile

Becomes the 6th tile in the 3-column season grid, filling the last slot. TSB thresholds follow CLAUDE.md (−15 = meaningful accumulated fatigue):

| TSB value | Badge text | Colour |
|-----------|-----------|--------|
| > 5 | `fresh` | emerald |
| ≥ −15 | `building` | amber |
| < −15 | `tired` | red |

The `Tile` component's `TileProps` interface gains an optional `subColour?: string` prop. When `sub` is set and `subColour` is provided, the badge renders with that colour class instead of the default `text-gray-400`.

```typescript
// TileProps addition
subColour?: string
```

```tsx
// In Tile render — replace the sub branch:
} else if (sub) {
  badge = sub
  if (subColour) badgeColour = subColour
}
```

Usage for Form tile:

```tsx
{form !== null && form !== undefined && (
  <Tile
    label="Form"
    value={form > 0 ? `+${form}` : String(form)}
    sub={form > 5 ? 'fresh' : form >= -15 ? 'building' : 'tired'}
    subColour={form > 5 ? 'text-emerald-600' : form >= -15 ? 'text-amber-500' : 'text-red-500'}
  />
)}
```

## Files to Change

| File | Change |
|------|--------|
| `types/index.ts` | Add `EventCountdown` interface after `WeeklyProgress` |
| `app/dashboard/page.tsx` | Import `EventCountdown`, compute `eventCountdown` and `form`, pass as props |
| `components/ProgressStats.tsx` | Add two props, render event banner and Form tile |
| `__tests__/components/ProgressStats.test.tsx` | Add tests for new props/tiles |

## Tests

New tests in `__tests__/components/ProgressStats.test.tsx`:

```typescript
it('renders event banner with name and days', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
  render(<ProgressStats syncVersion={0} eventCountdown={{ name: 'Dragon Ride', daysAway: 78 }} />)
  await screen.findByText('245W')
  expect(screen.getByText(/Dragon Ride/)).toBeInTheDocument()
  expect(screen.getByText('78d')).toBeInTheDocument()
})

it('renders form tile with fresh badge when TSB > 5', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
  render(<ProgressStats syncVersion={0} form={12} />)
  await screen.findByText('245W')
  expect(screen.getByText('+12')).toBeInTheDocument()
  expect(screen.getByText('fresh')).toBeInTheDocument()
})

it('renders form tile with building badge when TSB is -8', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
  render(<ProgressStats syncVersion={0} form={-8} />)
  await screen.findByText('245W')
  expect(screen.getByText('-8')).toBeInTheDocument()
  expect(screen.getByText('building')).toBeInTheDocument()
})

it('renders form tile with tired badge when TSB < -15', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
  render(<ProgressStats syncVersion={0} form={-20} />)
  await screen.findByText('245W')
  expect(screen.getByText('-20')).toBeInTheDocument()
  expect(screen.getByText('tired')).toBeInTheDocument()
})

it('does not render event banner when eventCountdown is null', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
  render(<ProgressStats syncVersion={0} />)
  await screen.findByText('245W')
  expect(screen.queryByText(/days/i)).not.toBeInTheDocument()
})
```

## What Is Not In Scope

- W/kg tile (possible future addition, needs weight data flow)
- Next session preview card
- Plan phase tile
- Any changes to `/api/progress-brief`
