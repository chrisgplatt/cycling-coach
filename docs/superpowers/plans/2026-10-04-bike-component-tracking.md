# Bike & Component Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete track bikes and the components fitted to them, derive each component's usage from ride history, define recurring (re-wax/service) and lifetime (replacement) triggers on components, and get push + dashboard reminders at 80% and 100% of a trigger's interval.

**Architecture:** Three new tables (`bikes`, `bike_components`, `component_triggers`) plus `workouts.bike_id`. Usage is never stored: pure functions in `lib/gear/` sum distance/time over `workouts` between date bounds. Rides get a `bike_id` in a post-enrichment sync step (`assignBikesToRides`) using a pure resolver (default bike, indoor → trainer bike); manual override via a dedicated route. A second post-sync step evaluates triggers and sends heads-up/due pushes. UI is a new `/settings/gear` page, a bike chip on the ride page, and a dashboard banner.

**Tech Stack:** Next.js 16 API routes, Supabase (Postgres + RLS), `web-push` via `lib/push.ts`, Tailwind, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-04-bike-component-tracking-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing any route/page code (`AGENTS.md`: this Next.js has breaking changes).
- Migration `supabase/migrations/20261004_bikes_components.sql` must be idempotent, enable RLS with an `"own data"` policy keyed on `user_id = auth.uid()` on **every** new table (so every table carries `user_id`), and end with `notify pgrst, 'reload schema';`. Mirror the same DDL into `supabase/schema.sql`. Tell the user the exact SQL to run manually against the shared Supabase project **before** the app ships (`AGENTS.md`).
- Ride usage inputs: date = `workouts.date`; distance = `activity_metrics.distance_m` (null → 0); time = `actual_duration_minutes ?? duration_minutes`; only `status = 'completed'` rides with `bike_id` set.
- Test files are flat: `__tests__/lib/*.test.ts`, `__tests__/api/*.test.ts`, `__tests__/components/*.test.tsx`. Node-environment tests start with `/** @jest-environment node */`.
- API routes follow the existing auth pattern: `createSupabaseServerClient()` → `supabase.auth.getUser()` → 401 if none; errors as `{ error }` JSON.
- UI is mobile-first (`AGENTS.md`): sheets use `items-end sm:items-center` + `max-h-[92vh] overflow-y-auto`, touch targets ≥ 44px (`py-2.5`+), no hover-only interactions, sane at 375px.
- Run `npm run typecheck` before every commit; run `npm run test:ci` at the end. Run `graphify update .` after code changes (`CLAUDE.md`).
- No Claude prompt changes — the training rules in `CLAUDE.md` are untouched.

---

## Phase 1 — Data model and pure logic

### Task 1: Migration, schema, and types

**Files:**
- Create: `supabase/migrations/20261004_bikes_components.sql`
- Modify: `supabase/schema.sql` (append the same DDL)
- Modify: `types/index.ts` (append gear types; add `bike_id?: string | null` to the `Workout` interface)

**Interfaces:**
- Produces: `Bike`, `BikeComponent`, `ComponentTrigger`, `ComponentCategory`, `BikeKind`, `TriggerKind`, `TriggerMetric`.

- [ ] **Step 1: Write the migration**

