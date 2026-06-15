# Plan Extension Design

## Goal

Allow athletes to extend their active training plan when an event is rescheduled or they need more time before peaking. Only future sessions are regenerated — completed sessions are untouched. A new kebab menu on the plan card consolidates plan management actions (extend, regenerate, rename, delete).

## Architecture

**Client-side phase preview.** The extension modal computes the updated phase structure instantly using `computeMethodology` — no network round-trip needed for the preview. The same function already used at plan-creation time is reused here with the new total weeks.

**Partial regeneration.** The extend API receives `extra_weeks`, computes the new phase structure, then streams only future sessions (from today onward). Completed sessions are never touched. The AI is given the existing plan context (philosophy, current phase, weeks completed) so the new sessions are coherent continuations, not a fresh start.

**Two entry points, one modal.** The event-moved banner and the kebab "Extend plan" option both open `ExtendPlanModal`. The banner pre-populates the week count (derived from the gap between plan end date and event date). The kebab opens the modal in manual mode with week chips.

## Components and Files

| File | Change |
|------|--------|
| `components/PlanKebabMenu.tsx` | New — kebab menu for plan card (Extend, Regenerate, Rename, Delete) |
| `components/ExtendPlanModal.tsx` | New — extension confirmation modal (event mode + manual mode) |
| `app/plan/page.tsx` | Add kebab menu, event-moved banner, ExtendPlanModal; wire handlers |
| `app/api/plan/extend/route.ts` | New — POST endpoint, streams future sessions |
| `lib/claude/plan.ts` | Export `buildExtendPrompt` helper |
| `types/index.ts` | No changes needed |

## UI: Plan Card Changes

### Kebab menu (⋯)

Appears in the top-right corner of the blue active plan card. Opens a bottom-anchored popover with 4 items:

1. **Extend plan** — opens `ExtendPlanModal` in manual mode
2. **Regenerate plan** — triggers existing full plan regeneration flow
3. **Rename plan** — opens an inline name-edit prompt (simple `window.prompt` is acceptable; a dedicated modal is not needed)
4. **Delete plan** — triggers existing delete confirmation flow

The existing standalone regenerate/delete buttons in `app/plan/page.tsx` are removed and replaced by this menu.

### Event-moved banner

Rendered inside the blue plan card, at the very top, before the "Active Plan" label. Condition:

```
anyEvent.priority === 'A' || anyEvent.priority === 'B'
AND anyEvent.date > planEndDate
AND !bannerDismissed (local state, resets on page reload)
```

If multiple eligible events exist, show the nearest one.

Visual: amber breakout strip (`bg-amber-50`, `border-b border-amber-200`), contrasting against the blue gradient below it. Contains:
- Event name + new date (e.g. "🗓 Dragon Ride moved to 14 Sep")
- How many weeks early the plan ends (e.g. "Plan ends 3 weeks early")
- "Extend" button (amber) → opens `ExtendPlanModal` in event mode, pre-filled with `extraWeeks = weeksGap`
- "×" dismiss button → sets `bannerDismissed = true` (local state only)

## UI: ExtendPlanModal

Bottom sheet (`fixed inset-0`, `items-end sm:items-center`, matches existing modal pattern in the app).

### Event mode (triggered from banner)

Props: `mode="event"`, `eventName`, `eventDate`, `suggestedWeeks`, `planEndDate`, `currentPhilosophy`

Content:
- Header: "Extend plan" label + "Dragon Ride moved" title
- Subtitle: "Your event is now X weeks beyond your plan end."
- Two-column date comparison: current end date (grey) → new end date (blue, bold)
- Green rationale box: AI-derived explanation of what the extra weeks do (computed from `computeMethodology` with new total)
- Updated phase bar: coloured segments proportional to new phase weeks, with `↑` on the extended phase
- Primary CTA: "Extend to [event date]" — triggers generation
- Secondary: "Cancel" text button

### Manual mode (triggered from kebab)

Props: `mode="manual"`, `planEndDate`, `currentPhilosophy`, `weeksCompleted`

