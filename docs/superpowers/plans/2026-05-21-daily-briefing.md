# Daily Briefing & Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily habit loop — morning push notification → Today card on dashboard showing workout, training load, readiness, and an AI coach note.

**Architecture:** A `TodayCard` component sits at the top of the dashboard, receiving today's workout and wellness data as props and fetching its own coach note from `GET /api/briefing/today`. A `NotificationBanner` handles opt-in. A Vercel Cron job fires every 15 minutes, generates briefings for due users, and sends Web Push notifications via the `web-push` library with VAPID authentication. A custom service worker file (`worker/index.js`) handles `push` and `notificationclick` events and is injected into the next-pwa generated service worker via the `customWorkerSrc` config option.

**Tech Stack:** `web-push` npm package, VAPID keys, Vercel Cron, `@ducanh2912/next-pwa` customWorkerSrc, Supabase service-role client (cron only), Anthropic Claude (existing `lib/claude/client.ts` pattern)

---

## Codebase Context (read before starting)

- API routes: auth via `createSupabaseServerClient()` → `supabase.auth.getUser()` → 401 if no user
- Profile PATCH (`app/api/profile/route.ts`) accepts arbitrary fields — no changes needed to save new profile columns
- `IntervalsClient` already has `getWellness(start, end)` at `lib/intervals/client.ts:128`
- Claude calls use `anthropic` and `MODEL` from `lib/claude/client.ts`; use `anthropic.messages.create()` (non-streaming) for short outputs
- Settings page: `app/settings/page.tsx` — dual state pattern (value + savedValue), `isDirty` guard on save button
- `user_profile` table has `id` (numeric PK) and `user_id` (auth UUID FK). Use `user_id` for cross-table joins.
- PWA config: `next.config.ts` uses `@ducanh2912/next-pwa`; `customWorkerSrc: 'worker'` tells it to compile `worker/index.js` and inject into generated sw

---

## File Map

**Create:**
- `worker/index.js` — service worker push + notificationclick handlers
- `lib/push.ts` — sendPush wrapper around web-push
- `lib/claude/briefing.ts` — generateBriefing Claude call
- `app/api/briefing/today/route.ts` — GET fetch-or-generate briefing
- `app/api/notifications/subscribe/route.ts` — POST save / DELETE remove subscription
- `app/api/cron/daily-briefing/route.ts` — cron handler
- `vercel.json` — cron schedule
- `components/TodayCard.tsx` — Today view UI
- `components/NotificationBanner.tsx` — opt-in banner

**Modify:**
- `next.config.ts` — add `customWorkerSrc: 'worker'`
- `types/index.ts` — add BriefingContext, DailyBriefing, extend UserProfile
- `app/dashboard/page.tsx` — mount TodayCard + NotificationBanner
- `app/settings/page.tsx` — notification preferences section

---

## Task 1: Database Migrations

**Files:** Supabase SQL editor (no local files changed)

- [ ] **Step 1: Run migrations in Supabase SQL editor**

```sql
-- New table: push subscriptions (one row per device)
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
create unique index if not exists push_subscriptions_endpoint_idx on push_subscriptions (endpoint);

-- New table: daily briefings cache (one row per user per day)
create table if not exists daily_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date date not null,
  coach_note text not null,
  notification_sent_at timestamptz,
  generated_at timestamptz default now(),
  unique (user_id, date)
);
create index if not exists daily_briefings_user_date_idx on daily_briefings (user_id, date);

-- New columns on user_profile
alter table user_profile add column if not exists notifications_enabled boolean default false;
alter table user_profile add column if not exists notification_time text default '07:00';
alter table user_profile add column if not exists timezone text default 'Europe/London';
```

- [ ] **Step 2: Verify in Supabase Table Editor that all three changes appear**

- [ ] **Step 3: Commit (nothing to commit locally — note this in PR description)**

---

## Task 2: Install web-push, Generate VAPID Keys, Set Env Vars