```sql
-- Bike & component tracking. Usage is derived on read from workouts; nothing here stores counters.
create table if not exists bikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'road' check (kind in ('road','gravel','mtb','trainer','other')),
  is_default boolean not null default false,
  is_indoor_default boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists bikes_one_default on bikes(user_id) where is_default;
create unique index if not exists bikes_one_indoor_default on bikes(user_id) where is_indoor_default;

create table if not exists bike_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid not null references bikes(id) on delete cascade,
  name text not null,
  category text not null default 'other'
    check (category in ('chain','cassette','chainring','tyre','brake_pads','cables','bar_tape','other')),
  installed_at date not null default current_date,
  retired_at date,
  created_at timestamptz not null default now()
);
create index if not exists bike_components_bike_idx on bike_components(bike_id);

create table if not exists component_triggers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  component_id uuid not null references bike_components(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('recurring','lifetime')),
  metric text not null check (metric in ('km','hours')),
  interval_value numeric not null check (interval_value > 0),
  last_done_at date,
  heads_up_notified_at timestamptz,
  due_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists component_triggers_component_idx on component_triggers(component_id);

alter table workouts add column if not exists bike_id uuid references bikes(id) on delete set null;
create index if not exists workouts_bike_idx on workouts(bike_id);

alter table bikes enable row level security;
alter table bike_components enable row level security;
alter table component_triggers enable row level security;
drop policy if exists "own data" on bikes;
create policy "own data" on bikes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own data" on bike_components;
create policy "own data" on bike_components for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own data" on component_triggers;
create policy "own data" on component_triggers for all using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Append the same DDL to `supabase/schema.sql`** (and the `bike_id` column — add it to the `workouts` create block's later `alter` section the way other later columns are handled in that file; check how e.g. `actual_duration_minutes` appears there and follow suit).

- [ ] **Step 3: Add types** to the end of `types/index.ts`:

```ts
export type BikeKind = 'road' | 'gravel' | 'mtb' | 'trainer' | 'other'
export type ComponentCategory = 'chain' | 'cassette' | 'chainring' | 'tyre' | 'brake_pads' | 'cables' | 'bar_tape' | 'other'
export type TriggerKind = 'recurring' | 'lifetime'
export type TriggerMetric = 'km' | 'hours'

export interface Bike {
  id: string
  user_id: string
  name: string
  kind: BikeKind
  is_default: boolean
  is_indoor_default: boolean
  retired_at: string | null
}

export interface BikeComponent {
  id: string
  user_id: string
  bike_id: string
  name: string
  category: ComponentCategory
  installed_at: string   // YYYY-MM-DD
  retired_at: string | null
}

export interface ComponentTrigger {
  id: string
  user_id: string
  component_id: string
  label: string
  kind: TriggerKind
  metric: TriggerMetric
  interval_value: number
  last_done_at: string | null
  heads_up_notified_at: string | null
  due_notified_at: string | null
}
```

- [ ] **Step 4:** `npm run typecheck` → PASS. Commit: `Add gear schema migration and types`.

### Task 2: `resolveBikeForRide`

**Files:**
- Create: `lib/gear/resolve-bike.ts`
- Test: `__tests__/lib/gear-resolve-bike.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { resolveBikeForRide, type BikeRef } from '@/lib/gear/resolve-bike'

const road: BikeRef = { id: 'road', is_default: true, is_indoor_default: false, retired_at: null }
const trainer: BikeRef = { id: 'trainer', is_default: false, is_indoor_default: true, retired_at: null }

describe('resolveBikeForRide', () => {
  it('sends outdoor rides to the default bike', () => {
    expect(resolveBikeForRide({ isIndoor: false }, [road, trainer])).toBe('road')
  })
  it('sends indoor rides to the trainer bike when one exists', () => {
    expect(resolveBikeForRide({ isIndoor: true }, [road, trainer])).toBe('trainer')
  })
  it('falls back to the default bike for indoor rides with no trainer bike', () => {
    expect(resolveBikeForRide({ isIndoor: true }, [road])).toBe('road')
  })
  it('ignores retired bikes', () => {
    const retired = { ...trainer, retired_at: '2026-01-01T00:00:00Z' }
    expect(resolveBikeForRide({ isIndoor: true }, [road, retired])).toBe('road')
  })
  it('returns null when there is no default bike', () => {
    expect(resolveBikeForRide({ isIndoor: false }, [])).toBeNull()
  })
})
```

- [ ] **Step 2:** Run `npx jest __tests__/lib/gear-resolve-bike.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
export interface BikeRef {
  id: string
  is_default: boolean
  is_indoor_default: boolean
  retired_at: string | null
}

