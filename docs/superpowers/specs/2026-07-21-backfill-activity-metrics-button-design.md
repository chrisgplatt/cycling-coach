# Backfill All-Time Bests Button Design

**Date:** 2026-07-21
**Status:** Approved

## Problem

The all-time bests feature's new per-ride fields (climb length/path, speed-over-distance splits) only populate for newly-synced rides. Historical rides need a one-time backfill, currently only triggerable via a POST to `/api/sync?deep=1` — not something a user can casually do from the UI, and it also re-runs a full intervals.icu sync (activities, wellness, athlete data) just to reach the one backfill call it needs.

## Scope decisions

- A dedicated admin route wraps the existing `backfillActivityMetrics(..., { allTime: true })` directly, skipping the rest of `/api/sync`'s work — faster, and does exactly one thing.
- A new button in the Settings page's existing admin/debug tools card (`DailyBriefingCard.tsx`), matching the four backfill buttons already there (notes, FTP, strain, zones) exactly in style and behavior.
- Since the underlying backfill processes at most 25 rides per call (an existing, shared limit), the result message reports progress and prompts another click if more remain — same pattern the existing strain-backfill button already uses for its own version of this limit.

## Architecture

**New route:** `app/api/admin/backfill-activity-metrics/route.ts` — mirrors `app/api/admin/backfill-strain/route.ts`'s exact structure: auth check, load `intervals_icu_athlete_id`/`intervals_icu_api_key` from `user_profile`, construct an `IntervalsClient`, call `backfillActivityMetrics(supabase, client, user.id, { allTime: true })` (already exported from `lib/intervals/enrich.ts`), return its `BackfillResult` as JSON.

**Settings page (`app/settings/page.tsx`):** new state pair (`metricsBackfilling`, `metricsBackfillResult`, typed exactly like the existing `strainBackfilling`/`strainBackfillResult` pair) and a new handler `runBackfillActivityMetrics()` mirroring `runBackfillStrain()`'s exact fetch/try/catch/finally shape, POSTing to the new route and building a message from the response's `enriched`/`totalNeeding`/`processed` fields:
- `totalNeeding === 0` → "All rides already backfilled."
- `totalNeeding > processed` → "`{enriched}` of `{totalNeeding}` rides backfilled — click again to continue."
- otherwise → "`{enriched}` of `{totalNeeding}` rides backfilled."

**`components/DailyBriefingCard.tsx`:** three new props (`metricsBackfilling`, `metricsBackfillResult`, `onRunBackfillActivityMetrics`), and a new button block placed directly after the existing strain-backfill button, byte-for-byte matching its JSX shape (same `<div className="flex items-center gap-3">` wrapper, same button classes, same disabled/label-swap-while-running behavior, same result-message paragraph styling), labeled **"Backfill all-time bests (climbs & speed)"** / **"Backfilling…"** while running.

## Files to change

| File | Change |
|---|---|
| `app/api/admin/backfill-activity-metrics/route.ts` | New — POST route wrapping `backfillActivityMetrics({ allTime: true })` |
| `app/settings/page.tsx` | New state pair, new handler, three new props passed to `DailyBriefingCard` |
| `components/DailyBriefingCard.tsx` | Three new props, new button block matching the existing backfill buttons' pattern |
| Tests | Cover the new route (401 unauthenticated, missing intervals.icu config, successful backfill call, empty/all-done case) and the new button's presence/disabled-while-running/result-message behavior |

## Out of scope

- Any change to the existing `/api/sync?deep=1` mechanism or the other three backfill buttons — all unaffected.
- Any UI for viewing per-ride backfill status individually — the existing aggregate progress message (`X of Y`) is sufficient, matching the other backfill buttons' level of detail.