Content:
- Header: "Extend plan" label + "How many weeks?" title
- Subtitle: "Currently ends [date] · Week N of N"
- 4-chip grid: +2 / +4 / +6 / +8 weeks. First chip selected by default (+2). Tapping updates rationale + phase bar instantly.
- Same green rationale box and updated phase bar as event mode
- Primary CTA: "Extend plan by X weeks"
- Secondary: "Cancel"

### Shared logic

`computeMethodology` is called with:
- `weeklyHours`: `Object.values(schedule).reduce((s, m) => s + m, 0) / 60` — same derivation used in `openMethodologyModal()` on the plan page
- `weeksToEvent`: `weeksCompleted + remainingWeeks + extraWeeks`
- `weeksCompleted`: `Math.floor((Date.now() - new Date(planCreatedAt).getTime()) / (7 * 86400000))` — weeks elapsed since plan start
- `remainingWeeks`: `planWeeks - weeksCompleted`
- `eventType` / `eventPriority`: from nearest A/B event (or null if none)
- `currentCTL`: latest wellness CTL

The returned `phase_weeks` drives both the rationale text and the phase bar rendering. No network call — instant.

## API: POST /api/plan/extend

**Route:** `app/api/plan/extend/route.ts`

**Request body:**
```typescript
{ extra_weeks: number }  // integer, 1–26
```

**Handler steps:**

1. Authenticate user (Supabase session)
2. Fetch active plan: `training_plans` where `status = 'active'`, get `id`, `plan_weeks`, `created_at`, `training_philosophy`, `week_phases`
3. Compute new total weeks: `plan_weeks + extra_weeks` (capped at 52)
4. Re-derive phase structure via `computeMethodology` (reuse existing function, same inputs as step 3)
5. Determine today's date. Delete all future workout rows: `DELETE FROM workouts WHERE plan_id = ? AND date >= today AND status != 'completed'`
6. Stream new sessions via `createExtendStream` (see below), passing: the plan's `training_philosophy`, new `phase_weeks`, `extra_weeks`, and the plan's remaining phase context
7. On `streamComplete`, PATCH the plan record: `{ plan_weeks: newTotal, week_phases: newWeekPhases }`
8. Return the stream

**Validation:**
- `extra_weeks` must be a positive integer ≤ 26
- Must have an active plan — 400 if none
- Must have a valid user session — 401 if not

## lib/claude/plan.ts: buildExtendPrompt

New exported helper (alongside existing `buildPromptWithPhilosophy`):

```typescript
export function buildExtendPrompt(
  extraWeeks: number,
  newPhaseWeeks: TrainingPhilosophy['phase_weeks'],
  trainingPhilosophy: TrainingPhilosophy | null,
  todayDate: string,
): string
```

Returns a prompt instructing the AI to generate only the sessions from `todayDate` onward, using the updated phase structure. Injects the philosophy block via `buildPromptWithPhilosophy`. Specifies clearly: "Do not regenerate any sessions before [todayDate]. The completed sessions are unchanged."

`createExtendStream` in `plan.ts` wraps `buildExtendPrompt` and calls `anthropic.messages.stream` (same model as plan generation: `claude-opus-4-8`).

## Data Flow

```
User taps "Extend" (banner or kebab)
  → ExtendPlanModal opens
  → computeMethodology() [client-side, instant]
  → Phase bar + rationale rendered

User confirms
  → POST /api/plan/extend { extra_weeks }
  → Server: fetch plan → delete future workouts → stream new sessions
  → Client: streaming plan renders (same streaming UI as plan generation)
  → On complete: plan_weeks + week_phases updated in DB
  → Modal closes, plan page refreshes
```

## Scope Notes

- **Rename plan**: uses `window.prompt` inline in the kebab handler, then `PATCH /api/plan` with `{ name }`. No new component needed — the existing PATCH endpoint already accepts `name`.
- **Delete and Regenerate**: existing flows, moved into the kebab menu. The old standalone buttons are removed.
- **Banner dismissal**: local React state only. No persistence — the banner will reappear on next page load if the event is still beyond the plan end. This is acceptable; it serves as a persistent nudge until the user acts.
- **Multiple events beyond plan end**: show banner for the nearest A/B event only.
- **No event exists**: manual mode only. The week chips default to +2. The AI rationale explains extension in terms of phase structure rather than event proximity.