export function resolveBikeForRide(ride: { isIndoor: boolean }, bikes: BikeRef[]): string | null {
  const active = bikes.filter(b => !b.retired_at)
  if (ride.isIndoor) {
    const trainer = active.find(b => b.is_indoor_default)
    if (trainer) return trainer.id
  }
  return active.find(b => b.is_default)?.id ?? null
}
```

- [ ] **Step 4:** Test → PASS. Commit: `Add bike resolver for rides`.

### Task 3: Usage and trigger progress

**Files:**
- Create: `lib/gear/usage.ts`
- Test: `__tests__/lib/gear-usage.test.ts`

**Interfaces:**
- Produces: `UsageRide { date; bike_id; distance_m; minutes }`, `Usage { km; hours }`, `TriggerStatus = 'ok'|'due_soon'|'overdue'`, `bikeTotals`, `componentUsage`, `triggerProgress`, `DUE_SOON_FRACTION = 0.8`.

- [ ] **Step 1: Failing tests**

```ts
import { bikeTotals, componentUsage, triggerProgress, type UsageRide } from '@/lib/gear/usage'
import type { BikeComponent, ComponentTrigger } from '@/types'

const rides: UsageRide[] = [
  { date: '2026-09-01', bike_id: 'b1', distance_m: 50_000, minutes: 120 },
  { date: '2026-09-10', bike_id: 'b1', distance_m: 100_000, minutes: 240 },
  { date: '2026-09-20', bike_id: 'b1', distance_m: null, minutes: 60 },
  { date: '2026-09-15', bike_id: 'b2', distance_m: 30_000, minutes: 60 },
]
const comp = (o: Partial<BikeComponent> = {}): BikeComponent => ({
  id: 'c1', user_id: 'u', bike_id: 'b1', name: 'Chain', category: 'chain',
  installed_at: '2026-09-05', retired_at: null, ...o,
})
const trig = (o: Partial<ComponentTrigger> = {}): ComponentTrigger => ({
  id: 't1', user_id: 'u', component_id: 'c1', label: 'Re-wax', kind: 'recurring', metric: 'km',
  interval_value: 200, last_done_at: null, heads_up_notified_at: null, due_notified_at: null, ...o,
})

describe('bikeTotals', () => {
  it('sums only that bike, treating null distance as 0', () => {
    expect(bikeTotals('b1', rides)).toEqual({ km: 150, hours: 7 })
  })
})

describe('componentUsage', () => {
  it('counts only rides on/after installed_at', () => {
    expect(componentUsage(comp(), rides)).toEqual({ km: 100, hours: 5 })
  })
  it('stops counting after retired_at', () => {
    expect(componentUsage(comp({ retired_at: '2026-09-12' }), rides)).toEqual({ km: 100, hours: 4 })
  })
})

describe('triggerProgress', () => {
  it('recurring: counts from last_done_at', () => {
    const p = triggerProgress(trig({ last_done_at: '2026-09-11' }), comp(), rides)
    expect(p.used).toBe(0)
    expect(p.status).toBe('ok')
  })
  it('recurring: falls back to installed_at when never done', () => {
    expect(triggerProgress(trig(), comp(), rides).used).toBe(100)
  })
  it('lifetime: ignores last_done_at', () => {
    const p = triggerProgress(trig({ kind: 'lifetime', last_done_at: '2026-09-11' }), comp(), rides)
    expect(p.used).toBe(100)
  })
  it('hours metric uses time', () => {
    expect(triggerProgress(trig({ metric: 'hours', interval_value: 10 }), comp(), rides).used).toBe(5)
  })
  it('flags due_soon at 80% and overdue at 100%', () => {
    expect(triggerProgress(trig({ interval_value: 125 }), comp(), rides).status).toBe('due_soon') // 100/125 = 0.8
    expect(triggerProgress(trig({ interval_value: 100 }), comp(), rides).status).toBe('overdue')
    expect(triggerProgress(trig({ interval_value: 125.01 }), comp(), rides).status).toBe('ok')
  })
})
```

- [ ] **Step 2:** Run test → FAIL.
- [ ] **Step 3: Implement**

```ts
import type { BikeComponent, ComponentTrigger } from '@/types'

export const DUE_SOON_FRACTION = 0.8

export interface UsageRide {
  date: string            // YYYY-MM-DD
  bike_id: string | null
  distance_m: number | null
  minutes: number
}
export interface Usage { km: number; hours: number }
export type TriggerStatus = 'ok' | 'due_soon' | 'overdue'
export interface TriggerProgress { used: number; interval: number; fraction: number; status: TriggerStatus }

