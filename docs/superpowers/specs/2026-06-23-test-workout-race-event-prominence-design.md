# Test Workout Tagging & Race/Event Calendar Prominence Design

**Goal:** Visually distinguish FTP tests, ramp tests, and other fitness assessments from regular training workouts; make race and sportive events stand out on the calendar month strip.

**Architecture:** Add `'test'` as a fifth `WorkoutType`; update the AI coach prompt to assign it correctly; update `WorkoutCard` with violet styling; update `MonthStrip` so race/sportive days get a filled red date circle instead of just a dot.

**Tech Stack:** TypeScript, Next.js App Router, Tailwind CSS, Claude AI (plan generation)

## Global Constraints

- No Supabase migration required — the `workouts.type` column is plain text, not a DB enum.
- The `WorkoutType` union in `types/index.ts` is the single source of truth; all consuming code derives from it.
- Tailwind classes must use the existing scale (violet-500, violet-50, violet-700, violet-200).
- The MonthStrip day cell must remain exactly 44px min-height; no layout changes, only color logic.
- Only race and sportive event types get the filled date circle treatment; holiday and fitness keep the existing small red dot.

---

### Task 1: Add `'test'` to WorkoutType

**Files:**
- Modify: `types/index.ts` (line ~1)

**What to do:**
Update the `WorkoutType` union:

```typescript
export type WorkoutType = 'endurance' | 'threshold' | 'intervals' | 'recovery' | 'test'
```

No other changes in this file. The DB column is text — no migration needed.

**Test:** TypeScript build (`npx tsc --noEmit`) passes with no new errors.

---

### Task 2: Add violet styling for `test` type in WorkoutCard

**Files:**
- Modify: `components/WorkoutCard.tsx`

**What to do:**
Find the `TYPE_CHIPS` and `TYPE_BAR` maps and add entries for `test`:

```typescript
const TYPE_CHIPS: Record<WorkoutType, string> = {
  endurance: 'bg-blue-50 text-blue-700 border border-blue-200',
  threshold: 'bg-orange-50 text-orange-600 border border-orange-200',
  intervals:  'bg-red-50 text-red-600 border border-red-200',
  recovery:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  test:       'bg-violet-50 text-violet-700 border border-violet-200',
}

const TYPE_BAR: Record<WorkoutType, string> = {
  endurance: 'bg-blue-500',
  threshold: 'bg-red-500',
  intervals:  'bg-orange-500',
  recovery:   'bg-emerald-500',
  test:       'bg-violet-500',
}
```

The badge label for `test` must display as `"Test"` (capital T). Find where the badge text is derived from the type and ensure `test` → `"Test"` (the existing pattern likely capitalises the first letter, which already works; if the badge uses a lookup map, add `test: 'Test'` to it).

**Test:** A `WorkoutCard` rendered with `type="test"` shows a violet top bar and a violet "Test" badge. All other type variants still render correctly.

---

### Task 3: Update MonthStrip to highlight race/sportive days

**Files:**
- Modify: `app/calendar/page.tsx` — MonthStrip component (lines ~129–228)

**What to do:**
In the day cell rendering, detect whether any event on that date is a race or sportive. If so, render the date number circle with a red filled background and white text — the same pattern used for today (blue fill + white text).

Current date number span:
```tsx
<span className={`text-[11px] w-6 h-6 flex items-center justify-center leading-none rounded-full
  ${isToday ? 'bg-blue-500 text-white font-bold' : 'text-slate-600'}`}>
  {parseInt(dateStr.split('-')[2], 10)}
</span>
```

Updated logic:
```tsx
const isRaceDay = events.some(e => e.date === dateStr && (e.type === 'race' || e.type === 'sportive'))

<span className={`text-[11px] w-6 h-6 flex items-center justify-center leading-none rounded-full
  ${isToday
    ? 'bg-blue-500 text-white font-bold'
    : isRaceDay
      ? 'bg-red-500 text-white font-semibold'
      : 'text-slate-600'
  }`}>
  {parseInt(dateStr.split('-')[2], 10)}
</span>
```

The existing red dot for events still renders in the dot row below — no change to the dots logic. Holiday and fitness events keep the dot only.

**Test:** A day with a race or sportive event shows a red-filled date circle in the month strip. A day with a holiday event shows only the red dot (no fill). Today's date is not affected when it has a race (today takes blue — `isToday` check comes first).

---

### Task 4: Update AI coach prompt to use `test` type

**Files:**
- Modify: `lib/claude/plan.ts` — `buildPrompt()` function

**What to do:**
Two changes inside the prompt string:

1. Update the type field in the JSON schema example:
```
"type": "endurance|threshold|intervals|recovery|test"
```

2. Add a rule in the STEP RULES / workout type guidance section:
```
- Use type: test for FTP tests, ramp tests, and any fitness assessment sessions. These are distinct from regular interval sessions.
```

**Test:** The prompt string contains `test` in both the schema example and the rules section. No functional test needed beyond string verification — the AI will pick up the new type on the next plan generation.
