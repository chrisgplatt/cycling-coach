# Strain Trend Chart — Design Spec

**Goal:** A collapsible "Strain trend" section inside MetricsBar that shows daily strain history as a stacked bar chart (life + workout) with a total line, switchable between 1W, 1M, and 3M.

**Architecture:** `/api/charts` computes per-day strain and returns it as `ChartsData.dailyStrain`. The dashboard fetches charts once and passes the data down to both `CtlTrendStrip` and `MetricsBar`, eliminating the duplicate fetch that `CtlTrendStrip` currently makes. `MetricsBar` renders the chart inline as a collapsible footer.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, inline SVG, `lib/strain.ts`

---

## Types

### New interface in `types/index.ts`

```ts
export interface DailyStrainPoint {
  date: string    // YYYY-MM-DD
  workout: number // workout contribution, 0–14 (float, pre-rounding)
  life: number    // life signal contribution, 0–7 (float, pre-rounding)
  total: number   // combined rounded strain score, 0–21
}
```

### ChartsData extension

```ts
export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
  dailyStrain: DailyStrainPoint[]   // NEW
}
```

---

## /api/charts computation

Add `current_ftp` to the Supabase `user_profile` select. For each wellness record:

```
activityLoad = computeDailyActivityLoad(activities, date, profile.current_ftp)
lifeLoad     = computeDailyLifeLoad(w.stress_avg, w.stress_high, w.sleep_score, w.body_battery_low)
workoutPts   = Math.min(STRAIN_WORKOUT_WEIGHT, (activityLoad / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT)
lifePts      = lifeLoad ?? 0
total        = computeDailyStrain(activityLoad, lifeLoad) ?? 0
```

Only include points where `total > 0 || lifePts > 0 || workoutPts > 0` (skip empty/unknown days). Sort ascending by date.

---

## CtlTrendStrip lift

Change prop signature: `{ embedded?: boolean, chartsData?: ChartsData }`.

If `chartsData` is provided (non-null), skip the `useEffect` self-fetch entirely and use the prop directly. If `chartsData` is undefined/null, fall back to self-fetching `/api/charts` (backward compatible — embedded usage in the existing card already works).

---

## Dashboard page

Fetch `/api/charts` once in `page.tsx`. Pass results to both `CtlTrendStrip` and `MetricsBar` as props:
- `CtlTrendStrip`: `chartsData={chartsData}`
- `MetricsBar`: `strainHistory={chartsData?.dailyStrain}`

---

## MetricsBar — collapsible strain trend

### New props

```ts
strainHistory?: DailyStrainPoint[]
```

### New state

```ts
const [trendOpen, setTrendOpen]   = useState(false)
const [trendTab, setTrendTab]     = useState<'1w' | '1m' | '3m'>('1w')
```

### Toggle row

Renders at the bottom of the card (after the metrics row) only when `strainHistory` has ≥1 point. A single row with "Strain trend" label + chevron. Tapping flips `trendOpen`. Label and chevron colour is `text-gray-400` when closed, `text-gray-600` when open.

### Expanded section

Tabs (1W, 1M, 3M) then SVG chart. Tabs use the same pill style as `CtlTrendStrip`: `bg-blue-600 text-white rounded-full` for active, `text-gray-400` for inactive.

---

## Chart visual spec

### SVG constants
```
viewBox="0 0 340 104"   width="100%"
PAD_L=26  PAD_R=6  PAD_T=8  PAD_B=18
Y_MAX=21
Grid / label lines at y=0, y=10, y=20
```

### Grid
Three horizontal lines at 0, 10, 20. Y-axis labels (`0`, `10`, `20`) left-aligned at `x=PAD_L-4`, font-size 7.5px, fill `#9ca3af`.

### Bars — stacked
Per data point at centre-x `cx`:
- **Life** (amber `#f59e0b`): rect from `yOf(lifePts)` to `yOf(0)`, height = `lifePts/Y_MAX * CH`, rx=1.5
- **Workout** (blue `#3b82f6`): rect from `yOf(lifePts + workoutPts)` to `yOf(lifePts)`, height = `workoutPts/Y_MAX * CH`, rx=1.5

Both omitted if value is 0.

### Total line
Polyline connecting `(cx, yOf(total))` for each point. Stroke `#374151`, stroke-width 1.8, stroke-linecap round.

Dots (white-fill circles, stroke `#374151`, stroke-width 1.4):
- 1W (≤7 points): radius 2.4
- 1M (≤31 points): radius 1.6
- 3M (weekly, ≤14 points): no dots

### X-axis labels
- **1W**: day-of-week abbreviation (Mon/Tue/…) centred under each bar, font-size 7.5px
- **1M**: show label every 7th day as `"D Mon"` (e.g. "1 Jun"), font-size 6px
- **3M**: show ISO week label e.g. "Jun W1", font-size 6px

### Legend (below chart)
Amber square + "Wellbeing", blue square + "Workout", line+dot + "Total". Same dot-label style as `StrainBreakdownSheet`.

---

## 3M weekly aggregation

Group `DailyStrainPoint[]` by ISO week (using `isoWeekStart` from `lib/chart-helpers`). For each week, compute the **mean** of `workout`, `life`, and `total` across all days in that week. This keeps the 0–21 y-axis scale consistent across all tabs.

---

## What does NOT change

- `lib/strain.ts` — no modifications
- `StrainBreakdownSheet.tsx` — no modifications
- Supabase schema — no new tables or columns
