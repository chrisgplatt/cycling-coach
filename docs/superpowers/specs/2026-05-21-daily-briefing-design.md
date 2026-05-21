# Daily Briefing & Push Notifications — Design Spec

**Date:** 2026-05-21
**Goal:** Create a daily habit loop — a morning push notification pulls the user into the app where they see a Today view combining training load, readiness signals, and a short AI coach note.

---

## Overview

Three components connect into a single loop:

1. **Today view** — a section at the top of the dashboard showing today's workout, training load (CTL/ATL/TSB), readiness (HRV/sleep), and 2–3 sentences of AI coach commentary
2. **Push notification** — fires at a user-configured time (default 07:00), body is the first line of the coach note + today's workout type
3. **Vercel Cron job** — runs every 15 minutes, generates briefings and sends pushes for users whose notification time falls in the current window

---

## Today View

### Placement
Top of the dashboard, above the existing weekly workout grid.

### Contents (top to bottom)

**Header line**
Date and a one-line summary of the day type: "Thursday, 22 May · Threshold day" or "Thursday, 22 May · Rest day"

**Today's workout**
The existing WorkoutCard component for today's planned workout. If no workout is planned, a neutral "Rest day" placeholder. If multiple workouts exist for today, show the first.

**Training state strip**
Three values shown inline with colour coding:

| Field | Source | Colour logic |
|-------|--------|--------------|
| Readiness | ICU wellness `readiness_score` or derived from HRV + sleep | Green ≥ 70, Amber 40–69, Red < 40 |
| Form (TSB) | CTL − ATL from ICU wellness | Green > 0, Amber −30 to 0, Red < −30 |
| Fitness (CTL) | ICU wellness | No colour — informational |

