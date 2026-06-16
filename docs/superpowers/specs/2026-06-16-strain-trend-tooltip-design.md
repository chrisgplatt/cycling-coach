# Strain Trend Tooltip — Design Spec

**Goal:** Tapping or hovering a bar/point in the strain trend chart (`components/MetricsBar.tsx`) shows a small tooltip with that point's full contributing-factor breakdown — workout TSS, sleep score, sleep duration, body battery, plus the workout/wellbeing point split and total.

**Architecture:** `computeStrainComponents` (`lib/strain.ts`) already computes the raw signal values needed for the tooltip; `/api/charts` currently discards them when building `DailyStrainPoint`. We retain them on the type and thread them through to the chart. The `StrainChart` component gains hit-target rects per data point, local `activeIdx` state, and an HTML tooltip overlay positioned above the active point. The 3M tab (weekly aggregation) averages the new raw fields the same way it already averages `workout`/`life`/`total`.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, inline SVG (no new dependencies).

---

## Types

### `DailyStrainPoint` extension (`types/index.ts`)

```ts
export interface DailyStrainPoint {
  date: string                       // YYYY-MM-DD
  workout: number                    // workout contribution, 0–14 (float, pre-rounding)
  life: number                       // life signal contribution, 0–7 (float, pre-rounding)
  total: number                      // combined rounded strain score, 0–21
  workoutLoad: number                // raw activity load (TSS-equivalent) behind `workout`
  sleepScore: number | null          // 0–100, null if not synced
  sleepSecs: number | null           // seconds, null if not synced
  bodyBatteryHigh: number | null     // 0–100 daily peak, null if not synced
}
```

The four new fields are non-optional (always present on the object) but individually nullable, matching `computeStrainComponents`'s return shape — there is exactly one construction site (`/api/charts`) so there's no partial-object migration concern.

---

## `/api/charts` computation (`app/api/charts/route.ts`)

Current code discards `components.workoutLoad`, `components.sleepScore`, `components.sleepSecs`, `components.bodyBatteryHigh` after computing `components`. Change the `dailyStrain` map to retain them:

```ts
const dailyStrain: DailyStrainPoint[] = wellness
  .map(w => {
    const activityLoad = computeDailyActivityLoad(activities, w.id, ftp)
    const components = computeStrainComponents(
      activityLoad > 0 ? activityLoad : null,
      w.sleep_score,
      w.body_battery_high,
      w.sleep_secs,
    )
    if (!components) return null
    return {
      date: w.id,
      workout: components.workoutPts,
      life: components.lifePts,
      total: components.total,
      workoutLoad: components.workoutLoad,
      sleepScore: components.sleepScore,
      sleepSecs: components.sleepSecs,
      bodyBatteryHigh: components.bodyBatteryHigh,
    }
  })
  .filter((p): p is DailyStrainPoint => p !== null && (p.total > 0 || p.life > 0 || p.workout > 0))
```

No other part of the route changes. No new Supabase columns, no new API calls — this data already exists mid-computation on every request.

---

## `strainChartData` extension (`components/MetricsBar.tsx`)

Current return type for each bucket is `{ label, workout, life, total }`. Extend to carry the new fields through for 1W/1M (direct lookup) and 3M (averaged):

```ts
function strainChartData(
  history: DailyStrainPoint[],
  tab: '1w' | '1m' | '3m',
): Array<{
  label: string
  workout: number
  life: number
  total: number
  workoutLoad: number
  sleepScore: number | null
  sleepSecs: number | null
  bodyBatteryHigh: number | null
  dateLabel: string   // full date for tooltip header, e.g. "Mon 9 Jun"
}>
```

**1W / 1M buckets:** add a `dayLabel` helper next to the existing `MONTHS_SHORT` array, and extend the `result.push` call in the existing day loop:

```ts
function dayLabel(d: Date): string {
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  return `${dow} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}
```

```ts
result.push({
  label,
  workout: found?.workout ?? 0,
  life: found?.life ?? 0,
  total: found?.total ?? 0,
  workoutLoad: found?.workoutLoad ?? 0,
  sleepScore: found?.sleepScore ?? null,
  sleepSecs: found?.sleepSecs ?? null,
  bodyBatteryHigh: found?.bodyBatteryHigh ?? null,
  dateLabel: dayLabel(d),
})
```

`dateLabel` is computed from `d` (the loop date) regardless of whether `found` exists, so the tooltip header always has a real date even for an empty/no-data day.

**3M buckets:** average the new numeric fields across `pts` the same way `workout`/`life`/`total` are already averaged. For the two nullable signal fields (`sleepScore`, `bodyBatteryHigh`) and `sleepSecs`, average only the non-null values in the week and return `null` if none are present (mirrors how `computeDailyLifeLoad` already excludes missing signals from its denominator, so a week with partial Garmin sync doesn't silently average toward zero):

```ts
function avgOrNull(vals: Array<number | null>): number | null {
  const present = vals.filter((v): v is number => v != null)
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null
}
```

```ts
return Array.from(weekMap.entries())
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([wk, pts]) => {
    const [, month, day] = wk.split('-').map(Number)
    const label = `${MONTHS_SHORT[month - 1]} ${day}`
    const n = pts.length
    return {
      label,
      workout: pts.reduce((s, p) => s + p.workout, 0) / n,
      life: pts.reduce((s, p) => s + p.life, 0) / n,
      total: Math.round(pts.reduce((s, p) => s + p.total, 0) / n),
      workoutLoad: pts.reduce((s, p) => s + p.workoutLoad, 0) / n,
      sleepScore: avgOrNull(pts.map(p => p.sleepScore)),
      sleepSecs: avgOrNull(pts.map(p => p.sleepSecs)),
      bodyBatteryHigh: avgOrNull(pts.map(p => p.bodyBatteryHigh)),
      dateLabel: label,
    }
  })
