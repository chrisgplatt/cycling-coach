# Activity Streak Calendar & Weekly Stats Design

## Goal

Add two collapsible sections at the bottom of the ProgressStats dashboard card: a Strava-style monthly activity streak calendar with weekly streak tracking, and a per-activity-type weekly stats panel with a trailing 12-week line chart.

## Architecture

Extend `ChartsData` with a lightweight `ActivitySummary[]` array — the `/api/charts` route already fetches all-type activities for 365 days but discards type/distance/elevation; we keep those fields. No new API endpoint.

Two new display-only components (`StreakCalendar`, `ActivityStatsPanel`) are added. `ProgressStats` gains two new collapsible rows at its bottom using these components and receives `activities?: ActivitySummary[]` as a new prop, passed down from the dashboard alongside the existing `chartsData`.

## Global Constraints

- All components are `'use client'`
- Tailwind only — no new CSS files
- No new external libraries
- ISO week = Mon–Sun throughout (consistent with existing `isoWeek` / `isoWeekStart` helpers)
- Activity type matching is case-insensitive regex: `/ride/i`, `/run/i`, `/walk/i`; everything else = "Other"
- Streak week = any ISO week with ≥1 activity; streak = consecutive such weeks walking backwards from today
- Current in-progress week (not yet ended) is included in the streak count if it has ≥1 activity
- Chart and stats always reflect the current ISO week + 11 prior weeks (12 total)

---

## Data Layer

### New type: `ActivitySummary`

```ts
export interface ActivitySummary {
  date: string           // YYYY-MM-DD
  type: string           // raw intervals.icu type string, e.g. "Ride", "Run", "Walk", "WeightTraining"
  distanceM: number | null
  elevationM: number | null
  movingTimeSecs: number
}
```

Add to `ChartsData`:

```ts
export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
  dailyStrain: DailyStrainPoint[]
  activities: ActivitySummary[]   // NEW
}
```

### `/api/charts` route change

Map `ICUActivity[]` → `ActivitySummary[]` and include in the response:

```ts
const activitySummaries: ActivitySummary[] = activities.map(a => ({
  date: a.start_date_local.slice(0, 10),
  type: a.type,
  distanceM: a.distance ?? null,
  elevationM: a.total_elevation_gain ?? null,
  movingTimeSecs: a.moving_time,
}))

const charts: ChartsData = { wellness, weeklyTss, rides, dailyStrain, activities: activitySummaries }
```

### Dashboard prop threading

`ProgressStats` gains one new optional prop:

```ts
activities?: ActivitySummary[]
```

Dashboard passes it:

```tsx
<ProgressStats
  ...existing props...
  activities={chartsData?.activities}
/>
```

---

## Section 1: Streak Calendar

### Collapsible row in ProgressStats

```
┌─────────────────────────────────────────────┐
│  🔥  Streak            38 wks          ›    │  ← always visible, tap to expand
├─────────────────────────────────────────────┤
│  ‹  June 2026  ›                            │
│  38 Weeks · 296 Activities                  │
│                                             │
│  M    T    W    T    F    S    S       │
│  ●🚴  ●🚴  ●🚴  ●🚴  ●🚴  ●🚴  7    ✓ │
│  ●👟  ●👟  ●👟  ●🚴  ●🚴  ●👟  ●👟  ✓ │
│  ●👟  ●👟  ●👟  ●👟  ●🚴  ●👟  ●🚴  ✓ │
│  ●👟  ●👟  24   25   26   27   28   🔥38│
│  29   30   1    2    3    4    5         │
└─────────────────────────────────────────────┘
```

### Component: `StreakCalendar`

**File:** `components/StreakCalendar.tsx`

**Props:**
```ts
interface Props {
  activities: ActivitySummary[]
  today: string   // YYYY-MM-DD
}
```

**Month navigation:** local `useState` for `viewMonth` (YYYY-MM). Default = current month. Left/right arrows decrement/increment by one month.

**Day cell rendering:**

| Day state | Render |
|---|---|
| Has ≥1 activity | Black filled circle (28×28px) + sport icon |
| Has ≥2 activities | As above + small dot (4px) below circle |
| No activity, past | Grey date number |
| Today | Date number in outlined circle (ring-1 ring-gray-400) |
| Future | Light grey date number (text-gray-300) |

**Sport icon mapping (inside black circle, white, 14px):**