If wellness data is missing (sync hasn't run), all three show "—" rather than hiding the row.

**Coach note**
2–3 sentences in a slightly lighter font weight. Personalised to the actual data. Examples:

> "HRV is down 8% on your baseline — today's recovery ride is well-timed, resist the urge to push harder. Form at −18 is healthy for this point in the build block. Keep the watts below 75% and let the legs come back."

> "Readiness looks good this morning and form is neutral at −4. Today's 4×8min threshold efforts are the key session of the week — aim for 92–95% FTP and don't fight the last rep if power drops."

**Refresh button**
Small, subtle link below the note. Re-runs Claude and overwrites the cached note for today. Useful after a manual wellness update or if the morning sync hadn't completed when the briefing was first generated.

### API route
`GET /api/briefing/today`
- Checks `daily_briefings` for a row where `user_id = current user` and `date = today`
- If found: returns cached `coach_note` plus the training state data
- If not found: fetches context, calls Claude, writes to `daily_briefings`, returns result
- Refresh: same route with `?refresh=true` query param, bypasses cache

---

## Coach Note Generation

### File
`lib/claude/briefing.ts` — `generateBriefing(context: BriefingContext): Promise<string>`

### Context passed to Claude

```ts
interface BriefingContext {
  todayWorkout: Workout | null         // today's planned workout
  ctl: number | null                   // chronic training load
  atl: number | null                   // acute training load
  tsb: number | null                   // form (CTL − ATL)
  readinessScore: number | null        // ICU readiness (0–100)
  hrvScore: number | null              // morning HRV
  sleepScore: number | null            // sleep quality score
  recentWorkouts: RecentWorkout[]      // last 2 completed: date, type, avg_power, tss
  upcomingEvents: TrainingEvent[]      // races/events in next 4 weeks
}
```

### Prompt approach
System prompt: "You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app."

User message: structured summary of the context above.

### Output
Plain string (no markdown, no JSON). Stored in `daily_briefings.coach_note`.

### Caching
One row per user per date. `generated_at` timestamp recorded. Only re-generated on explicit refresh or if the row doesn't exist.

---

## Push Notifications

### VAPID setup
Generate once with `npx web-push generate-vapid-keys`. Store as:
- `VAPID_PUBLIC_KEY` — safe to expose to the browser
- `VAPID_PRIVATE_KEY` — server-side only
- `VAPID_SUBJECT` — `mailto:chrisgplatt@googlemail.com`

### Opt-in flow
1. Dashboard shows a banner if `notifications_enabled = false` on the user's profile: "Get your daily briefing at 7am → Enable notifications"
2. User taps → browser permission prompt
3. If granted: browser returns a `PushSubscription` object → `POST /api/notifications/subscribe` saves it to `push_subscriptions`
4. Banner is dismissed permanently

Each device (iPhone PWA, desktop browser) creates its own subscription row. Both receive notifications independently.

### Notification content
```
Title: My Cycling Coach
Body:  <first sentence of coach note, truncated to 100 chars if needed> · <workout type> today
Icon:  /icon-192.png
Data:  { url: '/dashboard' }
```

### Service worker
`public/custom-worker.js` — merged into the next-pwa generated service worker via `customWorkerSrc` config option.

Two event handlers:

**`push`**
```js
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'My Cycling Coach', {
      body: data.body,
      icon: '/icon-192.png',
      data: { url: data.url ?? '/dashboard' },
    })
  )
})
```

**`notificationclick`**
```js
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

### Stale subscription cleanup
When `web-push` receives a 410 Gone response (subscription revoked or device unregistered), the cron handler deletes that row from `push_subscriptions`. No manual cleanup needed.

---

## Cron Job

### Schedule
Vercel Cron: `*/15 * * * *` (every 15 minutes, 24/7)

### Route
`POST /api/cron/daily-briefing`

Protected by `Authorization: Bearer $CRON_SECRET` header (Vercel sets this automatically for cron routes; verify it server-side).

### Logic

```
1. Get current UTC time, compute local time for each user based on their timezone
   (stored as user_profile.timezone — new column, default 'Europe/London')
2. Find users where:
   - notifications_enabled = true
   - notification_time falls within [now, now + 15 minutes]
   - daily_briefings row for today does NOT have notification_sent_at set
3. For each user:
   a. Fetch today's workout, ICU wellness, recent workouts, upcoming events
   b. Fetch or generate daily_briefings row (generateBriefing if not cached)
   c. Load all push_subscriptions rows for this user
   d. For each subscription: sendPush(subscription, { title, body, url })
      - On 410 response: delete the subscription row
   e. Update daily_briefings.notification_sent_at = now()
4. Return { sent: N } for Vercel logs
```

### Timezone handling
`user_profile` gets a `timezone text` column (default `'Europe/London'`). The cron compares the user's local time (derived from UTC + timezone offset) against their `notification_time`. Uses the `Intl` API — no extra library needed.

---

## Profile Settings Changes

Add to the existing profile settings page:

- **Notification time** — time picker or text input (HH:MM, 24h). Default `07:00`
- **Enable notifications toggle** — calls subscribe/unsubscribe API on change
- **Timezone** — select from a short list of common European/US timezones. Default `Europe/London`

---

## Database Changes

### New table: `push_subscriptions`
```sql
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
create index on push_subscriptions (user_id);
```

### New table: `daily_briefings`
```sql
create table daily_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date date not null,
  coach_note text not null,
  notification_sent_at timestamptz,
  generated_at timestamptz default now(),
  unique (user_id, date)
);
create index on daily_briefings (user_id, date);
```

### New columns on `user_profile`
```sql
alter table user_profile add column if not exists notifications_enabled boolean default false;
alter table user_profile add column if not exists notification_time text default '07:00';
alter table user_profile add column if not exists timezone text default 'Europe/London';
```

---

## New Files Summary

| File | Purpose |
|------|---------|
| `lib/push.ts` | `sendPush(sub, payload)` wrapper around `web-push` |
| `lib/claude/briefing.ts` | `generateBriefing(context)` → coach note string |
| `app/api/briefing/today/route.ts` | GET — fetch or generate today's briefing |
| `app/api/notifications/subscribe/route.ts` | POST save subscription / DELETE remove |
| `app/api/cron/daily-briefing/route.ts` | Cron handler — generate + send pushes |
| `public/custom-worker.js` | push + notificationclick service worker handlers |
| `components/TodayCard.tsx` | Today view: workout + training state + coach note |
| `components/NotificationBanner.tsx` | Opt-in banner shown on dashboard |

### Modified files
| File | Change |
|------|--------|
| `app/dashboard/page.tsx` | Add TodayCard at top, add NotificationBanner |
| `app/profile/page.tsx` | Add notification time, timezone, enable toggle |
| `next.config.ts` | Add `customWorkerSrc` pointing to custom-worker.js |
| `types/index.ts` | Add `BriefingContext`, extend `UserProfile` |

---

## Verification

1. Generate VAPID keys, add to `.env.local`, confirm `GET /api/briefing/today` returns a coach note
2. Open dashboard — Today card appears with workout, training state strip, coach note
3. Click "Enable notifications" — browser permission prompt appears, subscription saved to Supabase
4. Manually POST to `/api/cron/daily-briefing` with the cron secret — notification arrives on device
5. Tap notification — app opens to dashboard, Today card visible
6. Update notification time in profile, verify cron respects the new time
7. On a second device (desktop), grant permission — both devices receive the notification
8. Revoke browser notification permission — next cron run deletes the stale subscription (check logs)
9. Readiness data absent (no wellness sync) — training state strip shows "—" gracefully