**Files:** `package.json`, `.env.local`

- [ ] **Step 1: Install web-push and its types**

```bash
npm install web-push
npm install --save-dev @types/web-push
```

- [ ] **Step 2: Generate VAPID key pair**

```bash
npx web-push generate-vapid-keys
```

Expected output (example — yours will differ):
```
Public Key:
BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U

Private Key:
UUxI4O8-FbRouAevSmBQ6co_1hc1rG26Jn4fKT_9FI4
```

- [ ] **Step 3: Add to `.env.local`**

```
VAPID_PUBLIC_KEY=<your public key from above>
VAPID_PRIVATE_KEY=<your private key from above>
VAPID_SUBJECT=mailto:chrisgplatt@googlemail.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<same as VAPID_PUBLIC_KEY — this one is safe to expose>
CRON_SECRET=<generate any long random string, e.g. openssl rand -hex 32>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard → Project Settings → API → service_role key>
```

- [ ] **Step 4: Commit package changes**

```bash
git add package.json package-lock.json
git commit -m "feat: install web-push for push notifications"
```

---

## Task 3: Extend Types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add new interfaces at the end of `types/index.ts`**

```ts
// Daily briefing
export interface BriefingContext {
  todayWorkout: Workout | null
  ctl: number | null
  atl: number | null
  tsb: number | null
  readinessLabel: 'Ready' | 'Moderate' | 'Fatigued' | 'Unknown'
  hrv: number | null
  recentWorkouts: Array<{
    date: string
    type: string
    avg_power: number | null
    tss: number | null
  }>
  upcomingEvents: TrainingEvent[]
}

export interface DailyBriefing {
  id: string
  user_id: string
  date: string
  coach_note: string
  notification_sent_at: string | null
  generated_at: string
}

export interface PushSubscriptionRecord {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}
```

- [ ] **Step 2: Extend the UserProfile interface with the three new optional fields**

Find the `UserProfile` interface and add after `updated_at?`:

```ts
  notifications_enabled?: boolean
  notification_time?: string       // HH:MM 24h, e.g. "07:00"
  timezone?: string                // IANA tz, e.g. "Europe/London"
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: same two pre-existing test errors only (steps missing in test fixtures, email-allowlist). No new errors.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat: add briefing, push subscription, and readiness types"
```

---

## Task 4: lib/push.ts

**Files:**
- Create: `lib/push.ts`

- [ ] **Step 1: Create `lib/push.ts`**

```ts
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export interface PushPayload {
  title: string
  body: string
  url: string
}

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export async function sendPush(sub: StoredSubscription, payload: PushPayload): Promise<void> {
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload)
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/push.ts
git commit -m "feat: add sendPush VAPID helper"
```

---

## Task 5: lib/claude/briefing.ts

**Files:**
- Create: `lib/claude/briefing.ts`

- [ ] **Step 1: Create `lib/claude/briefing.ts`**

```ts
import { anthropic, MODEL } from './client'
import type { BriefingContext } from '@/types'

const SYSTEM = 'You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app. No markdown, no bullet points, plain text only.'

export async function generateBriefing(ctx: BriefingContext): Promise<string> {
  const workout = ctx.todayWorkout
    ? `${ctx.todayWorkout.type} ${ctx.todayWorkout.duration_minutes}min — ${ctx.todayWorkout.description}`
    : 'Rest day'

  const load = [
    ctx.ctl !== null ? `Fitness (CTL): ${Math.round(ctx.ctl)}` : null,
    ctx.atl !== null ? `Fatigue (ATL): ${Math.round(ctx.atl)}` : null,
    ctx.tsb !== null ? `Form (TSB): ${Math.round(ctx.tsb)}` : null,
    ctx.hrv !== null ? `HRV: ${Math.round(ctx.hrv)} ms` : null,
    `Readiness: ${ctx.readinessLabel}`,
  ].filter(Boolean).join(', ')

  const recent = ctx.recentWorkouts.length
    ? ctx.recentWorkouts
        .map(w => `${w.date} ${w.type} (TSS ${w.tss ?? '?'}, avg power ${w.avg_power ?? '?'}W)`)
        .join('; ')
    : 'none'

  const events = ctx.upcomingEvents.length
    ? ctx.upcomingEvents.map(e => `${e.name} on ${e.date} (${e.type}, priority ${e.priority})`).join('; ')
    : 'none in next 4 weeks'

  const prompt = `Today's session: ${workout}
