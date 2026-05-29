# Unavailability Periods Design

## Goal

Allow athletes to mark date ranges as unavailable (sick, injury, holiday, or general unavailability) so the training coach can plan and adapt around them. Periods optionally trigger a plan adaptation and optionally sync to intervals.icu.

## Architecture

A new `unavailability` JSONB array on `user_profile` (same pattern as `events`). Three new API routes handle create/update/delete. A new `AddUnavailabilityModal` component covers both create and edit. The calendar week view renders spanning banners over affected days. The Events tab on the Plan page gains a second "Unavailability Periods" section below the existing events list.

**Tech Stack:** Next.js App Router, Supabase JSONB, intervals.icu Events API, existing `IntervalsClient`, Tailwind CSS.

---

## Data Model

### New types (`types/index.ts`)

```ts
export type UnavailabilityType = 'sick' | 'injury' | 'holiday' | 'unavailable'

export interface UnavailabilityPeriod {
  id: string             // uuid — generated on creation
  type: UnavailabilityType
  start_date: string     // YYYY-MM-DD
  end_date: string       // YYYY-MM-DD (inclusive)
  notes?: string         // free-text, optional
  impact_plan: boolean   // true → triggers plan adaptation; false → informational only
  icu_event_id?: string  // set after ICU sync; used for update/delete
}
```

### `UserProfile` interface (`types/index.ts`)

Add: `unavailability?: UnavailabilityPeriod[]`

### Supabase migration

```sql
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS unavailability JSONB NOT NULL DEFAULT '[]';
```

---

## API Routes

### `POST /api/unavailability/create`

Request body:
```ts
{ type, start_date, end_date, notes?, impact_plan }
```

Steps:
1. Auth check.
2. Generate `id` with `crypto.randomUUID()`.
3. Load `user_profile` (select `id`, `intervals_icu_*`, `unavailability`, `events`).
4. Attempt ICU sync (see ICU Sync section). Capture `icu_event_id` if successful; capture `icu_error` if not.
5. Append new `UnavailabilityPeriod` to `unavailability` array and `UPDATE user_profile`.
6. Return `{ period, synced_to_icu: boolean, icu_error? }`.

Frontend: if `impact_plan: true`, show the plan adaptation banner (same flow as event add/edit — opens plan chat with a pre-populated note about the period).

### `PUT /api/unavailability/update`

Request body:
```ts
{ id, type, start_date, end_date, notes?, impact_plan }
```

Steps:
1. Auth check.
2. Load profile; find period by `id`.
3. If `icu_event_id` exists: call `client.updateUnavailabilityEvent(icu_event_id, ...)`.
4. Replace period in array; `UPDATE user_profile`.
5. Return `{ period, synced_to_icu, icu_error? }`.

Frontend: if `impact_plan` is now `true` (regardless of previous value), show plan adaptation banner.

### `DELETE /api/unavailability/delete`

Request body: `{ id }`

Steps:
1. Auth check.
2. Load profile; find period by `id`.
3. If `icu_event_id` exists: call `client.deleteEvent(icu_event_id)`.
4. Filter period out of array; `UPDATE user_profile`.
5. Return `{ ok: true }`.

---

## ICU Sync

### Category mapping

| `type`        | ICU category | Notes                                     |
|---------------|--------------|-------------------------------------------|
| `sick`        | `SICK`       | Single multi-day ICU event                |
| `injury`      | `INJURY`     | Single multi-day ICU event                |
| `holiday`     | `HOLIDAY`    | Already used by the events system         |
| `unavailable` | `NOTE`       | Name used as label (e.g. "Unavailable")   |

### New `IntervalsClient` method: `createUnavailabilityEvent`

```ts
async createUnavailabilityEvent(params: {
  type: UnavailabilityType
  start_date: string
  end_date: string
  notes?: string
}): Promise<string>  // returns ICU event id
```

Body sent to ICU:
```json
{
  "category": "<SICK|INJURY|HOLIDAY|NOTE>",
  "start_date_local": "<start_date>T00:00:00",
  "end_date_local": "<end_date>T23:59:59",
  "name": "<type label e.g. Sick / Injury / Holiday / Unavailable>",
  "description": "<notes if present>"
}
```

If ICU returns 422 for `end_date_local` (field not supported), fall back to creating one event per day in the range using `start_date_local` only.

### `updateUnavailabilityEvent`

Calls `PUT /athlete/:id/events/:eventId` with the same body structure.

---

## UI Components

### `AddUnavailabilityModal.tsx` (new)

Props: `{ period?: UnavailabilityPeriod; onClose: () => void; defaultStartDate?: string }`

When `period` is provided: edit mode. When absent: create mode with `defaultStartDate` pre-filled.

Fields:
- **Type** — 4-button pill selector: 🤒 Sick · 🤕 Injury · 🏖️ Holiday · 🚫 Unavailable
- **Start date** — date input (required)
- **End date** — date input (required; must be ≥ start date)
- **Notes** — textarea (optional; placeholder: "e.g. knee flare-up, family trip")
- **Impact plan?** — toggle (`true` by default). Label: "Suggest plan adaptations" with sub-text: "Coach will propose changes to workouts in this window."
- Cancel / Save buttons

