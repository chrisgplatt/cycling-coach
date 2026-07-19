# Unified Recovery Inputs Design

**Date:** 2026-07-19
**Status:** Approved

## Problem

`computeRecoveryScore` (`lib/recovery-score.ts`) is a single pure scoring function, but its inputs are gathered independently at three call sites — `app/dashboard/page.tsx`, `app/api/briefing/today/route.ts`, and `app/fitness/page.tsx`'s `RecoverySection` — each hand-building its own `RecoveryInputs` from a differently-sourced, differently-windowed dataset. Investigation (see below) found four independent axes of divergence, not one, meaning the same athlete's Recovery score can legitimately differ between the dashboard, the AI coach's briefing, and the fitness trend chart on the same morning.

## Investigation findings

- **Three incompatible "today" resolutions**: browser-local date (dashboard, via `localDateStr(new Date())`), profile-timezone date (briefing route, via `Intl.DateTimeFormat` with `profile.timezone`), server-UTC date (`/api/sync` and `/api/charts`, via `new Date().toISOString().split('T')[0]`). These only coincide by luck, and diverge near local midnight or when device timezone ≠ profile timezone.
- **HRV source and window differ**: the briefing route prefers Garmin's raw overnight HRV (`garmin_wellness.garmin_hrv_overnight`) over a 90-day window via `fetchHrvStatusBestSource`, falling back to intervals.icu HRV only if Garmin data is insufficient. The dashboard and fitness page only ever read intervals.icu's `wellness[].hrv`, via `computeHrvBaseline` with no explicit window management beyond whatever range was fetched (42 days for the dashboard's `sync(6)`, an internally-clipped 365-day fetch for the fitness page).
- **Freshness differs**: the dashboard reads from a client-side `localStorage` cache of the last `/api/sync` POST (potentially hours stale, refreshed only on manual re-sync), while the briefing route does a live Supabase/intervals.icu query on every request.
- **A genuine bug found in the fitness page's historical trend**: `RecoverySection` computes `hrvStatus = computeHrvBaseline(wellness)` **once**, with no `asOf`, and reuses that single static baseline for every point in the 14/30-day chart — rather than each historical day getting its own contemporaneous rolling baseline (the correct, "as accurate as a live lookup" pattern already established for Strain's historical HRV use in `app/api/charts/route.ts`). This is fixed as a natural consequence of centralizing, not a separate unrelated change — it's the same class of problem this project exists to solve.
- **No shared function exists** — only the pure scoring math is shared; every site re-derives its inputs from scratch.

## Scope decisions (from brainstorming)

- **All three sites** are unified, not just dashboard vs briefing — including the fitness page's historical trend chart.
- **Garmin-preferred HRV becomes the standard everywhere**, not just in the briefing. This is a deliberate accuracy improvement, not just a consistency fix — Recovery numbers on the dashboard and fitness page may shift slightly once this ships, since the underlying HRV input changes for anyone with sufficient Garmin history.
- **Canonical "today" = profile-timezone date**, matching the briefing route's existing (more correct) convention, applied everywhere Recovery is computed.
- **No caching for Recovery-critical data** — always computed from a live/fresh bulk fetch, never served from the dashboard's stale sync cache.

## Architecture

### One new shared module: `lib/recovery-inputs.ts`

```typescript
export interface RecoveryInputsRangeResult {
  date: string
  inputs: RecoveryInputs   // from lib/recovery-score.ts, unchanged
}

export async function fetchRecoveryInputsForRange(
  supabase: SupabaseClient,
  userId: string,
  icuClient: IntervalsClient,
  range: { from: string; to: string },   // YYYY-MM-DD, profile-timezone dates
): Promise<RecoveryInputsRangeResult[]>
```