Use Unicode symbols rendered as text (not emoji, to stay consistent with the app's existing icon style):
- `/ride/i` → `⊙` bicycle Unicode or a small inline SVG bike silhouette
- `/run/i` or `/walk/i` → a small inline SVG shoe silhouette
- `/weight/i` or `/strength/i` or `/gym/i` → a small inline SVG dumbbell
- anything else → a plain filled white dot (`•`)

Implementer note: use simple 14×14 inline SVG paths matching the Strava screenshot aesthetic (black circle, white icon). Avoid emoji which render inconsistently across platforms.

**Right column (week rows):**
- Complete past week, ≥1 activity → orange filled circle with white ✓
- Complete past week, 0 activities → empty outlined circle
- Current in-progress week, ≥1 activity → 🔥 + streak count (e.g. "38")
- Current in-progress week, 0 activities → empty outlined circle

**Streak algorithm (pure function, testable):**

```ts
function computeWeeklyStreak(activities: ActivitySummary[], today: string): number {
  // Group activity dates into a Set for O(1) lookup
  // Walk back ISO weeks from current week
  // Count consecutive weeks with ≥1 activity
  // Include current week if it has ≥1 activity
  // Stop at first complete week with 0 activities
}
```

**Streak Activities count:** total activities in all weeks counted toward the streak.

---

## Section 2: Activity Stats Panel

### Collapsible row in ProgressStats

```
┌─────────────────────────────────────────────┐
│  Activity                   41 km · 2h4m  › │  ← always visible, tap to expand
├─────────────────────────────────────────────┤
│  [🚲 Ride]  [👟 Run]  [🚶 Walk]  [• Other] │
│                                             │
│  Distance      Time        Elevation        │
│  41.0 km       2h 4m       786 m            │
│                                             │
│  [line chart — 12 weeks — km per week]      │
│                                             │
└─────────────────────────────────────────────┘
```

### Component: `ActivityStatsPanel`

**File:** `components/ActivityStatsPanel.tsx`

**Props:**
```ts
interface Props {
  activities: ActivitySummary[]
  today: string   // YYYY-MM-DD
}
```

**Tabs:** `['Ride', 'Run', 'Walk', 'Other']` with icons. Selected tab = orange border + text; unselected = grey. Default = first tab with any activity in the last 12 weeks (falls back to Ride).

**Activity classification:**
```ts
function classifyTab(type: string): 'Ride' | 'Run' | 'Walk' | 'Other' {
  if (/ride/i.test(type)) return 'Ride'
  if (/run/i.test(type))  return 'Run'
  if (/walk/i.test(type)) return 'Walk'
  return 'Other'
}
```

**Stats row (current ISO week, selected tab):**

| Tab | Col 1 | Col 2 | Col 3 |
|---|---|---|---|
| Ride/Run/Walk | Distance (km, 1dp) | Time (h m) | Elevation (m, rounded) |
| Other | Sessions (count) | Time (h m) | — (hidden) |

**Line chart (12 weeks):**

- X-axis: 12 week labels (e.g. "W24", "W25" … or month abbreviations for month boundaries)
- Y-axis: km per week (Ride/Run/Walk) or session count (Other); no axis labels, inferred from chart height
- Current week: vertical orange line from top to x-axis + dot marker
- Prior weeks: open circle dot markers
- Area fill below the line: faded orange (`fill-orange-100` or rgba)
- Weeks with 0 activity: dot at y=0
- No tooltip needed (stats row already shows current week values)

**Header summary** (always-visible row, before expand):
- Shows this-week total for the default tab: e.g. "41 km · 2h 4m" for Ride
- If no activities this week: "0 km this week" or just "—"

---

## ProgressStats changes

`ProgressStats` adds two collapsible rows at the bottom of its card, below all existing content:

```tsx
{activities && activities.length > 0 && (
  <>
    {/* Streak row */}
    <div className="border-t border-gray-100">
      <button onClick={() => setStreakOpen(o => !o)} className="...header row...">
        🔥 Streak · {streakWeeks} wks  <ChevronIcon open={streakOpen} />
      </button>
      {streakOpen && <StreakCalendar activities={activities} today={todayStr} />}
    </div>

    {/* Activity stats row */}
    <div className="border-t border-gray-100">
      <button onClick={() => setActivityOpen(o => !o)} className="...header row...">
        Activity · {thisWeekSummary}  <ChevronIcon open={activityOpen} />
      </button>
      {activityOpen && <ActivityStatsPanel activities={activities} today={todayStr} />}
    </div>
  </>
)}
```

Both panels are collapsed by default. `todayStr` = `localDateStr(new Date())` (existing helper).

---

## Error & Empty States

- `activities` prop is undefined or empty → neither collapsible row renders
- No activities in viewed calendar month → all cells show plain date numbers; right column shows empty circles
- No activities for selected tab → stats show "0 km" / "0 sessions"; chart shows flat line at zero

---

## Testing

**Unit tests** (`__tests__/lib/streak.test.ts` or inline in the component test):
- `computeWeeklyStreak`: consecutive weeks, broken streak, current week in-progress, empty input
- `classifyTab`: Ride variants, Run variants, Walk variants, unknown type → Other

**Component tests** (`__tests__/components/StreakCalendar.test.tsx`, `ActivityStatsPanel.test.tsx`):
- Renders correct number of day cells for a given month
- Activity days get filled circle; empty past days get plain number
- Current week right-column shows flame; past complete week shows checkmark
- Tab switching updates stats and chart data
- No crash when `activities` is empty

**No new API tests** — `/api/charts` already has coverage; the new mapping is a pure `map()` call.