function sum(rides: UsageRide[], bikeId: string, from: string | null, to: string | null): Usage {
  let m = 0
  let min = 0
  for (const r of rides) {
    if (r.bike_id !== bikeId) continue
    if (from && r.date < from) continue
    if (to && r.date > to) continue
    m += r.distance_m ?? 0
    min += r.minutes
  }
  return { km: m / 1000, hours: min / 60 }
}

export function bikeTotals(bikeId: string, rides: UsageRide[]): Usage {
  return sum(rides, bikeId, null, null)
}

export function componentUsage(c: BikeComponent, rides: UsageRide[]): Usage {
  return sum(rides, c.bike_id, c.installed_at, c.retired_at)
}

export function triggerProgress(t: ComponentTrigger, c: BikeComponent, rides: UsageRide[]): TriggerProgress {
  const from = t.kind === 'recurring' ? (t.last_done_at ?? c.installed_at) : c.installed_at
  const u = sum(rides, c.bike_id, from, c.retired_at)
  const used = t.metric === 'km' ? u.km : u.hours
  const fraction = used / t.interval_value
  const status: TriggerStatus = fraction >= 1 ? 'overdue' : fraction >= DUE_SOON_FRACTION ? 'due_soon' : 'ok'
  return { used, interval: t.interval_value, fraction, status }
}
```

- [ ] **Step 4:** Test → PASS. Commit: `Add gear usage and trigger progress logic`.

### Task 4: Notification selection

**Files:**
- Create: `lib/gear/notification-select.ts`
- Test: `__tests__/lib/gear-notification-select.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { selectNotification } from '@/lib/gear/notification-select'

const none = { heads_up_notified_at: null, due_notified_at: null }

describe('selectNotification', () => {
  it('sends nothing while ok', () => {
    expect(selectNotification('ok', none)).toEqual({ send: null, setHeadsUp: false, setDue: false })
  })
  it('sends a heads-up at due_soon', () => {
    expect(selectNotification('due_soon', none)).toEqual({ send: 'heads_up', setHeadsUp: true, setDue: false })
  })
  it('does not repeat the heads-up', () => {
    expect(selectNotification('due_soon', { ...none, heads_up_notified_at: 'x' }).send).toBeNull()
  })
  it('sends due at overdue', () => {
    expect(selectNotification('overdue', { ...none, heads_up_notified_at: 'x' }))
      .toEqual({ send: 'due', setHeadsUp: false, setDue: true })
  })
  it('on a jump straight to overdue, sends only due and marks the heads-up as sent', () => {
    expect(selectNotification('overdue', none)).toEqual({ send: 'due', setHeadsUp: true, setDue: true })
  })
  it('does not repeat due', () => {
    expect(selectNotification('overdue', { heads_up_notified_at: 'x', due_notified_at: 'y' }).send).toBeNull()
  })
})
```

- [ ] **Step 2:** FAIL. **Step 3: Implement**

```ts
import type { TriggerStatus } from '@/lib/gear/usage'

export interface NotifyDecision {
  send: 'heads_up' | 'due' | null
  setHeadsUp: boolean
  setDue: boolean
}

