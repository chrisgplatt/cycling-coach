# Max Heart Rate Design

**Goal:** Capture/derive an athlete's max heart rate (max HR) and surface it in Settings, per-ride stats, and the AI coach's Athlete State context — without disturbing the app's existing, separate LTHR-based HR zone display.

**Architecture:** A pure resolver function computes an "effective" max HR from three possible sources — manual entry, an age-based formula, and the highest heart rate ever observed in synced rides — with manual always winning and the formula/observed pair providing a sensible default for athletes who don't know their real max HR. Two new nullable columns on `user_profile` persist the manual override and the running observed maximum; nothing else in the schema changes.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, existing `IntervalsClient` sync pipeline.

## Global Constraints

- Max HR is a **standalone value** — it does not touch, replace, or feed into the app's existing LTHR-based HR zone bands (`components/SessionHistogram.tsx`), which remain exactly as they are today.
- Graceful degradation: if no manual value, no date of birth, and no observed ride data exist yet, max HR is simply unavailable (`null`) everywhere it's used — no fallback to a hardcoded constant.
- No new charting libraries; no changes to `lib/hrv/*` or `lib/recovery-score.ts`.
- Mobile-first: any new Settings UI follows the existing `inputClass`/`labelClass` patterns already used on that page (≥44px touch targets).
- Manual override always wins over both the formula and the observed value, regardless of which is higher.

---

## 1. Data Model

### New columns (`user_profile`)

```sql
alter table user_profile
  add column if not exists max_hr_manual integer,     -- athlete-entered override, bpm
  add column if not exists observed_max_hr integer;    -- highest ICUActivity.max_heartrate ever seen, bpm
```

Both nullable; no default. As with the `date_of_birth` migration, this must be run manually in the Supabase SQL editor before the matching app version is deployed — the app has no automated migration runner.

### Age-based formula

Tanaka: `208 − 0.7 × age`, using `calculateAge()` (already in `lib/age.ts`) against `user_profile.date_of_birth`. Returns `null` if `date_of_birth` is unset.

### Resolver (`lib/max-hr.ts`, new file)

```ts
export interface MaxHrInputs {
  manual: number | null
  dateOfBirth: string | null
  observed: number | null
}

export interface MaxHrResult {
  value: number
  source: 'manual' | 'estimated' | 'observed'
}

export function resolveMaxHr(inputs: MaxHrInputs): MaxHrResult | null

// Highest max_heartrate across a batch of activities, ignoring nulls; 0 if none present.
export function batchMaxHeartRate(activities: { max_heartrate: number | null }[]): number
```

Logic:
1. If `manual` is set → `{ value: manual, source: 'manual' }`.
2. Else compute `estimated = dateOfBirth ? round(208 - 0.7 * calculateAge(dateOfBirth)) : null`.
3. If both `estimated` and `observed` are null → return `null`.
4. Else return whichever of `estimated`/`observed` is higher, tagged accordingly (`'estimated'` or `'observed'`); if only one exists, use that one.

This mirrors the existing pure-function pattern (`lib/age.ts`, `lib/recovery-score.ts`) — no DB or React imports, fully unit-testable.

---

## 2. Sync-time observed-max tracking

**File:** `app/api/sync/route.ts`

After `syncData.activities` is fetched (already used to build `actsByDate`, around line 108), compute the max `max_heartrate` across the batch (via `batchMaxHeartRate()`, a small pure helper exported from `lib/max-hr.ts` alongside `resolveMaxHr` — see Testing) and compare against the stored `observed_max_hr`:

```ts
const batchMaxHr = batchMaxHeartRate(syncData.activities)
if (batchMaxHr > 0) {
  const { data: profileRow } = await supabase
    .from('user_profile')
    .select('observed_max_hr')
    .eq('user_id', user.id)
    .maybeSingle()
  if (batchMaxHr > (profileRow?.observed_max_hr ?? 0)) {
    await supabase.from('user_profile').update({ observed_max_hr: batchMaxHr }).eq('user_id', user.id)
  }
}
```

