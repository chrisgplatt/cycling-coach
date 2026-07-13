# Calendar Mini-Month Summary Column Width Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the mini month-calendar's per-week planned/actual summary text from overflowing past the card's left edge on mobile.

**Architecture:** Widen `MonthStrip`'s summary column from `w-10` (40px) to `w-14` (56px) in `app/calendar/page.tsx`, at the two places that must move together to stay visually aligned.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind.

## Global Constraints

- Only the two `MonthStrip` occurrences of `w-10` change to `w-14`: the day-of-week header's blank spacer cell (`app/calendar/page.tsx:156`) and the week-row summary column wrapper (`app/calendar/page.tsx:171`).
- The unrelated `w-10` at `app/calendar/page.tsx:327` (a date-badge column in `WeekDetail`, the day-by-day list further down the page) must NOT change.
- No changes to `WeeklySummaryStack`'s content, formatting, or colors — this is a spacing-only fix.
- The full design doc is at `docs/superpowers/specs/2026-07-13-calendar-summary-column-width-design.md` — read it if any step below is ambiguous.

---

### Task 1: Widen the mini-calendar summary column

**Files:**
- Modify: `app/calendar/page.tsx`

**Interfaces:**
- None — this is a pure CSS class change with no function signature, prop, or type changes anywhere.

- [ ] **Step 1: Widen the day-of-week header's blank spacer cell**

Find (inside `MonthStrip`, the day-of-week header row):

```tsx
      {/* Day-of-week headers — blank left cell keeps columns aligned with summary */}
      <div className="flex mb-1">
        <div className="w-10 shrink-0" />
```

Replace with:

```tsx
      {/* Day-of-week headers — blank left cell keeps columns aligned with summary */}
      <div className="flex mb-1">
        <div className="w-14 shrink-0" />
```

- [ ] **Step 2: Widen the week-row summary column**

Find (inside `MonthStrip`, the `weeks.map((weekCells, weekIndex) => { ... })` block):

```tsx
          <div key={weekIndex} className="flex">
            {/* Weekly summary: actual (green) / planned (gray) side by side */}
            <div className="w-10 shrink-0 flex flex-col justify-center items-end pr-1.5">
              <WeeklySummaryStack summary={summary} />
            </div>
```

Replace with:

```tsx
          <div key={weekIndex} className="flex">
            {/* Weekly summary: actual (green) / planned (gray) side by side */}
            <div className="w-14 shrink-0 flex flex-col justify-center items-end pr-1.5">
              <WeeklySummaryStack summary={summary} />
            </div>
```

(Do not touch the `w-10` at `app/calendar/page.tsx:327` inside `WeekDetail` — that's the unrelated day-badge column in the day-by-day list below the calendar, not part of this fix.)

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (this is a plain string literal change; typecheck confirms nothing else was accidentally touched).

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: all suites pass unchanged — `__tests__/pages/CalendarPage.test.tsx` tests text content, not CSS classes, so it's unaffected by this change.

- [ ] **Step 5: Manual verification**

Start the dev server (`npm run dev`), open the Calendar page at a mobile viewport width (~375-430px), and confirm:
- The `M T W T F S S` day-of-week header row still lines up correctly with the day cells below it (no misalignment from the wider spacer cell).
- A high-volume week's summary numbers (e.g. `480/398` / `476m/478m`) no longer visually overflow past the card's left edge.
- A low-volume week's summary numbers still render correctly, just with a bit more breathing room.

- [ ] **Step 6: Commit**

```bash
git add app/calendar/page.tsx
git commit -m "fix: widen mini-calendar summary column to stop text overflow on mobile"
```