export function selectNotification(
  status: TriggerStatus,
  sent: { heads_up_notified_at: string | null; due_notified_at: string | null },
): NotifyDecision {
  if (status === 'overdue' && !sent.due_notified_at) {
    return { send: 'due', setHeadsUp: !sent.heads_up_notified_at, setDue: true }
  }
  if (status === 'due_soon' && !sent.heads_up_notified_at) {
    return { send: 'heads_up', setHeadsUp: true, setDue: false }
  }
  return { send: null, setHeadsUp: false, setDue: false }
}
```

- [ ] **Step 4:** PASS. Commit: `Add gear notification selection`.

---

## Phase 2 — Sync integration

### Task 5: Load gear state and assign bikes to rides

**Files:**
- Create: `lib/gear/load.ts`, `lib/gear/assign-bikes.ts`
- Test: `__tests__/lib/gear-assign-bikes.test.ts`

**Interfaces:**
- Consumes: `resolveBikeForRide` (Task 2), `UsageRide` (Task 3).
- Produces: `loadGearState(supabase, userId): Promise<{ bikes: Bike[]; components: BikeComponent[]; triggers: ComponentTrigger[]; rides: UsageRide[] }>`; `assignBikesToRides(supabase, userId, opts?: { from?: string }): Promise<number>`.

- [ ] **Step 1: Write the failing test.** Build a small chainable fake Supabase (select/eq/is/not/gte/in/update returning thenables) in the test file, in the style of `makeSupabase` in `__tests__/api/workouts-disassociate.test.ts`. Cases: (a) enriched indoor ride → trainer bike id, enriched outdoor ride → default bike id, one `update({ bike_id }).in('id', [...])` per target bike; (b) returns the count assigned; (c) no bikes → returns 0 and issues no workout update; (d) the workouts query is filtered with `.is('bike_id', null)`, `.not('activity_metrics', 'is', null)` and `.not('icu_activity_id', 'is', null)` (assert on the recorded filter calls) so overrides and unenriched rides are never touched.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement `assign-bikes.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBikeForRide, type BikeRef } from '@/lib/gear/resolve-bike'

export async function assignBikesToRides(
  supabase: SupabaseClient,
  userId: string,
  opts: { from?: string } = {},
): Promise<number> {
  const { data: bikes } = await supabase
    .from('bikes')
    .select('id, is_default, is_indoor_default, retired_at')
    .eq('user_id', userId)
  if (!bikes?.length) return 0

  let q = supabase
    .from('workouts')
    .select('id, activity_metrics')
    .eq('user_id', userId)
    .is('bike_id', null)
    .not('icu_activity_id', 'is', null)
    .not('activity_metrics', 'is', null)
  if (opts.from) q = q.gte('date', opts.from)
  const { data: rows } = await q

  const byBike = new Map<string, string[]>()
  for (const row of rows ?? []) {
    const isIndoor = (row.activity_metrics as { is_indoor?: boolean } | null)?.is_indoor ?? false
    const bikeId = resolveBikeForRide({ isIndoor }, bikes as BikeRef[])
    if (!bikeId) continue
    byBike.set(bikeId, [...(byBike.get(bikeId) ?? []), row.id as string])
  }

  let assigned = 0
  for (const [bikeId, ids] of byBike) {
    const { error } = await supabase.from('workouts').update({ bike_id: bikeId }).in('id', ids)
    if (error) throw new Error(`Failed to assign bike: ${error.message}`)
    assigned += ids.length
  }
  return assigned
}
```

- [ ] **Step 4: Implement `load.ts`** — four selects scoped by `user_id` (bikes, bike_components, component_triggers, and `workouts` with `id, date, bike_id, duration_minutes, actual_duration_minutes, activity_metrics` filtered `status = 'completed'` and `bike_id not null`), mapping workouts to `UsageRide`:
`{ date, bike_id, distance_m: activity_metrics?.distance_m ?? null, minutes: actual_duration_minutes ?? duration_minutes }`. Supabase caps rows at 1000 per request by default — page with `.range()` in 1000-row chunks until a short page returns (cycling history can exceed 1000 rides).
- [ ] **Step 5:** Test → PASS; typecheck. Commit: `Assign bikes to enriched rides; load gear state`.

### Task 6: Notify due triggers and hook into sync

**Files:**
- Create: `lib/gear/notify.ts`
- Modify: `app/api/sync/route.ts` (after the `backfillActivityMetrics` try/catch, ~line 197)
- Test: `__tests__/lib/gear-notify.test.ts`

**Interfaces:**
- Consumes: `loadGearState`, `triggerProgress`, `selectNotification`, `sendPush` (`lib/push.ts`), `push_subscriptions` rows `{ endpoint, p256dh, auth }` (pattern: `app/api/cron/daily-briefing/route.ts:271`).
- Produces: `notifyDueTriggers(supabase, userId): Promise<number>` returning pushes sent.

- [ ] **Step 1: Failing test** (mock `@/lib/push` and `@/lib/gear/load`): given one bike/component/trigger at 85% → one `sendPush` per subscription with body containing "coming up" and the trigger label, and an update setting `heads_up_notified_at`; at 105% with nothing sent → one "due" push, both timestamps set; at 85% with `heads_up_notified_at` already set → no push, no update; retired components are skipped; no subscriptions → timestamps are still set only if at least one push was attempted… **decision:** with zero subscriptions, set nothing (so the user is notified once they enable push).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** For each non-retired component on a non-retired bike, for each trigger: `p = triggerProgress(...)`, `d = selectNotification(p.status, trigger)`; if `d.send`, build message — heads-up: `` `${comp.name}: ${t.label} coming up — ${fmt(p.used)} / ${t.interval_value} ${t.metric}` ``, due: `` `${comp.name}: ${t.label} due — ...` `` (`fmt` = one decimal place, trailing `.0` dropped); title `'My Cycling Coach'`, url `/settings/gear`. Skip entirely (return 0) if the user has no subscriptions. Send to every subscription in a try/catch (log, never throw); then update `heads_up_notified_at` / `due_notified_at` to `new Date().toISOString()` per `d.setHeadsUp` / `d.setDue`.
- [ ] **Step 4: Hook into sync.** After the enrichment block add (non-fatal, mirroring the surrounding style):

```ts
    try {
      await assignBikesToRides(supabase, user.id)
      await notifyDueTriggers(supabase, user.id)
    } catch (err) {
      console.error('[sync] gear assignment/notifications failed:', err)
    }