Uses `user.id` (already available from the route's `supabase.auth.getUser()` call) rather than `profile.id` — the route's existing profile query (line 95) doesn't select `id`, and RLS already scopes `user_profile` rows by `user_id`, matching the convention used elsewhere (e.g. `garmin_wellness` writes).

Regular syncs fetch a rolling 6-week window (`client.sync(6)`), so this converges toward the true historical max over time; a `?deep=1` sync (which already exists for full-history backfill) converges it immediately by scanning all history in one pass.

---

## 3. Settings — Rider personal details

**File:** `app/settings/page.tsx`

Add to the existing "Rider personal details" section (below Date of birth):

- **Not editing:** show the resolved value and source as `"{value} bpm · {label}"`, where `label` maps directly from `MaxHrResult.source`:

  | `source` | `label` |
  |---|---|
  | `'manual'` | `manual` |
  | `'estimated'` | `estimated from age` |
  | `'observed'` | `from your rides` |

  If `resolveMaxHr()` returns `null`, show `"Max HR not set"` (italic, matching the existing "Not set" convention on that page).
- **Editing:** a numeric input for `max_hr_manual` (placeholder `"e.g. 185"`), saved via the same `save()` PATCH call already used for name/DOB (add `max_hr_manual: maxHrManual || null` to the body). Leaving it blank clears the manual override, falling back to estimated/observed.

State additions: `maxHrManual`, `savedMaxHrManual` (same pattern as `dob`/`savedDob`), plus `observedMaxHr` (read-only, from the fetch — not editable, just displayed for transparency inside the resolved-value line).

---

## 4. Per-ride stats

**File:** `components/RideStats.tsx`

Next to the existing Max HR stat card, add a "% of max HR" figure: `Math.round(activity.max_heartrate / effectiveMaxHr.value * 100)}%`. Rendered only when both `activity.max_heartrate` and the resolved max HR are available; otherwise the existing Max HR card is unchanged. The effective max HR is computed once per page (via `resolveMaxHr()`) and passed down as a prop — no new fetching inside `RideStats.tsx` itself.

---

## 5. AI coaching prompts — Athlete State

Per CLAUDE.md's Athlete State requirement, append a `Max HR: Xbpm` segment to the existing inline Athlete State template in each of the following files, next to where CTL/ATL/Form/HRV/Resting HR already appear:

`lib/claude/plan.ts`, `lib/claude/review.ts`, `lib/claude/chat.ts`, `lib/claude/interview.ts`, `lib/claude/session-chat.ts`, `lib/claude/briefing.ts`, `lib/claude/coaching-notes.ts`, `lib/claude/dossier.ts`, `lib/claude/ftp.ts`.

Each file computes `resolveMaxHr()` from the profile/wellness data it already has in scope and appends `Max HR: Xbpm` (omitted entirely if `null` — matching the existing `?? '?'` / conditional-line patterns already used for optional fields in these templates). No shared builder is introduced — this is a deliberate scope boundary (see below).

**Explicitly out of scope:** consolidating the 9 files' duplicated Athlete State construction into a shared `formatAthleteState()` helper. The duplication (and its existing minor inconsistencies, e.g. `session-chat.ts` omitting Resting HR where `plan.ts` includes it) predates this feature and is a separate cleanup, not something to bundle into a "add one field" change.

---

## 6. Testing

- `lib/max-hr.ts`: unit tests covering `resolveMaxHr()` (manual override wins regardless of magnitude, estimated-vs-observed picks the higher, null when both estimate inputs are unavailable, rounding behavior) and `batchMaxHeartRate()` (picks the max, ignores nulls, returns 0 for an empty/all-null batch). Mirrors `__tests__/lib/age.test.ts` structure.
- `app/api/sync/route.ts`: no test file exists for this route today (confirmed — matching the same gap found in `/api/charts` earlier), and this change doesn't introduce one; the bump comparison itself is a one-line use of the now-tested `batchMaxHeartRate()`, consistent with this codebase's existing API-route testing boundary.
- `app/settings/page.tsx`: extend existing settings test file with manual max HR entry, display of resolved value + source, and PATCH body assertion — mirroring the date-of-birth tests added previously.
- `components/RideStats.tsx`: test that "% of max HR" renders when both values are available and is absent when either is missing.
- The 9 `lib/claude/*.ts` prompt files each already have a corresponding test file (`claude-plan.test.ts`, `review.test.ts`, `chat-prompt.test.ts`, `interview.test.ts`, `session-chat.test.ts`, `claude-briefing.test.ts`, `coaching-notes.test.ts`, `dossier.test.ts`, `claude-ftp.test.ts`) — extend each to assert the `Max HR:` segment appears when resolvable and is omitted when `null`.