```

`dateLabel` for a 3M bucket reuses the week `label` (`"Jun 9"` style) directly — no separate formatting needed since week buckets don't have a single day-of-week.

---

## `StrainChart` interactivity (`components/MetricsBar.tsx`)

### New state

```ts
const [activeIdx, setActiveIdx] = useState<number | null>(null)
```

Resets to `null` whenever `data` changes identity (tab switch) via a `useEffect([data])` — prevents a stale tooltip pointing at the wrong bar after switching 1W → 1M.

### Hit-target rects

For each data point, in addition to the existing visible `life`/`workout` bars, render one invisible full-height rect spanning the point's slot:

```tsx
<rect
  key={`hit-${i}`}
  x={(PAD_L + slot * i).toFixed(1)}
  y={PAD_T}
  width={slot.toFixed(1)}
  height={CH}
  fill="transparent"
  onClick={() => setActiveIdx(cur => cur === i ? null : i)}
  onMouseEnter={() => setActiveIdx(i)}
  onMouseLeave={() => setActiveIdx(cur => cur === i ? null : cur)}
  style={{ cursor: 'pointer' }}
/>
```

This rect is appended after `bars`/`dots` in the SVG (so it sits on top and is always hit-testable, regardless of bar height — including zero-height empty days, which must remain tappable to show "no data").

### Tooltip rendering

Rendered in the existing HTML overlay `div` (`absolute inset-0`), conditionally when `activeIdx !== null`:

```tsx
{activeIdx !== null && (() => {
  const d = data[activeIdx]
  const cx = PAD_L + (CW / n) * activeIdx + (CW / n) / 2
  // Clamp so the tooltip box doesn't overflow the card's left/right edges
  const clampedPct = Math.min(82, Math.max(18, (cx / VW) * 100))
  return (
    <div
      className="absolute z-10 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
      style={{ left: `${clampedPct}%`, top: yPct(yOf(d.total)), transform: 'translate(-50%, -100%) translateY(-8px)' }}
    >
      <div className="font-bold mb-1">{d.dateLabel}</div>
      <div>Workout <span className="text-blue-300">{(Math.round(d.workout * 10) / 10).toFixed(1)}/14</span>{d.workoutLoad > 0 && ` (${Math.round(d.workoutLoad)} TSS)`}</div>
      <div>Wellbeing <span className="text-amber-300">{(Math.round(d.life * 10) / 10).toFixed(1)}/7</span></div>
      {d.sleepScore != null && <div className="pl-2 text-gray-300">Sleep {d.sleepScore}/100</div>}
      {d.sleepSecs != null && <div className="pl-2 text-gray-300">Duration {(d.sleepSecs / 3600).toFixed(1)}h</div>}
      {d.bodyBatteryHigh != null && <div className="pl-2 text-gray-300">Battery {Math.round(d.bodyBatteryHigh)}%</div>}
      <div className="font-bold mt-1">Total {d.total}/21</div>
    </div>
  )
})()}
```

Notes:
- `pointer-events-none` on the tooltip itself so it never blocks the hit-target rects underneath (relevant when quickly moving the pointer between adjacent points on desktop).
- All three signal rows (sleep score, duration, battery) are omitted individually when `null` — no "not synced" placeholder rows, since this is a compact glance-level popover rather than the full `StrainBreakdownSheet`.
- If a point has no data at all (`workout === 0 && life === 0 && total === 0` and all signals `null`), the tooltip still renders with the date header and `Total 0/21` — no special "empty" branch needed, the existing conditionals already collapse to just date + zero totals.
- Positioned above the bar (`translateY(-8px)` past the dot/line) so it doesn't cover the point it describes.

### Dismissal

- **Tap same point again:** toggles closed (handled in the `onClick` handler above).
- **Tap a different point:** switches directly (no need to close-then-open).
- **Tap/click outside the chart:** no explicit document-level listener is added for this — the tooltip is scoped to chart interaction, consistent with the rest of the project's chart components (e.g. `CtlTrendStrip` has no outside-tap dismissal either). Tapping the "Strain trend" collapse toggle to close the section also naturally unmounts the tooltip since `StrainChart` itself unmounts.
- **Desktop hover:** `onMouseLeave` clears `activeIdx` only if it's still the same index that triggered the hover (guards against a leave event from a stale point firing after a click on another point already changed `activeIdx`).

---

## What does NOT change

- `lib/strain.ts` — no modifications; `computeStrainComponents` already returns everything needed.
- `StrainBreakdownSheet.tsx` — no modifications; remains the dedicated "today" detail view, unrelated to this trend-chart tooltip.
- Chart visual spec (bar colours, grid lines, line/dot styling) — unchanged. This is additive (hit-targets + tooltip), not a redesign.
- No new Supabase columns or API endpoints.

---

## Testing

- `__tests__/components/MetricsBar.test.tsx`: existing tests construct `wellness` directly and don't exercise `strainHistory`/`StrainChart` at all — unaffected by this change.
- New test additions (in the same file): render `MetricsBar` with a `strainHistory` prop containing one `DailyStrainPoint` with all signal fields populated, open the trend section, fire a click on the chart's SVG hit-target, and assert the tooltip text (e.g. `"Sleep 72/100"`) appears. A second test confirms clicking the same point again removes it.
- No test changes needed for `/api/charts/route.ts` — there is no existing test file for this route; this spec does not introduce one (out of scope — purely additive field passthrough, low risk).