Validation: end_date ≥ start_date (show inline error if not).

On save: call create or update API. If `impact_plan: true` in the response, close modal and fire the plan adaptation banner (same mechanism used by `addEvent` / `updateEvent` in `app/plan/page.tsx`).

---

### Events Tab — Unavailability section (`app/plan/page.tsx`)

Below the existing events list, a second `<section>` headed **"Unavailability Periods"** with an **"+ Add period"** button.

Each row shows:
```
🤒 Sick                            [Edit] [Delete]
2 Jun – 8 Jun · 7 days
Knee flare-up
● impacts plan
```

Type icon and label on the first line. Date range + duration on the second. Notes (if any) on the third, truncated to one line. An `impacts plan` badge (amber) or `info only` badge (slate) below.

Delete follows the same confirm-then-delete pattern as events (`confirmingPeriod` / `deletingPeriod` state).

---

### Calendar week view — spanning banner (`app/calendar/page.tsx`)

**Data:** Fetch `unavailability` from `/api/user-profile` (or include in the existing profile fetch). Filter to periods that overlap the displayed week.

**Rendering:** Above the day-cell grid, render a banner row using the same 7-column grid. For each overlapping period, calculate `colStart` and `colEnd` within the week (clamped to 1–7), then render:

```tsx
<div
  style={{ gridColumn: `${colStart} / ${colEnd + 1}` }}
  className="rounded px-2 py-1 text-xs font-semibold flex items-center gap-1 ..."
>
  {icon} {label}{notes ? ` · ${notes}` : ''}
</div>
```

Colour by type:
| type          | background       | text         | border-left  |
|---------------|------------------|--------------|--------------|
| `sick`        | `bg-red-100`     | `text-red-700`   | `border-red-400` |
| `injury`      | `bg-orange-100`  | `text-orange-700`| `border-orange-400` |
| `holiday`     | `bg-teal-100`    | `text-teal-700`  | `border-teal-400` |
| `unavailable` | `bg-slate-100`   | `text-slate-600` | `border-slate-400` |

Days covered by a period get a faint tinted background on their cell (`bg-red-50`, `bg-orange-50`, etc.).

Planned workout cards that fall within a period where `impact_plan: true` render with `opacity-50` and a struck-through description.

**Adding from calendar:** Each day-number in the week view becomes a `<button>`. Tapping it opens `AddUnavailabilityModal` with `defaultStartDate` pre-filled to that date. (End date defaults to the same day — user extends as needed.)

---

## Planning Context Integration

### Plan chat (`app/api/chat/plan/route.ts`)

Fetch `unavailability` alongside the plan/profile fetch. Inject into `buildSystemPrompt` as a new section:

```
UNAVAILABILITY PERIODS:
- 2026-06-02 to 2026-06-08 | sick | "knee flare-up" | impacts plan
- 2026-07-15 to 2026-07-22 | holiday | "family trip"  | info only
```

The coach instruction: "Never propose a workout on a date covered by an unavailability period. When adapting around unavailability, note the reason if provided."

### Briefing (`lib/claude/briefing.ts`)

Include any active or upcoming (within 7 days) unavailability period in the briefing prompt so the morning briefing can acknowledge it (e.g. "You're currently in a sick period — no training today.").

---

## Plan Adaptation Flow

When a period is created or updated with `impact_plan: true`, the frontend shows the same amber banner used after event changes:

> "You have a new unavailability period. Want the coach to adapt your plan around it?"

Clicking "Adapt plan" opens `PlanChatModal` with a pre-populated opening message:
> "I've added a [type] period from [start_date] to [end_date][: notes]. Please adapt my training plan around it."

This reuses the existing adaptation infrastructure with no changes to the plan chat API.

---

## Colour Tokens (Tailwind)

| type | bg (banner) | text | bg (day tint) |
|---|---|---|---|
| sick | `bg-red-100` | `text-red-700` | `bg-red-50` |
| injury | `bg-orange-100` | `text-orange-700` | `bg-orange-50` |
| holiday | `bg-teal-100` | `text-teal-700` | `bg-teal-50` |
| unavailable | `bg-slate-100` | `text-slate-600` | `bg-slate-50` |

---

## Files to Create or Modify

| Action | File |
|--------|------|
| Create | `components/AddUnavailabilityModal.tsx` |
| Create | `app/api/unavailability/create/route.ts` |
| Create | `app/api/unavailability/update/route.ts` |
| Create | `app/api/unavailability/delete/route.ts` |
| Modify | `types/index.ts` — add `UnavailabilityType`, `UnavailabilityPeriod`, extend `UserProfile` |
| Modify | `lib/intervals/client.ts` — add `createUnavailabilityEvent`, `updateUnavailabilityEvent` |
| Modify | `app/plan/page.tsx` — unavailability section in events tab |
| Modify | `app/calendar/page.tsx` — banner rendering, day-tap to add, day tinting |
| Modify | `app/api/chat/plan/route.ts` — inject unavailability into system prompt |
| Modify | `lib/claude/briefing.ts` — inject active/upcoming unavailability |
| Supabase | `ALTER TABLE user_profile ADD COLUMN unavailability JSONB DEFAULT '[]'` |