```

with imports at the top of the route. Add a sync-route assertion only if an existing sync test already mocks the same modules; otherwise rely on Task 5/6 unit tests.
- [ ] **Step 5:** Tests PASS; typecheck. Commit: `Notify heads-up and due gear triggers after sync`.

---

## Phase 3 — API

All routes under `app/api/gear/`, each starting with the standard auth check, scoping every query by `user_id`, validating input and returning `{ error }` with 400 on bad input / 404 when the row isn't the user's. Each route gets a test in `__tests__/api/gear-*.test.ts` using the `makeSupabase` fake pattern from `__tests__/api/workouts-disassociate.test.ts` (mock `@/lib/supabase-server`): 401 without a user, validation failures, and the happy path.

### Task 7: `GET /api/gear` and bikes CRUD

**Files:** Create `app/api/gear/route.ts`, `app/api/gear/bikes/route.ts`, `app/api/gear/bikes/[id]/route.ts`; tests `__tests__/api/gear-bikes.test.ts`.

- [ ] `GET /api/gear` → `loadGearState`, then returns per bike `{ ...bike, totals: bikeTotals, components: [{ ...component, usage: componentUsage, triggers: [{ ...trigger, progress: triggerProgress }] }] }`. Retired bikes and components are included with their `retired_at`; the client filters.
- [ ] `POST /api/gear/bikes` — body `{ name: string (1–60 chars), kind?: BikeKind }`. The user's first bike becomes `is_default` automatically. Response includes `{ bike, unassignedRideCount }` (completed rides with null `bike_id` and non-null `activity_metrics`) so the UI can offer the backfill.
- [ ] `PATCH /api/gear/bikes/[id]` — any of `name`, `kind`, `is_default: true`, `is_indoor_default: true|false`, `retired: true|false`. Setting `is_default: true` first clears `is_default` on the user's other bikes, then sets it (partial unique index). Same for `is_indoor_default`. Reject (400) retiring the current default bike or marking a retired bike default/trainer; retiring sets `retired_at = now()`, un-retiring clears it.
- [ ] `DELETE /api/gear/bikes/[id]` — hard delete (rides' `bike_id` → null by FK; components cascade). Reject (400) if it is the default bike.
- [ ] Tests for each rule above. Commit: `Add gear list and bike endpoints`.

### Task 8: Components, replace, and triggers

**Files:** Create `app/api/gear/components/route.ts`, `app/api/gear/components/[id]/route.ts`, `app/api/gear/components/[id]/replace/route.ts`, `app/api/gear/triggers/route.ts`, `app/api/gear/triggers/[id]/route.ts`, `app/api/gear/triggers/[id]/done/route.ts`; tests `__tests__/api/gear-components.test.ts`, `__tests__/api/gear-triggers.test.ts`.

- [ ] `POST /api/gear/components` — `{ bike_id, name, category, installed_at? (default today), triggers?: Array<{ label, kind, metric, interval_value }> }`. Verifies the bike is the user's and not retired; inserts the component then its triggers (the UI sends category presets here — chain → `[{Re-wax, recurring, km, 300}, {Replace chain, lifetime, km, 4000}]`, cassette/tyre → lifetime Replace, brake pads → lifetime Replace — defined once in `lib/gear/presets.ts`, Task 9).
- [ ] `PATCH /api/gear/components/[id]` — `name`, `category`, `installed_at`. `DELETE` hard-deletes (triggers cascade).
- [ ] `POST /api/gear/components/[id]/replace` — body `{ name?, installed_at? }`. Sets the old component's `retired_at` to `installed_at ?? today`, inserts a new component on the same bike (name defaults to the old name, `installed_at` as above) and copies each trigger as `{ label, kind, metric, interval_value }` with `last_done_at`/notified timestamps null. Returns the new component. 400 if the component is already retired.
- [ ] `POST /api/gear/triggers` — `{ component_id, label, kind, metric, interval_value > 0, last_done_at? }`. `PATCH` edits `label`, `metric`, `interval_value`, and (recurring only) `last_done_at`; changing `interval_value`/`metric` also nulls both notified timestamps so the new threshold re-evaluates. `DELETE` removes it.
- [ ] `POST /api/gear/triggers/[id]/done` — body `{ date?: YYYY-MM-DD }` (default today, must not be in the future). 400 if the trigger is `lifetime`. Sets `last_done_at = date` and nulls `heads_up_notified_at` and `due_notified_at`.
- [ ] Tests: replace retires + copies triggers with reset state; done rejects lifetime and future dates; interval edit clears notified timestamps. Commit: `Add component and trigger endpoints`.

### Task 9: Backfill and ride override; trigger presets

**Files:** Create `app/api/gear/backfill/route.ts`, `app/api/workouts/[id]/bike/route.ts`, `lib/gear/presets.ts`; tests `__tests__/api/gear-backfill.test.ts`, `__tests__/api/workout-bike.test.ts`, `__tests__/lib/gear-presets.test.ts`.

- [ ] `POST /api/gear/backfill` — body `{ from?: YYYY-MM-DD }` → `assignBikesToRides(supabase, user.id, { from })`, returns `{ assigned }`.
- [ ] `PATCH /api/workouts/[id]/bike` — body `{ bike_id: string | null }`. Verifies the workout and (when non-null) the bike belong to the user; sets `workouts.bike_id`. (`null` explicitly unassigns the ride; note a later sync will re-assign an unassigned enriched ride to its resolved bike — document this in the route comment and the UI copy "Reset to default".)
- [ ] `lib/gear/presets.ts` exports `COMPONENT_CATEGORIES` (value + label for every `ComponentCategory`) and `triggerPresetsFor(category): Array<{ label; kind; metric; interval_value }>` with the defaults above; categories without presets return `[]`. Test the chain preset has one recurring and one lifetime trigger.
- [ ] Commit: `Add gear backfill, ride bike override, and trigger presets`.

---

## Phase 4 — UI

Before each UI task, read an existing page/component for conventions (`app/settings/usage/page.tsx` for a settings sub-page, `components/AddEventModal.tsx` for a bottom-sheet form) and match its styling tokens.

### Task 10: Progress bar and bike card components

**Files:** Create `components/gear/TriggerProgressBar.tsx`, `components/gear/BikeCard.tsx`; test `__tests__/components/gear-trigger-progress-bar.test.tsx`.

- [ ] **Step 1: Failing test** — `TriggerProgressBar` given `{ label: 'Re-wax', used: 212, interval: 300, metric: 'km', status: 'ok' }` renders "Re-wax", "212 / 300 km"; `due_soon` renders an amber bar (class contains `amber`), `overdue` a red one (class contains `red`) and the text "Overdue"; the bar width is clamped to 100%.
- [ ] **Step 2:** FAIL. **Step 3: Implement** `TriggerProgressBar` (pure, props above plus `kind`, showing "Replace at …" wording for `lifetime`), and `BikeCard` (name, default/trainer badges, lifetime km + hours, tap target ≥ 44px calling `onOpen`). Numbers formatted with `Math.round(x * 10) / 10`.
- [ ] **Step 4:** PASS; typecheck. Commit: `Add gear progress bar and bike card`.

### Task 11: `/settings/gear` page and sheets

**Files:** Create `app/settings/gear/page.tsx`, `components/gear/BikeDetail.tsx`, `components/gear/BikeSheet.tsx`, `components/gear/ComponentSheet.tsx`, `components/gear/TriggerSheet.tsx`, `components/gear/MarkDoneSheet.tsx`, `components/gear/BackfillPrompt.tsx`; Modify `app/settings/page.tsx` (add a link beside the `/settings/usage` link near line 856).

- [ ] Page fetches `GET /api/gear`; shows the bike list (`BikeCard`) with an "Add bike" button; retired bikes behind a collapsed "Retired" section. Selecting a bike shows `BikeDetail`: totals, active components each with usage-since-install and its triggers as `TriggerProgressBar`s, a "Retired components" collapsed list, and per-bike actions (rename, set default, set as trainer bike, retire).
- [ ] Sheets (bottom sheets per `AGENTS.md`): `BikeSheet` (name, kind); `ComponentSheet` (name, category select → preselects preset triggers via `triggerPresetsFor`, editable intervals, installed date); `TriggerSheet` (label, kind, metric, interval); `MarkDoneSheet` (date, defaults today; only offered for `recurring` triggers); a Replace confirmation (name, installed date) calling the replace route. Each button is ≥ 44px; destructive actions confirm.
- [ ] After creating a bike with `unassignedRideCount > 0`, show `BackfillPrompt`: "Assign your N existing rides to {bike}?" with an optional from-date and Skip; confirm calls `POST /api/gear/backfill` then refetches.
- [ ] Empty state: "No bikes yet" with an Add bike CTA.
- [ ] Verify at 375px width using the app (`run` skill) — screenshot the list, a detail page with a chain showing both triggers, and one sheet. Commit: `Add gear settings page`.

### Task 12: Ride bike chip and dashboard banner

**Files:** Modify `app/ride/[workoutId]/page.tsx` (read it first; add the chip in the ride header area), Modify `app/dashboard/page.tsx`; Create `components/gear/RideBikeChip.tsx`, `components/gear/GearDueBanner.tsx`; tests `__tests__/components/gear-due-banner.test.tsx`.

- [ ] `RideBikeChip`: shows "Bike: {name}" (or "No bike"), tapping opens a bottom-sheet list of non-retired bikes (≥ 44px rows) + "Reset to default" → `PATCH /api/workouts/[id]/bike`. Hidden if the user has no bikes. The page fetches `GET /api/gear` for the bike list.
- [ ] `GearDueBanner`: given `GET /api/gear` data, lists triggers whose `progress.status` is `due_soon` or `overdue` ("Chain re-wax due — 312 / 300 km", amber/red), each linking to `/settings/gear`; renders nothing when none. Failing test first: renders nothing for all-ok data, renders both statuses with correct text for mixed data. Mount it on the dashboard near the existing banners; fetch must be non-blocking and failures silent.
- [ ] Verify visually at 375px. Commit: `Add ride bike chip and dashboard gear banner`.

---

## Phase 5 — Verification and handoff

### Task 13: Full check

- [ ] `npm run test:ci` (typecheck + Jest) → PASS.
- [ ] `graphify update .`
- [ ] Manual smoke with the app running: create a bike (confirm first bike becomes default), add a chain with both preset triggers, trigger a sync, confirm rides get `bike_id` and usage renders, mark re-wax done, replace the chain and confirm the new chain starts at 0 with copied triggers.
- [ ] Hand the user the migration SQL (contents of `supabase/migrations/20261004_bikes_components.sql`) and remind them to run it against the shared Supabase project **before** deploying; ends with `notify pgrst, 'reload schema';`.
- [ ] Commit any leftovers; push to `claude/determined-johnson-6e3650`. Do not open a PR unless asked.