Training load: ${load}
Recent sessions: ${recent}
Upcoming events: ${events}

Write the morning briefing.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text.trim() : 'Have a great session today.'
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/claude/briefing.ts
git commit -m "feat: add generateBriefing Claude function"
```

---

## Task 6: Custom Service Worker + next.config.ts

**Files:**
- Create: `worker/index.js`
- Modify: `next.config.ts`

- [ ] **Step 1: Create `worker/index.js`**

```js
// Push notification handlers — compiled by next-pwa and injected into sw.js
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'My Cycling Coach', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      data: { url: data.url ?? '/dashboard' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      const url = event.notification.data?.url ?? '/dashboard'
      const existing = list.find(c => c.url.includes('/dashboard'))
      if (existing) return existing.focus()
      return clients.openWindow(url)
    })
  )
})
```

- [ ] **Step 2: Add `customWorkerSrc` to `next.config.ts`**

Find the `withPWAInit({` call and add `customWorkerSrc: 'worker'` as the first property:

```ts
const withPWA = withPWAInit({
  dest: 'public',
  customWorkerSrc: 'worker',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
  fallbacks: {
    document: '/dashboard',
  },
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        urlPattern: /^\/api\//,
        handler: 'NetworkOnly',
      },
    ],
  },
})
```

- [ ] **Step 3: Commit**

```bash
git add worker/index.js next.config.ts
git commit -m "feat: add push/notificationclick handlers to service worker"
```

---

## Task 7: GET /api/briefing/today

**Files:**
- Create: `app/api/briefing/today/route.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p app/api/briefing/today
```

- [ ] **Step 2: Create `app/api/briefing/today/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateBriefing } from '@/lib/claude/briefing'
import { IntervalsClient } from '@/lib/intervals/client'
import type { Workout, TrainingEvent, BriefingContext } from '@/types'

export const dynamic = 'force-dynamic'