Internally, this function does every piece of I/O exactly once:
1. Fetches intervals.icu wellness for `[from, to]` (widened backward internally by 90 days so every date in the visible range has enough trailing history for a sufficient HRV baseline — mirroring how the Strain work widens its own lookback for `trimpRef`).
2. Fetches `garmin_wellness` rows for the same widened range (both the HRV column and the sleep/battery columns already selected by the existing `/api/charts` query — no new columns needed).
3. Fetches `daily_wellness` rows (energy/leg_freshness) for the same widened range.
4. Merges Garmin data into the intervals.icu wellness array via the existing `mergeGarminIntoWellness` (unchanged).
5. For each date in `[from, to]` (not the widened range — that's lookback-only), builds `RecoveryInputs` using the new pure decision function below for HRV, and the merged wellness row / daily_wellness row for everything else.

A single date is just `fetchRecoveryInputsForRange(..., { from: date, to: date })` and taking the one result — there is no separate "single-date" code path to keep in sync by hand.

### Extracted pure function: HRV best-source decision

`lib/hrv/server.ts` currently does the Garmin-vs-ICU decision as part of a live, single-date async fetch (`fetchHrvStatusBestSource`). That decision logic is pure once the two candidate histories are in hand — `computeHrvBaseline` itself already accepts a plain array and an `asOf` date and does its own internal windowing. Extract:

```typescript
// lib/hrv/best-source.ts (new)
export function computeHrvStatusBestSource(
  icuWellnessHrv: { id: string; hrv: number | null }[],
  garminHrvHistory: { id: string; hrv: number | null }[],
  asOf: string,
): HrvStatus {
  const garminStatus = computeHrvBaseline(garminHrvHistory, { asOf })
  if (garminStatus.sufficient) return garminStatus
  return computeHrvBaseline(icuWellnessHrv, { asOf })
}
```

`fetchRecoveryInputsForRange` calls this once per date in its output range, passing the already-bulk-fetched arrays — no per-day I/O, matching the existing (proven-acceptable) performance pattern already used for Strain's per-day rolling `trimpRef`/HRV baseline in the charts route.

`lib/hrv/server.ts`'s existing `fetchHrvStatusBestSource` (the live, single-date, I/O-performing version used elsewhere — e.g. wherever HRV status alone, not full Recovery, is needed) is refactored to call this same pure function internally, rather than duplicating the Garmin-then-ICU decision a second time. Its public signature and behavior are unchanged for existing callers.

### `/api/charts` gains `recoveryHistory`

**Correction found while writing the implementation plan:** the fitness page's Recovery trend chart already has a tap-a-point-for-detail feature (`RecoverySection`'s `displayed.result.components.*`) that needs the *full* `RecoveryScore` breakdown — sleep/HRV/wellness/TSB/body-battery components and the explanation string — for every historical day, not just a score and band. The original draft of this section assumed the trend chart "only plots score" and planned a slimmed-down `RecoveryPoint`; that assumption was wrong, so the per-day shape below carries the full breakdown instead:

```typescript
export interface RecoveryHistoryPoint extends RecoveryScore {   // score, band, explanation, components
  date: string
}

export interface ChartsData {
  // ...existing fields unchanged...
  recoveryHistory: RecoveryHistoryPoint[]
}
```

`app/api/charts/route.ts` calls `fetchRecoveryInputsForRange` for its existing 365-day window, then `computeRecoveryScore` per date, and includes the full result per day. No freezing/persistence needed here — unlike Strain's `trimpRef`, Recovery's HRV baseline is a same-day rolling computation with no drifting reference window, so recomputing fresh on every request is correct and matches how the charts route already treats HRV-based strain history today. (A 365-day array of small objects — a handful of numbers and a short string each — is not a meaningful payload concern; the app already returns comparably-shaped `dailyStrain` history over the same window.)

### Consumers stop computing Recovery themselves — and `RecoveryBreakdownModal` needs no local computation at all

Because `recoveryHistory` now carries the full breakdown per day, there is no longer a need for a separate "today's raw inputs" field or any client-side `computeRecoveryScore` call anywhere — every consumer just reads the entry it needs directly.

