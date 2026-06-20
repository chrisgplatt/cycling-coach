# Intraday Strain Polling Design

**Goal:** Poll intervals.icu for today's wellness record every 30 minutes, incorporate live body battery drain as a fourth strain life-load signal, and surface the result with an "as of HH:MM" tag inside the existing StrainBreakdownSheet.

**Architecture:** A new lightweight API endpoint fetches only today's single wellness record. A custom React hook polls it every 30 minutes from the dashboard. The strain life-load calculation gains a `batteryDrain` parameter used only when a live reading is available and the local time is after 08:00. The StrainBreakdownSheet receives an optional live override for today's entry.

**Tech Stack:** Next.js App Router API route, React hook with `setInterval`, `lib/strain.ts`, `components/StrainBreakdownSheet.tsx`, `app/dashboard/page.tsx`

---

## Files

| Action | Path |
|--------|------|
| Create | `app/api/wellness/today/route.ts` |
| Create | `hooks/useIntradayWellness.ts` |
| Modify | `lib/strain.ts` |
| Modify | `components/StrainBreakdownSheet.tsx` |
| Modify | `app/dashboard/page.tsx` |

---

## Section 1 — `/api/wellness/today` endpoint

GET endpoint. Requires authenticated Supabase session. Reads `intervals_icu_athlete_id` and `intervals_icu_api_key` from `user_profile`. Fetches today's wellness record from intervals.icu using the range endpoint with `start=today&end=today`. Returns a shaped subset of fields needed for strain computation plus the `updated` timestamp.

**Response shape:**
```ts
{
  id: string                   // YYYY-MM-DD
  updated: string              // ISO datetime from intervals.icu
  bodyBatteryMax: number | null
  bodyBatteryMin: number | null
  sleepScore: number | null
  sleepSecs: number | null
  restingHR: number | null
  steps: number | null
}
```

The endpoint maps from the raw intervals.icu field names using the same aliases already established in `IntervalsClient.getWellness()`:
- `BodyBatteryMax ?? bodyBatteryMax ?? bodyBatteryHigh ?? body_battery_high`
- `BodyBatteryMin ?? bodyBatteryMin ?? bodyBatteryLow ?? body_battery_low`

Returns 400 if intervals.icu credentials are not configured. Returns 502 if the upstream call fails. Returns 200 with `{ today: null }` if no wellness record exists for today yet.

---

## Section 2 — `useIntradayWellness` hook

Custom hook that polls `/api/wellness/today` on mount and every 30 minutes.

**Return type:**
```ts
interface IntradayWellness {
  bodyBatteryMax: number | null
  bodyBatteryMin: number | null
  batteryDrain: number | null   // computed: max - min, null if either is null
  asOf: Date | null             // when the poll completed
  isPostWake: boolean           // true if local hour >= 8
}
```

**Behaviour:**
- Fetches immediately on mount
- `setInterval` at 1 800 000 ms (30 minutes); cleared on unmount
- `batteryDrain` is computed client-side as `Math.max(0, bodyBatteryMax - bodyBatteryMin)` only when both are non-null
- `isPostWake` is `new Date().getHours() >= 8` at the time each poll resolves
- On fetch failure, keeps previous values unchanged (silent)
- Initial state: all fields null

---

## Section 3 — `lib/strain.ts` updates

### `computeDailyLifeLoad` signature change

Add a fourth optional parameter `batteryDrain: number | null = null`.

```ts
export function computeDailyLifeLoad(
  sleepScore: number | null,
  bodyBatteryHigh: number | null,
  sleepSecs: number | null,
  batteryDrain: number | null = null,
): number | null
```

Battery drain signal: weight 1.5 pts. Higher drain = higher life load.
- `rawPts = (batteryDrain / 100) * 1.5` — capped implicitly since drain cannot exceed 100
- Added to `rawScore` and `availableWeight` only when `batteryDrain !== null`

Example with all four signals present:
- Sleep quality (weight 2.0): `(100 - sleepScore) / 100 × 2.0`
- Sleep duration (weight 1.0): `(100 - sleepDurationScore) / 100 × 1.0`
- Body battery high (weight 1.5): `(100 - bodyBatteryHigh) / 100 × 1.5`
- Battery drain (weight 1.5): `(batteryDrain / 100) × 1.5`
- Total available weight: 6.0, normalized to 7 pts

All existing callers that pass three arguments remain valid — the fourth parameter defaults to null and the normalization handles its absence automatically.

### `StrainComponents` interface addition

Add `batteryDrain: number | null` to `StrainComponents` so the breakdown sheet can display it.

### `computeStrainComponents` update

Pass `batteryDrain` through to `computeDailyLifeLoad` and include `batteryDrain` in the returned `StrainComponents` object.

---

## Section 4 — `StrainBreakdownSheet` updates

### New optional props

```ts
interface Props {
  wellness: ICUWellness
  activitySummary?: string
  onClose: () => void
  // new:
  liveOverride?: {
    batteryDrain: number | null
    asOf: Date | null
    isPostWake: boolean
  }
}
```

### "As of" tag

When `liveOverride` is provided and `liveOverride.asOf` is non-null, render a small tag in the sheet header immediately below the title:

```
"as of 14:32"  (formatted from asOf using toLocaleTimeString with hour/minute only)
```

Styled: `text-[10px] font-medium text-gray-400`

### Battery drain row

Add a fourth sub-signal row in the Wellbeing section, below the existing "Body battery" row:

```
Battery drain   |   35 pts drop   [progress bar]
```

- Only rendered when `liveOverride?.isPostWake` is true and `liveOverride.batteryDrain !== null`
- Label: "Battery drain"
- Value: `${batteryDrain} pt drop` (integer)
- Progress bar width: `(batteryDrain / 100) * 100%`, amber colour matching other wellbeing bars
- If drain is 0: show "no drain" instead of "0 pt drop"

### Strain recomputation for today

When `liveOverride` is provided and `isPostWake` is true, call `computeStrainComponents` with the `batteryDrain` from `liveOverride` rather than null. This updates the total score and the donut ring proportionally. The displayed total score reflects the live value.

---

## Section 5 — `app/dashboard/page.tsx` wiring

1. Import and call `useIntradayWellness()` at the top of the dashboard component
2. Build the `liveOverride` object from the hook result
3. Pass `liveOverride` to `<StrainBreakdownSheet>` alongside the existing `wellness` and `activitySummary` props

```ts
const intradayWellness = useIntradayWellness()

const strainLiveOverride = {
  batteryDrain: intradayWellness.batteryDrain,
  asOf: intradayWellness.asOf,
  isPostWake: intradayWellness.isPostWake,
}
```

The hook is called unconditionally; the sheet only uses the override when the sheet is open for today's entry. No changes to the existing `strainSheetOpen` state or `onStrainTap` wiring.
