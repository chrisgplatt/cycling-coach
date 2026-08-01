# Recovery Streak Alert Design

**Date:** 2026-08-01
**Status:** Approved

## Problem

The daily coach note already surfaces today's Recovery Score (`lib/recovery-score.ts`, 0–100, bands `'high'` ≥75 / `'moderate'` 50–74 / `'low'` <50 — displayed as Green/Amber/Red) as a single line in the Claude prompt (`lib/claude/briefing.ts`). But the note only ever sees a one-day snapshot — it has no way to know whether today's Red score is an isolated bad night or the second day of a real slide into fatigue. The athlete gets the same tone of note either way, even though two Red days in a row is a meaningfully stronger signal than one.

There's no proactive notification path for this today: `sendPush` (`lib/push.ts`) is only ever called once per day, from `app/api/cron/daily-briefing/route.ts`, to deliver that day's note.

## Scope decision (from brainstorming)

- Trigger: **2 consecutive Red-band days** (score <50, i.e. `band === 'low'`), not a broader Amber-or-Red window and not a per-metric (e.g. HRV-only) trend. This reuses the existing composite score as-is.
- Delivery: **folded into the existing daily coach note**, not a separate push notification. No new cron, no new notification path, no new UI element. The only visible change is the note's tone/content on a trigger day.
- Anything beyond a 2-day streak (e.g. a distinct 3+ day badge, a dashboard banner, a dedicated push) is explicitly out of scope for this pass.

## Architecture

No new endpoints, tables, or cron jobs. This extends the existing daily-briefing computation in `app/api/briefing/today/route.ts`, which already calls:

```typescript
const recoveryInputsResult = icuClient
  ? await fetchRecoveryInputsForRange(supabase, user.id, icuClient, { from: recoveryFrom, to: today })
  : []
const recoveryResult = computeRecoveryScore(recoveryInputsResult.at(-1)?.inputs ?? { ...neutralDefaults })
```

`recoveryInputsResult` already spans a 3-day lookback window (`recoveryFrom = today - 3 days`), so the prior day's inputs are already in memory — no additional fetch.

### New helper: `getConsecutiveRedDays` in `lib/recovery-score.ts`

```typescript
export function getConsecutiveRedDays(
  results: RecoveryInputsRangeResult[],
): number {
  const last = results.at(-1)
  const prev = results.at(-2)
  if (!last || !prev) return 0
  const lastScore = computeRecoveryScore(last.inputs)
  const prevScore = computeRecoveryScore(prev.inputs)
  if (lastScore.band === 'low' && prevScore.band === 'low') return 2
  return 0
}
```

Note: when a day's inputs are entirely unavailable, `computeRecoveryScore` defaults to `score = 50` → `band = 'moderate'`, not `'low'`. This is what makes the "gap day breaks the streak" edge case below correct — a data gap can never masquerade as a Red day.

Lives beside `computeRecoveryScore` since it's the same pure-function family (no DB/side effects, easily unit-testable). Returns `0` or `2` only — not a general streak counter — matching the scope decision above. `RecoveryInputsRangeResult` is the existing type already returned by `fetchRecoveryInputsForRange` (`lib/recovery-inputs.ts`).

### Wiring into the briefing route

In `app/api/briefing/today/route.ts`, immediately after the existing `recoveryResult` computation:

```typescript
const recoveryStreakDays = getConsecutiveRedDays(recoveryInputsResult)
```

Add `recoveryStreakDays` to the `BriefingContext` object passed to the prompt builder (alongside the existing `recoveryScore`, `recoveryBand`, `recoveryExplanation` fields).

### Prompt change in `lib/claude/briefing.ts`

Immediately after the existing Recovery score line:

```typescript
if (ctx.recoveryScore != null) {
  // ...existing line...
  garminLines.push(`Recovery score: ${ctx.recoveryScore}/100 (${bandLabel})${expl}`)
  if (ctx.recoveryStreakDays >= 2) {
    garminLines.push('Recovery score has been Low (Red) for 2 consecutive days.')
  }
}
```

### New coaching rule in `cycling-coach/CLAUDE.md`

Added as a new bullet under the existing "## Daily Wellness" section, alongside the other wellness-signal rules already there:

> **Consecutive low Recovery Score (2+ days, low/Red band):** Treat as a stronger signal than a single bad day. Open the note by recommending an easy day or rest — don't bury this lower down or treat it as routine.

## Error handling / edge cases

- **Insufficient history** (new user, data gap): `results.at(-2)` is `undefined` → `getConsecutiveRedDays` returns `0`. Feature silently doesn't apply — no special-casing needed elsewhere.
- **A gap between two Red days** (e.g. Red, then a day with no data at all, then Red): the middle day's band defaults to `'moderate'`, not `'low'` (see note above), so the streak check correctly returns `0` — two Reds separated by an unknown day isn't "2 in a row."
- **No change to notification cadence or delivery**: same `sendPush` call, same once-daily timing gated by the athlete's existing `notification_time`/`timezone`. Only the note text Claude generates changes on a trigger day.

## Testing

- Unit tests for `getConsecutiveRedDays` in `lib/recovery-score.ts`'s existing test file:
  - Two consecutive Red-band days → returns `2`
  - Red day followed by Amber/Green day → returns `0`
  - Red day, gap (unavailable), Red day → returns `0`
  - Only one day of history available → returns `0`
  - Empty array → returns `0`
- A test in the briefing route/prompt-builder test suite asserting the new prompt line and `recoveryStreakDays` field only appear when the trigger condition is met, and are absent otherwise.