function readinessLabel(tsb: number | null): BriefingContext['readinessLabel'] {
  if (tsb === null) return 'Unknown'
  if (tsb > 0) return 'Ready'
  if (tsb >= -30) return 'Moderate'
  return 'Fatigued'
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refresh = new URL(req.url).searchParams.get('refresh') === 'true'
  const today = new Date().toISOString().split('T')[0]

  // Return cached note unless refresh is requested
  if (!refresh) {
    const { data: cached } = await supabase
      .from('daily_briefings')
      .select('coach_note, generated_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()
    if (cached) return NextResponse.json({ coach_note: cached.coach_note, cached: true })
  }

  const [{ data: profile }, { data: workouts }] = await Promise.all([
    supabase.from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key, events')
      .maybeSingle(),
    supabase.from('workouts')
      .select('*')
      .eq('date', today)
      .eq('status', 'planned')
      .order('created_at')
      .limit(1),
  ])

  const todayWorkout = (workouts?.[0] as Workout | undefined) ?? null

  const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
  const upcomingEvents = ((profile?.events ?? []) as TrainingEvent[]).filter(
    e => e.date >= today && e.date <= fourWeeks
  )

  let ctl: number | null = null
  let atl: number | null = null
  let tsb: number | null = null
  let hrv: number | null = null
  let recentWorkouts: BriefingContext['recentWorkouts'] = []

  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
      const [wellness, activities] = await Promise.all([
        client.getWellness(sevenDaysAgo, today),
        client.getActivities(sevenDaysAgo, today),
      ])
      const latest = wellness.at(-1)
      ctl = latest?.ctl ?? null
      atl = latest?.atl ?? null
      tsb = latest?.form ?? (ctl !== null && atl !== null ? ctl - atl : null)
      hrv = latest?.hrv ?? null
      recentWorkouts = activities
        .filter(a => /ride/i.test(a.type))
        .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
        .slice(0, 2)
        .map(a => ({
          date: a.start_date_local.split('T')[0],
          type: a.type,
          avg_power: a.average_watts,
          tss: a.training_load,
        }))
    } catch { /* ICU unavailable — briefing proceeds without metrics */ }
  }

  const ctx: BriefingContext = {
    todayWorkout,
    ctl,
    atl,
    tsb,
    readinessLabel: readinessLabel(tsb),
    hrv,
    recentWorkouts,
    upcomingEvents,
  }

  const coach_note = await generateBriefing(ctx)

  await supabase
    .from('daily_briefings')
    .upsert(
      { user_id: user.id, date: today, coach_note, generated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )

  return NextResponse.json({ coach_note, cached: false, ctl, atl, tsb, hrv, readiness_label: readinessLabel(tsb) })
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Smoke test**

Start the dev server (`npm run dev`), then in a browser console while logged in:

```js
fetch('/api/briefing/today').then(r => r.json()).then(console.log)
```

Expected: `{ coach_note: "...", cached: false, ctl: ..., ... }`

Second call: `{ coach_note: "...", cached: true }`

- [ ] **Step 5: Commit**

```bash
git add app/api/briefing/today/route.ts
git commit -m "feat: add GET /api/briefing/today fetch-or-generate route"
```

---

## Task 8: POST/DELETE /api/notifications/subscribe

**Files:**
- Create: `app/api/notifications/subscribe/route.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p app/api/notifications/subscribe
```

- [ ] **Step 2: Create `app/api/notifications/subscribe/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint, p256dh, auth } = await req.json()
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing subscription fields' }, { status: 400 })
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark notifications as enabled in profile
  const { data: row } = await supabase.from('user_profile').select('id').maybeSingle()
  if (row) await supabase.from('user_profile').update({ notifications_enabled: true }).eq('id', row.id)

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json()
  if (endpoint) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id)
  }

  // Disable if no subscriptions remain
  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (count === 0) {
    const { data: row } = await supabase.from('user_profile').select('id').maybeSingle()
    if (row) await supabase.from('user_profile').update({ notifications_enabled: false }).eq('id', row.id)
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/api/notifications/subscribe/route.ts
git commit -m "feat: add subscribe/unsubscribe push notification endpoints"
```

---

## Task 9: Cron Handler + vercel.json

**Files:**
- Create: `app/api/cron/daily-briefing/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p app/api/cron/daily-briefing
```

- [ ] **Step 2: Create `app/api/cron/daily-briefing/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateBriefing } from '@/lib/claude/briefing'
import { sendPush } from '@/lib/push'
import { IntervalsClient } from '@/lib/intervals/client'
import type { Workout, TrainingEvent, BriefingContext } from '@/types'

export const dynamic = 'force-dynamic'

function readinessLabel(tsb: number | null): BriefingContext['readinessLabel'] {
  if (tsb === null) return 'Unknown'
  if (tsb > 0) return 'Ready'
  if (tsb >= -30) return 'Moderate'
  return 'Fatigued'
}

// Returns true if the user's local time (in their timezone) is within the 15-min window
// starting at their notification_time
function isDue(notificationTime: string, timezone: string): boolean {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  const [nh, nm] = notificationTime.split(':').map(Number)
  const userMinutes = h * 60 + m
  const notifMinutes = nh * 60 + nm
  return userMinutes >= notifMinutes && userMinutes < notifMinutes + 15
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service role client bypasses RLS — needed to read all users
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = new Date().toISOString().split('T')[0]
  const nowISO = new Date().toISOString()

  const { data: profiles } = await supabase
    .from('user_profile')
    .select('user_id, intervals_icu_athlete_id, intervals_icu_api_key, events, notification_time, timezone')
    .eq('notifications_enabled', true)

  let sent = 0

  for (const profile of profiles ?? []) {
    if (!profile.notification_time || !profile.user_id) continue

    if (!isDue(profile.notification_time, profile.timezone ?? 'Europe/London')) continue

    // Skip if already notified today
    const { data: existing } = await supabase
      .from('daily_briefings')
      .select('id, coach_note, notification_sent_at')
      .eq('user_id', profile.user_id)
      .eq('date', today)
      .maybeSingle()
    if (existing?.notification_sent_at) continue

    // Gather context for briefing generation
    let ctl: number | null = null
    let atl: number | null = null
    let tsb: number | null = null
    let hrv: number | null = null
    let recentWorkouts: BriefingContext['recentWorkouts'] = []

    const { data: workouts } = await supabase
      .from('workouts')
      .select('*')
      .eq('date', today)
      .eq('status', 'planned')
      .order('created_at')
      .limit(1)
    const todayWorkout = (workouts?.[0] as Workout | undefined) ?? null

    const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
    const upcomingEvents = ((profile.events ?? []) as TrainingEvent[]).filter(
      (e: TrainingEvent) => e.date >= today && e.date <= fourWeeks
    )

    if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
        const [wellness, activities] = await Promise.all([
          client.getWellness(sevenDaysAgo, today),
          client.getActivities(sevenDaysAgo, today),
        ])
        const latest = wellness.at(-1)
        ctl = latest?.ctl ?? null
        atl = latest?.atl ?? null
        tsb = latest?.form ?? (ctl !== null && atl !== null ? ctl - atl : null)
        hrv = latest?.hrv ?? null
        recentWorkouts = activities
          .filter(a => /ride/i.test(a.type))
          .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
          .slice(0, 2)
          .map(a => ({
            date: a.start_date_local.split('T')[0],
            type: a.type,
            avg_power: a.average_watts,
            tss: a.training_load,
          }))
      } catch { /* proceed without ICU data */ }
    }

    const ctx: BriefingContext = {
      todayWorkout,
      ctl, atl, tsb,
      readinessLabel: readinessLabel(tsb),
      hrv,
      recentWorkouts,
      upcomingEvents,
    }

    // Use cached note or generate fresh
    let coach_note = existing?.coach_note ?? null
    if (!coach_note) {
      try {
        coach_note = await generateBriefing(ctx)
      } catch {
        coach_note = todayWorkout
          ? `You have a ${todayWorkout.type} session today — ${todayWorkout.duration_minutes} minutes.`
          : 'Rest day today. Recover well.'
      }
    }

    // Persist briefing (upsert handles both insert and update)
    await supabase
      .from('daily_briefings')
      .upsert(
        { user_id: profile.user_id, date: today, coach_note, notification_sent_at: nowISO, generated_at: nowISO },
        { onConflict: 'user_id,date' }
      )

    // Send to all subscriptions
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', profile.user_id)

    const firstSentence = coach_note.split(/[.!?]/)[0].trim().slice(0, 100)
    const body = todayWorkout
      ? `${firstSentence} · ${todayWorkout.type} today`
      : `${firstSentence} · Rest day`

    for (const sub of subs ?? []) {
      try {
        await sendPush(sub, { title: 'My Cycling Coach', body, url: '/dashboard' })
        sent++
      } catch (err: unknown) {
        // 410 = subscription expired/revoked — clean it up
        if ((err as { statusCode?: number }).statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent })
}
```

- [ ] **Step 3: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-briefing",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Smoke test (manual cron trigger)**

With the dev server running and `CRON_SECRET` set in `.env.local`:

```bash
curl -X POST http://localhost:3000/api/cron/daily-briefing \
  -H "Authorization: Bearer <your CRON_SECRET>"
```

Expected: `{ "ok": true, "sent": 0 }` (0 because no push subscriptions yet and notification_time likely not in current window)

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/daily-briefing/route.ts vercel.json
git commit -m "feat: add cron handler and vercel.json schedule"
```

---

## Task 10: TodayCard Component

**Files:**
- Create: `components/TodayCard.tsx`

- [ ] **Step 1: Create `components/TodayCard.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import WorkoutCard from '@/components/WorkoutCard'
import type { Workout, ICUWellness } from '@/types'

interface Props {
  workout: Workout | null
  wellness: ICUWellness | null
  onWorkoutClick?: (workout: Workout) => void
}

function readinessLabel(tsb: number | null): { label: string; colour: string } {
  if (tsb === null) return { label: '—', colour: 'text-slate-400' }
  if (tsb > 0) return { label: 'Ready', colour: 'text-emerald-600' }
  if (tsb >= -30) return { label: 'Moderate', colour: 'text-amber-500' }
  return { label: 'Fatigued', colour: 'text-red-500' }
}

function tsbColour(tsb: number | null): string {
  if (tsb === null) return 'text-slate-400'
  if (tsb > 0) return 'text-emerald-600'
  if (tsb >= -30) return 'text-amber-500'
  return 'text-red-500'
}

export default function TodayCard({ workout, wellness, onWorkoutClick }: Props) {
  const [coachNote, setCoachNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchNote(refresh = false) {
    try {
      const url = refresh ? '/api/briefing/today?refresh=true' : '/api/briefing/today'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setCoachNote(data.coach_note)
      }
    } catch { /* silent */ } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchNote() }, [])

  async function handleRefresh() {
    setRefreshing(true)
    await fetchNote(true)
  }

  const tsb = wellness?.form ?? (
    wellness?.ctl !== null && wellness?.atl !== null && wellness?.ctl !== undefined && wellness?.atl !== undefined
      ? wellness.ctl - wellness.atl
      : null
  )
  const readiness = readinessLabel(tsb)

  const today = new Date()
  const dateLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const dayType = workout ? workout.type.charAt(0).toUpperCase() + workout.type.slice(1) + ' day' : 'Rest day'

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Today</p>
        <p className="text-sm font-medium text-slate-700 mt-0.5">{dateLabel} · {dayType}</p>
      </div>

      {/* Today's workout */}
      {workout ? (
        <WorkoutCard workout={workout} onClick={() => onWorkoutClick?.(workout)} />
      ) : (
        <div className="bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
          <p className="text-sm text-slate-500">No session planned — rest and recover.</p>
        </div>
      )}

      {/* Training state strip */}
      <div className="flex items-center gap-6 text-sm border-t border-slate-100 pt-3">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Readiness</p>
          <p className={`font-semibold ${readiness.colour}`}>{readiness.label}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Form (TSB)</p>
          <p className={`font-semibold ${tsbColour(tsb)}`}>
            {tsb !== null ? (tsb > 0 ? `+${Math.round(tsb)}` : Math.round(tsb).toString()) : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Fitness (CTL)</p>
          <p className="font-semibold text-slate-700">
            {wellness?.ctl !== null && wellness?.ctl !== undefined ? Math.round(wellness.ctl) : '—'}
          </p>
        </div>
        {wellness?.hrv !== null && wellness?.hrv !== undefined && (
          <div>
            <p className="text-xs text-slate-400 mb-0.5">HRV</p>
            <p className="font-semibold text-slate-700">{Math.round(wellness.hrv)} ms</p>
          </div>
        )}
      </div>

      {/* Coach note */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        {loading ? (
          <p className="text-sm text-slate-400">Getting your briefing…</p>
        ) : coachNote ? (
          <p className="text-sm text-slate-600 leading-relaxed font-light">{coachNote}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">Coach note unavailable.</p>
        )}
        {!loading && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh note'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/TodayCard.tsx
git commit -m "feat: add TodayCard component with workout, training state, and coach note"
```

---

## Task 11: NotificationBanner Component

**Files:**
- Create: `components/NotificationBanner.tsx`

- [ ] **Step 1: Create `components/NotificationBanner.tsx`**

```tsx
'use client'
import { useState } from 'react'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

interface Props {
  onEnabled: () => void
}

export default function NotificationBanner({ onEnabled }: Props) {
  const [state, setState] = useState<'idle' | 'requesting' | 'denied' | 'done'>('idle')

  async function enable() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setState('denied')
      return
    }
    setState('requesting')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setState('denied')
      return
    }
    try {
      const registration = await navigator.serviceWorker.ready
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) throw new Error('VAPID key not configured')

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })

      const json = subscription.toJSON()
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        }),
      })
      setState('done')
      onEnabled()
    } catch {
      setState('denied')
    }
  }

  if (state === 'done') return null

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
      <p className="text-sm text-blue-700">
        {state === 'denied'
          ? 'Notifications blocked — enable them in your browser settings.'
          : 'Get your daily training briefing each morning.'}
      </p>
      {state !== 'denied' && (
        <button
          onClick={enable}
          disabled={state === 'requesting'}
          className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors"
        >
          {state === 'requesting' ? 'Enabling…' : 'Enable notifications →'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/NotificationBanner.tsx
git commit -m "feat: add NotificationBanner opt-in component"
```

---

## Task 12: Wire TodayCard and NotificationBanner into Dashboard

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Add imports at top of `app/dashboard/page.tsx`**

Add after the existing imports:

```ts
import TodayCard from '@/components/TodayCard'
import NotificationBanner from '@/components/NotificationBanner'
```

- [ ] **Step 2: Add `notificationsEnabled` state**

Add alongside the other `useState` declarations (around line 89):

```ts
const [notificationsEnabled, setNotificationsEnabled] = useState(false)
```

- [ ] **Step 3: Load notifications_enabled from profile**

The dashboard already calls `fetch('/api/plan')` and fetches sync data. Add a one-time profile fetch in the existing `useEffect` that runs on mount (look for where `firstName` and `athleteId` are loaded from the profile). Add after the existing profile fetch code:

```ts
// Inside the useEffect that fetches profile data, after setting firstName/athleteId:
setNotificationsEnabled(data?.notifications_enabled ?? false)
```

If there's no profile fetch in the dashboard's main useEffect, add one:

```ts
fetch('/api/profile')
  .then(r => r.json())
  .then(data => {
    setNotificationsEnabled(data?.notifications_enabled ?? false)
  })
  .catch(() => {})
```

- [ ] **Step 4: Compute today's workout and latest wellness for TodayCard**

Add these computed values just before the return statement:

```ts
const todayStr = new Date().toISOString().split('T')[0]
const todayWorkout = workouts.find(w => w.date === todayStr && w.status === 'planned') ?? null
const latestWellness = syncData?.wellness?.at(-1) ?? null
```

- [ ] **Step 5: Mount TodayCard and NotificationBanner in the JSX**

Find the opening of the page's return JSX (the outermost `<div>` or similar). Add TodayCard and NotificationBanner **before** the existing content (weekly grid, MetricsBar, etc.):

```tsx
{/* Daily briefing */}
<div className="space-y-3 mb-6">
  {!notificationsEnabled && (
    <NotificationBanner onEnabled={() => setNotificationsEnabled(true)} />
  )}
  <TodayCard
    workout={todayWorkout}
    wellness={latestWellness}
    onWorkoutClick={w => setSelectedWorkout(w)}
  />
</div>
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Visual check**

Run `npm run dev`, open the dashboard. Confirm:
- NotificationBanner appears (if not already enabled)
- TodayCard shows with today's workout (or "Rest day")
- Training state strip shows — for all fields if no wellness sync has run
- "Getting your briefing…" loading state appears, then coach note populates

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: mount TodayCard and NotificationBanner on dashboard"
```

---

## Task 13: Notification Preferences in Settings

**Files:**
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Add notification state variables to `app/settings/page.tsx`**

Following the existing dual-state pattern (value + savedValue), add alongside the other state declarations:

```ts
const [notifTime, setNotifTime] = useState('07:00')
const [timezone, setTimezone] = useState('Europe/London')
const [savedNotifTime, setSavedNotifTime] = useState('07:00')
const [savedTimezone, setSavedTimezone] = useState('Europe/London')
```

- [ ] **Step 2: Populate from profile in the existing `useEffect`**

Inside the `.then(data => { ... })` block of the profile fetch, add:

```ts
const time = data.notification_time ?? '07:00'
const tz = data.timezone ?? 'Europe/London'
setNotifTime(time); setSavedNotifTime(time)
setTimezone(tz); setSavedTimezone(tz)
```

- [ ] **Step 3: Include new fields in `isDirty` and `save()`**

Update `isDirty`:

```ts
const isDirty = fullName !== savedFullName || athleteId !== savedAthleteId || apiKey !== savedApiKey
  || notifTime !== savedNotifTime || timezone !== savedTimezone
```

Update the `body` in `save()` to include the new fields:

```ts
const body = profileId
  ? { id: profileId, full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone }
  : { full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone }
```

After successful save, sync the saved values:

```ts
setSavedNotifTime(notifTime)
setSavedTimezone(timezone)
```

- [ ] **Step 4: Add Notifications section to the JSX**

Add a new `<section>` before the save button:

```tsx
<section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
  <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Daily Briefing</h2>
  <div className="space-y-3">
    <div>
      <label className={labelClass}>Notification time</label>
      <input
        type="time"
        value={notifTime}
        onChange={e => setNotifTime(e.target.value)}
        className={inputClass}
      />
    </div>
    <div>
      <label className={labelClass}>Timezone</label>
      <select
        value={timezone}
        onChange={e => setTimezone(e.target.value)}
        className={inputClass}
      >
        <option value="Europe/London">London (GMT/BST)</option>
        <option value="Europe/Paris">Paris / Amsterdam (CET)</option>
        <option value="Europe/Madrid">Madrid / Rome (CET)</option>
        <option value="Europe/Berlin">Berlin / Zurich (CET)</option>
        <option value="America/New_York">New York (ET)</option>
        <option value="America/Chicago">Chicago (CT)</option>
        <option value="America/Denver">Denver (MT)</option>
        <option value="America/Los_Angeles">Los Angeles (PT)</option>
        <option value="Australia/Sydney">Sydney (AEST)</option>
      </select>
    </div>
  </div>
  <p className="text-xs text-slate-400">Enable notifications on the dashboard to receive your daily briefing at this time.</p>
</section>
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Visual check**

Open Settings. Confirm new "Daily Briefing" section appears with time input and timezone dropdown. Change the time, save, reload — verify the value persists.

- [ ] **Step 7: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: add notification time and timezone settings"
```

---

## Verification Checklist

Run through these after all tasks are complete:

- [ ] `GET /api/briefing/today` returns a coach note (browser console fetch while logged in)
- [ ] Second call returns `cached: true`
- [ ] `?refresh=true` generates a fresh note and updates the cache
- [ ] Dashboard shows TodayCard with workout, training state strip, coach note
- [ ] Training state strip shows `—` gracefully when wellness sync hasn't run
- [ ] NotificationBanner appears on dashboard; clicking it triggers browser permission prompt
- [ ] After granting permission, banner disappears; `push_subscriptions` row appears in Supabase
- [ ] Manually trigger cron: `curl -X POST https://<your-vercel-url>/api/cron/daily-briefing -H "Authorization: Bearer <CRON_SECRET>"` — returns `{ sent: N }`
- [ ] Push notification arrives on device; tapping opens dashboard
- [ ] Settings page shows notification time input and timezone select
- [ ] Changing notification time in settings persists after page reload
- [ ] Revoking browser notification permission and triggering cron → stale subscription deleted from Supabase (check table)
