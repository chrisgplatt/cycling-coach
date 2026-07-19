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

```typescript
export interface RecoveryPoint {
  date: string
  score: number
  band: 'high' | 'moderate' | 'low'
}

export interface ChartsData {
  // ...existing fields unchanged...
  recoveryHistory: RecoveryPoint[]
}
```

`app/api/charts/route.ts` calls `fetchRecoveryInputsForRange` for its existing 365-day window, then `computeRecoveryScore` per date, and includes the result. No freezing/persistence needed here — unlike Strain's `trimpRef`, Recovery's HRV baseline is a same-day rolling computation with no drifting reference window, so recomputing fresh on every request is correct and matches how the charts route already treats HRV-based strain history today.

### Consumers stop computing Recovery themselves

- **`app/dashboard/page.tsx`**: deletes its `RecoveryInputs`-assembly block (`tsbForRecovery` and the manual field-by-field construction) entirely — the inputs are now server-computed. It still calls `computeRecoveryScore`, but on `chartsData.recoveryInputsToday` (server-provided, already-unified inputs) rather than on its own hand-built object; see the `RecoveryBreakdownModal` section below for why this stays a local call rather than also moving server-side. `StrainRingStrip` and `RecoveryBreakdownModal` both keep receiving the same full `RecoveryScore` shape they do today — no prop-contract changes to either.
- **`app/fitness/page.tsx`**: `RecoverySection` deletes its own `computeRecoveryScore`/`computeHrvBaseline` calls and the hardcoded `energy: null, leg_freshness: null` (fixed as a side effect — the shared fetcher includes real `daily_wellness` lookups for the whole range). Reads `chartsData.recoveryHistory` directly for its trend chart.
- **`app/api/briefing/today/route.ts`**: replaces its own `RecoveryInputs` assembly (currently built from `hrv`, `hrvStatus?.baselineMean`, `todayGarmin`, `bodyBatteryHigh`, `todayDailyWellness`, `tsb`, each independently fetched) with a call to `fetchRecoveryInputsForRange(..., { from: today, to: today })`, then `computeRecoveryScore` on the single result. The route's separate `fetchHrvStatusBestSource` call (used to populate `ctx.hrvStatus`, which is a distinct prompt field from Recovery and stays as-is) is unaffected by this change — it's a different consumer of the same underlying pure HRV logic, not touched here beyond the internal refactor above.

### `RecoveryBreakdownModal` and the loss of `RecoveryScore.components`

`RecoveryPoint` (the new `/api/charts` shape) intentionally carries only `{date, score, band}` — a full `RecoveryScore` (with its `components`/`explanation` breakdown) for *every historical day* would be a meaningfully larger payload for no current use (the trend chart only plots `score`). But `RecoveryBreakdownModal` (opened by tapping the Recovery ring) needs the full breakdown for **today** specifically.

**Decision:** `ChartsData` gains one more field, `recoveryInputsToday: RecoveryInputs | null` — today's raw inputs (not yet scored), from the same `fetchRecoveryInputsForRange` call that builds `recoveryHistory`. The dashboard calls the existing, already-client-side-imported `computeRecoveryScore(chartsData.recoveryInputsToday)` locally to get the full `RecoveryScore` object (score, band, components, explanation) whenever it's needed — for the ring's display and for `RecoveryBreakdownModal`'s full breakdown alike. This is a synchronous, pure, cheap call on data already in memory, not a second fetch — `RecoveryBreakdownModal`'s existing prop contract (`{ recovery: RecoveryScore, onClose }`) is unchanged. `recoveryHistory`'s per-day `score`/`band` are still computed server-side (by the same `computeRecoveryScore` call, applied to each day) so the trend chart doesn't need to run the scoring function client-side for 30+ historical points.

## Files to change

| File | Change |
|---|---|
| `lib/hrv/best-source.ts` | **New** — pure `computeHrvStatusBestSource` |
| `lib/hrv/server.ts` | `fetchHrvStatusBestSource` refactored to call the new pure function internally; public behavior unchanged |
| `lib/recovery-inputs.ts` | **New** — `fetchRecoveryInputsForRange`, the single shared I/O function |
| `types/index.ts` | Add `RecoveryPoint`, add `recoveryHistory: RecoveryPoint[]` and `recoveryInputsToday: RecoveryInputs \| null` to `ChartsData` |
| `app/api/charts/route.ts` | Call `fetchRecoveryInputsForRange`, compute and include `recoveryHistory` and `recoveryInputsToday` |
| `app/dashboard/page.tsx` | Remove client-side `RecoveryInputs` assembly; compute `computeRecoveryScore(chartsData.recoveryInputsToday)` locally for the ring/modal; read `chartsData.recoveryHistory` where only score/band across history is needed |
| `app/fitness/page.tsx` | `RecoverySection` reads `chartsData.recoveryHistory` instead of computing; removes the hardcoded `energy: null, leg_freshness: null` |
| `app/api/briefing/today/route.ts` | Replace manual `RecoveryInputs` assembly with `fetchRecoveryInputsForRange(..., {from: today, to: today})` |
| Tests | New tests for `computeHrvStatusBestSource` and `fetchRecoveryInputsForRange`; updated tests for all four consumer sites |

## Out of scope

- **Persisting/freezing historical Recovery values** — unlike Strain, Recovery's per-day computation has no drifting rolling-reference component, so live recomputation on every request is correct; no `daily_wellness` schema change needed for this project.
- **Changing `computeRecoveryScore` itself** — the scoring math is unchanged; this project only unifies how its inputs are gathered.
- **A dedicated new API route** — considered and rejected in favor of extending `/api/charts`, which the dashboard and fitness page already fetch, avoiding an extra network round-trip and matching that route's existing role as the app's "daily aggregated metrics" endpoint.