- **`app/dashboard/page.tsx`**: deletes its `RecoveryInputs`-assembly block (`tsbForRecovery` and the manual field-by-field construction) and its `computeRecoveryScore` call entirely. Reads today's entry directly from `chartsData.recoveryHistory` (the last entry, since the range always ends at today) and passes it straight through to `StrainRingStrip`/`RecoveryBreakdownModal` — both keep their existing `RecoveryScore`-shaped prop contract unchanged, just sourced differently.
- **`app/fitness/page.tsx`**: `RecoverySection` deletes its own `computeRecoveryScore`/`computeHrvBaseline` calls and the hardcoded `energy: null, leg_freshness: null` (fixed as a side effect — the shared fetcher includes real `daily_wellness` lookups for the whole range). Takes `recoveryHistory: RecoveryHistoryPoint[]` as its prop instead of `wellness: ICUWellness[]`, filters by the selected 14/30-day range client-side (unchanged UI behavior), and reads `.components`/`.explanation` directly off each point for the tap-detail feature — no shape change needed there since `RecoveryHistoryPoint` already includes everything `RecoveryScore` did.
- **`app/api/briefing/today/route.ts`**: replaces its own `RecoveryInputs` assembly (currently built from `hrv`, `hrvStatus?.baselineMean`, `todayGarmin`, `bodyBatteryHigh`, `todayDailyWellness`, `tsb`, each independently fetched) with a call to `fetchRecoveryInputsForRange(..., { from: today, to: today })`, then `computeRecoveryScore` on the single result. The route's separate `fetchHrvStatusBestSource` call (used to populate `ctx.hrvStatus`, which is a distinct prompt field from Recovery and stays as-is) is unaffected by this change — it's a different consumer of the same underlying pure HRV logic, not touched here beyond the internal refactor above.

## Files to change

| File | Change |
|---|---|
| `lib/hrv/best-source.ts` | **New** — pure `computeHrvStatusBestSource` |
| `lib/hrv/server.ts` | `fetchHrvStatusBestSource` refactored to call the new pure function internally; public behavior unchanged |
| `lib/recovery-inputs.ts` | **New** — `fetchRecoveryInputsForRange`, the single shared I/O function |
| `types/index.ts` | Add `RecoveryHistoryPoint` (`RecoveryScore & {date}`), add `recoveryHistory: RecoveryHistoryPoint[]` to `ChartsData` |
| `app/api/charts/route.ts` | Call `fetchRecoveryInputsForRange`, compute full `RecoveryScore` per date, include as `recoveryHistory` |
| `app/dashboard/page.tsx` | Remove client-side `RecoveryInputs` assembly and `computeRecoveryScore` call entirely; read today's entry from `chartsData.recoveryHistory` |
| `app/fitness/page.tsx` | `RecoverySection` takes `recoveryHistory` as a prop instead of `wellness`, removes its own `computeRecoveryScore`/`computeHrvBaseline` calls and the hardcoded `energy: null, leg_freshness: null` |
| `app/api/briefing/today/route.ts` | Replace manual `RecoveryInputs` assembly with `fetchRecoveryInputsForRange(..., {from: today, to: today})` |
| Tests | New tests for `computeHrvStatusBestSource` and `fetchRecoveryInputsForRange`; updated tests for all four consumer sites |

## Out of scope

- **Persisting/freezing historical Recovery values** — unlike Strain, Recovery's per-day computation has no drifting rolling-reference component, so live recomputation on every request is correct; no `daily_wellness` schema change needed for this project.
- **Changing `computeRecoveryScore` itself** — the scoring math is unchanged; this project only unifies how its inputs are gathered.
- **A dedicated new API route** — considered and rejected in favor of extending `/api/charts`, which the dashboard and fitness page already fetch, avoiding an extra network round-trip and matching that route's existing role as the app's "daily aggregated metrics" endpoint.
