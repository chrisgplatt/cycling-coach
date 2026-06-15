# Coaching Philosophy Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the Friel/Coggan coaching methodology into every layer of the coaching system — with explicit phase rules in CLAUDE.md, a pre-plan methodology recommendation UI, and philosophy stored on the plan so all coaching prompts (generation, review, briefing) stay coherent.

**Architecture:** Pure `computeMethodology()` function derives the approach from athlete profile data. A new `MethodologyModal` appears between interview completion and plan generation. The chosen philosophy is stored as `training_philosophy jsonb` on `training_plans` and injected into `plan.ts`, `review.ts`, and `briefing.ts` prompts. Legacy plans (no stored philosophy) show a one-time banner offering re-evaluation.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, Supabase, Jest + RTL

---

## File Map

| File | Change |
|------|--------|
| `CLAUDE.md` | Add Coaching Methodology section |
| `types/index.ts` | Add `TrainingPhilosophy` interface |
| `lib/claude/methodology.ts` | New — `computeMethodology()` pure function |
| `components/MethodologyModal.tsx` | New — recommendation UI with 3 choices |
| `supabase/schema.sql` | Add `training_philosophy jsonb` to `training_plans` |
| `supabase/migrations/20260615_training_philosophy.sql` | New migration |
| `lib/claude/plan.ts` | Accept `trainingPhilosophy`, inject into prompt |
| `app/api/plan/route.ts` | POST: pass philosophy to `createPlanStream`; PATCH: store in DB; new PATCH philosophy-only path |
| `app/plan/page.tsx` | Show `MethodologyModal` after interview; pass philosophy to generation; legacy banner |
| `lib/claude/review.ts` | Accept `trainingPhilosophy`, inject into prompt |
| `app/api/plan/review/route.ts` | Fetch philosophy from plan, pass to `createReviewStream` |
| `lib/claude/briefing.ts` | Accept `currentPhase`, inject phase context into morning briefing |
| `types/index.ts` | Add `currentPhase` to `BriefingContext` |
| `__tests__/lib/methodology.test.ts` | New — unit tests for `computeMethodology` |
| `__tests__/components/MethodologyModal.test.tsx` | New — RTL tests for modal |

---

### Task 1: Add Coaching Methodology section to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the methodology section**

Open `CLAUDE.md`. After the `## Scheduling Hard Rules` section (after line 201, before `## graphify`), insert:

```markdown
---

## Coaching Methodology

The coaching system uses **Friel/Coggan periodization** as its primary methodology, with polarised intensity distribution principles in the base phase. Every prompt that generates or adapts sessions must follow these rules. The chosen philosophy for a plan is stored in `training_plans.training_philosophy` and must be included in the prompt context.

### Phase duration matrix

Plan length determines phase weeks. Taper is always preserved — compress base first if time is short.

| Plan length | Base | Build | Peak | Taper |
|-------------|------|-------|------|-------|
| 4 weeks | 1 | 2 | 0 | 1 |
| 6 weeks | 2 | 2 | 1 | 1 |
| 8 weeks | 2 | 3 | 1 | 2 |
| 10 weeks | 3 | 4 | 1 | 2 |
| 12 weeks | 4 | 5 | 1 | 2 |
| 16 weeks | 6 | 6 | 2 | 2 |
| 20+ weeks | 8 | 7 | 2 | 3 |

For plan lengths between rows, round to nearest and compress base first.

### Session type distribution per phase

These are weekly targets for the session mix, not per-session rules.

| Phase | Z1–Z2 (easy/endurance) | Z3 (tempo) | Z4 (threshold) | Z5–Z6 (VO2max/sprint) |
|-------|------------------------|-----------|----------------|------------------------|
| Base | ≥75% | ≤20% | late base only | none |
| Build | 50–60% | 10–15% | 20–25% | 5–10% |
| Peak | 50% | 10% | 20% | 20% |
| Taper | 70% | 5% | 15% | 10% activation only |

"Late base only" = threshold sessions appear in the final week of base only, as a bridge into build.

**Intensity profile overrides** (stored in `training_philosophy.intensity_profile`):
- `polarised-base`: apply distribution as above
- `threshold-heavy`: shift Z4 up by 10% in base/build; reduce Z2 proportionally — suits time-crunched athletes (<8h/week)
- `simplified`: Z2 majority across all phases; no VO2max sessions; max 1 threshold/week from mid-build only; no back-to-back hard days

### De-load rule

Every 3rd training week is a de-load week (3 weeks on, 1 week recovery — standard Friel cycle):
- Total TSS drops to 40–50% of the preceding week
- Sessions are Z1–Z2 only — no threshold, no intervals
- Duration reduced, not just intensity
- This is a hard rule. If phase duration doesn't divide into 3-week blocks, place de-load at end of block.

### Weekly session caps (hard limits)

- Maximum 1 threshold session per week (Z4)
- Maximum 1 VO2max or interval session per week (Z5–Z6)
- Minimum 1 recovery session per week (Z1 only, ≤60 min)
- Back-to-back long endurance rides (≥2h each) only in base phase, only for sportive/gran fondo goals
- Never two hard sessions (threshold or above) on consecutive days

### Session type definitions

| Type | Duration | Intensity |
|------|----------|-----------|
| Recovery | 30–60 min | Z1 only |
| Endurance | 60–180 min | Z2 (56–75% FTP) |
| Tempo | 60–120 min | Z2 with 20–40 min Z3 blocks |
| Threshold | 60–90 min | Warm-up Z2, 2–4 × 8–20 min Z4, cool-down Z2 |
| Intervals | 60–90 min | Warm-up Z2, 4–6 × 3–8 min Z5, cool-down Z2 |
| Long ride | 90–240 min | Z2 predominantly; Z3 surges allowed in build |
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): add Friel coaching methodology rules to CLAUDE.md"
```

---

### Task 2: Add `TrainingPhilosophy` type and `computeMethodology` function

**Files:**
- Modify: `types/index.ts`
- Create: `lib/claude/methodology.ts`
- Create: `__tests__/lib/methodology.test.ts`

- [ ] **Step 1: Add `TrainingPhilosophy` to `types/index.ts`**

Find the end of `types/index.ts` (after the last exported interface). Add:

```typescript
export interface TrainingPhilosophy {
  name: string
  label: string
  phase_weeks: { base: number; build: number; peak: number; taper: number }
  intensity_profile: 'polarised-base' | 'threshold-heavy' | 'simplified'
  weekly_hours_at_creation: number
  rationale: string
}
```

- [ ] **Step 2: Write failing tests**

Create `__tests__/lib/methodology.test.ts`:

```typescript
import { computeMethodology } from '@/lib/claude/methodology'

const base = {
  weeklyHours: 9,
  weeksToEvent: 14,
  eventType: 'sportive',
  eventPriority: 'A',
  currentCTL: 55,
  goals: 'Complete the Dragon Ride',
}

describe('computeMethodology', () => {
  it('returns polarised-base for weeklyHours >= 8', () => {
    const result = computeMethodology({ ...base, weeklyHours: 9 })
    expect(result.intensity_profile).toBe('polarised-base')
    expect(result.name).toBe('friel-polarised-base')
  })

  it('returns threshold-heavy for weeklyHours < 8', () => {
    const result = computeMethodology({ ...base, weeklyHours: 6 })
    expect(result.intensity_profile).toBe('threshold-heavy')
    expect(result.name).toBe('friel-threshold-heavy')
  })

  it('returns correct phase weeks for 14 week plan', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 14 })
    // 14 weeks → nearest is 12 → base:4 build:5 peak:1 taper:2
    expect(result.phase_weeks).toEqual({ base: 4, build: 5, peak: 1, taper: 2 })
  })

  it('returns correct phase weeks for 6 week plan', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 6 })
    expect(result.phase_weeks).toEqual({ base: 2, build: 2, peak: 1, taper: 1 })
  })

  it('returns correct phase weeks for 4 week plan', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 4 })
    expect(result.phase_weeks).toEqual({ base: 1, build: 2, peak: 0, taper: 1 })
  })

  it('rationale includes hours, event type, and weeks', () => {
    const result = computeMethodology({ ...base, weeklyHours: 9, weeksToEvent: 14, eventType: 'sportive' })
    expect(result.rationale).toMatch(/9/)
    expect(result.rationale).toMatch(/sportive/)
    expect(result.rationale).toMatch(/14/)
  })

  it('label contains Friel and intensity approach', () => {
    const result = computeMethodology({ ...base, weeklyHours: 9 })
    expect(result.label).toMatch(/Friel/)
    expect(result.label).toMatch(/polarised/)
  })

  it('weekly_hours_at_creation stores the input hours', () => {
    const result = computeMethodology({ ...base, weeklyHours: 7.5 })
    expect(result.weekly_hours_at_creation).toBe(7.5)
  })
})
```

- [ ] **Step 3: Run tests and verify they fail**

```bash
npx jest --no-coverage __tests__/lib/methodology.test.ts
```

Expected: FAIL — `lib/claude/methodology` not found.

- [ ] **Step 4: Create `lib/claude/methodology.ts`**

```typescript
import type { TrainingPhilosophy } from '@/types'

export interface MethodologyInput {
  weeklyHours: number
  weeksToEvent: number
  eventType: string
  eventPriority: string
  currentCTL: number | null
  goals: string
}

const PHASE_MATRIX: Record<number, TrainingPhilosophy['phase_weeks']> = {
  4:  { base: 1, build: 2, peak: 0, taper: 1 },
  6:  { base: 2, build: 2, peak: 1, taper: 1 },
  8:  { base: 2, build: 3, peak: 1, taper: 2 },
  10: { base: 3, build: 4, peak: 1, taper: 2 },
  12: { base: 4, build: 5, peak: 1, taper: 2 },
  16: { base: 6, build: 6, peak: 2, taper: 2 },
  20: { base: 8, build: 7, peak: 2, taper: 3 },
}

function getPhaseWeeks(totalWeeks: number): TrainingPhilosophy['phase_weeks'] {
  const keys = Object.keys(PHASE_MATRIX).map(Number).sort((a, b) => a - b)
  const nearest = keys.reduce((prev, cur) =>
    Math.abs(cur - totalWeeks) < Math.abs(prev - totalWeeks) ? cur : prev
  )
  return PHASE_MATRIX[nearest]
}

function approachLabel(profile: TrainingPhilosophy['intensity_profile']): string {
  if (profile === 'threshold-heavy') return 'threshold-focused base'
  if (profile === 'simplified') return 'simplified base'
  return 'polarised base'
}

export function computeMethodology(input: MethodologyInput): TrainingPhilosophy {
  const phaseWeeks = getPhaseWeeks(input.weeksToEvent)
  const intensityProfile: TrainingPhilosophy['intensity_profile'] =
    input.weeklyHours >= 8 ? 'polarised-base' : 'threshold-heavy'

  const approach = approachLabel(intensityProfile)
  const label = `Friel periodization · ${approach}`
  const name = `friel-${intensityProfile}`

  const { base, build, peak, taper } = phaseWeeks
  const phaseParts = [
    base > 0 ? `${base}wk base` : null,
    build > 0 ? `${build}wk build` : null,
    peak > 0 ? `${peak}wk peak` : null,
    taper > 0 ? `${taper}wk taper` : null,
  ].filter(Boolean).join(', ')

  const rationale = `Based on your ${input.weeklyHours.toFixed(1)}h/week schedule and a ${input.eventType} in ${input.weeksToEvent} weeks, I recommend Friel periodization with a ${approach}: ${phaseParts}.`

  return {
    name,
    label,
    phase_weeks: phaseWeeks,
    intensity_profile: intensityProfile,
    weekly_hours_at_creation: input.weeklyHours,
    rationale,
  }
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
npx jest --no-coverage __tests__/lib/methodology.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/claude/methodology.ts __tests__/lib/methodology.test.ts
git commit -m "feat(methodology): add TrainingPhilosophy type and computeMethodology function"
```

---

### Task 3: Database migration

**Files:**
- Create: `supabase/migrations/20260615_training_philosophy.sql`
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260615_training_philosophy.sql`:

```sql
alter table training_plans
  add column if not exists training_philosophy jsonb;
```

- [ ] **Step 2: Update `supabase/schema.sql`**

Find the `training_plans` table definition (around line 37). After `last_reviewed_week text`, add:

```sql
  training_philosophy jsonb,
```

The table definition should now end:
```sql
  last_reviewed_week text,
  training_philosophy jsonb
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615_training_philosophy.sql supabase/schema.sql
git commit -m "feat(db): add training_philosophy jsonb column to training_plans"
```

---

### Task 4: Create `MethodologyModal` component

**Files:**
- Create: `components/MethodologyModal.tsx`
- Create: `__tests__/components/MethodologyModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/MethodologyModal.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import MethodologyModal from '@/components/MethodologyModal'
import type { TrainingPhilosophy } from '@/types'

const recommendation: TrainingPhilosophy = {
  name: 'friel-polarised-base',
  label: 'Friel periodization · polarised base',
  phase_weeks: { base: 4, build: 5, peak: 1, taper: 2 },
  intensity_profile: 'polarised-base',
  weekly_hours_at_creation: 9,
  rationale: 'Based on your 9.0h/week schedule and a sportive in 12 weeks.',
}

const onConfirm = jest.fn()
const onClose = jest.fn()

beforeEach(() => { onConfirm.mockReset(); onClose.mockReset() })

describe('MethodologyModal', () => {
  it('renders the label and rationale', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText('Friel periodization · polarised base')).toBeInTheDocument()
    expect(screen.getByText(/9.0h\/week/)).toBeInTheDocument()
  })

  it('renders phase breakdown', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText('Base')).toBeInTheDocument()
    expect(screen.getByText('Build')).toBeInTheDocument()
    expect(screen.getByText('Taper')).toBeInTheDocument()
  })

  it('"Use this approach" calls onConfirm with original recommendation', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(screen.getByText('Use this approach'))
    expect(onConfirm).toHaveBeenCalledWith(recommendation)
  })

  it('"More intensity" calls onConfirm with threshold-heavy profile', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(screen.getByText(/More intensity/))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ intensity_profile: 'threshold-heavy' })
    )
  })

  it('"Keep it simpler" calls onConfirm with simplified profile', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(screen.getByText(/Keep it simpler/))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ intensity_profile: 'simplified' })
    )
  })

  it('backdrop click calls onClose', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(document.querySelector('.bg-black\\/40')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not render Peak row when peak weeks is 0', () => {
    const noPeak = { ...recommendation, phase_weeks: { base: 1, build: 2, peak: 0, taper: 1 } }
    render(<MethodologyModal recommendation={noPeak} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.queryByText('Peak')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npx jest --no-coverage __tests__/components/MethodologyModal.test.tsx
```

Expected: FAIL — `MethodologyModal` not found.

- [ ] **Step 3: Create `components/MethodologyModal.tsx`**

```tsx
'use client'
import type { TrainingPhilosophy } from '@/types'

interface Props {
  recommendation: TrainingPhilosophy
  onConfirm: (philosophy: TrainingPhilosophy) => void
  onClose: () => void
}

const PHASE_DESCRIPTIONS: Record<string, string> = {
  Base: '75%+ easy Z1–Z2, build the engine',
  Build: 'Add threshold and longer efforts',
  Peak: 'Sharpen, back-to-back long rides',
  Taper: 'Reduce volume, keep intensity',
}

function overrideProfile(
  base: TrainingPhilosophy,
  profile: TrainingPhilosophy['intensity_profile'],
): TrainingPhilosophy {
  const labels: Record<TrainingPhilosophy['intensity_profile'], string> = {
    'polarised-base': 'polarised base',
    'threshold-heavy': 'threshold-focused base',
    'simplified': 'simplified base',
  }
  return {
    ...base,
    intensity_profile: profile,
    name: `friel-${profile}`,
    label: `Friel periodization · ${labels[profile]}`,
  }
}

export default function MethodologyModal({ recommendation, onConfirm, onClose }: Props) {
  const { phase_weeks, label, rationale } = recommendation

  const phases = (
    [
      { key: 'Base', weeks: phase_weeks.base },
      { key: 'Build', weeks: phase_weeks.build },
      { key: 'Peak', weeks: phase_weeks.peak },
      { key: 'Taper', weeks: phase_weeks.taper },
    ] as const
  ).filter(p => p.weeks > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coaching approach</p>
          <p className="text-base font-bold text-slate-900 mt-0.5">{label}</p>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{rationale}</p>
        <div className="space-y-1.5">
          {phases.map(p => (
            <div key={p.key} className="flex items-start gap-3 bg-slate-50 rounded-lg px-3 py-2">
              <div className="text-xs font-bold text-slate-500 w-8 shrink-0 pt-0.5">{p.weeks}wk</div>
              <div>
                <p className="text-xs font-semibold text-slate-700">{p.key}</p>
                <p className="text-xs text-slate-400">{PHASE_DESCRIPTIONS[p.key]}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 pt-1">
          <button
            onClick={() => onConfirm(recommendation)}
            className="w-full bg-blue-600 text-white text-sm font-semibold rounded-xl py-3 hover:bg-blue-700 transition-colors"
          >
            Use this approach
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onConfirm(overrideProfile(recommendation, 'threshold-heavy'))}
              className="text-sm font-medium text-slate-700 bg-slate-100 rounded-xl py-2.5 hover:bg-slate-200 transition-colors"
            >
              More intensity →
            </button>
            <button
              onClick={() => onConfirm(overrideProfile(recommendation, 'simplified'))}
              className="text-sm font-medium text-slate-700 bg-slate-100 rounded-xl py-2.5 hover:bg-slate-200 transition-colors"
            >
              Keep it simpler
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx jest --no-coverage __tests__/components/MethodologyModal.test.tsx
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/MethodologyModal.tsx __tests__/components/MethodologyModal.test.tsx
git commit -m "feat(ui): add MethodologyModal component"
```

---

### Task 5: Inject philosophy into `lib/claude/plan.ts`

**Files:**
- Modify: `lib/claude/plan.ts`
- Create: `__tests__/lib/planPhilosophy.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/planPhilosophy.test.ts`:

```typescript
// @ts-nocheck
import { buildPromptWithPhilosophy } from '@/lib/claude/plan'
import type { TrainingPhilosophy } from '@/types'

const philosophy: TrainingPhilosophy = {
  name: 'friel-polarised-base',
  label: 'Friel periodization · polarised base',
  phase_weeks: { base: 4, build: 5, peak: 1, taper: 2 },
  intensity_profile: 'polarised-base',
  weekly_hours_at_creation: 9,
  rationale: 'Based on your 9.0h/week schedule.',
}

describe('buildPromptWithPhilosophy', () => {
  it('returns a string containing the philosophy label', () => {
    const result = buildPromptWithPhilosophy(philosophy)
    expect(result).toContain('Friel periodization · polarised base')
  })

  it('includes phase weeks', () => {
    const result = buildPromptWithPhilosophy(philosophy)
    expect(result).toContain('Base: 4 weeks')
    expect(result).toContain('Build: 5 weeks')
    expect(result).toContain('Taper: 2 weeks')
  })

  it('includes intensity profile', () => {
    const result = buildPromptWithPhilosophy(philosophy)
    expect(result).toContain('polarised-base')
  })

  it('returns empty string for null philosophy', () => {
    const result = buildPromptWithPhilosophy(null)
    expect(result).toBe('')
  })
})
```

- [ ] **Step 2: Run test and verify it fails**

```bash
npx jest --no-coverage __tests__/lib/planPhilosophy.test.ts
```

Expected: FAIL — `buildPromptWithPhilosophy` not exported.

- [ ] **Step 3: Update `lib/claude/plan.ts`**

Add the helper function and export it. After the `SYSTEM_PROMPT` constant (line 44), add:

```typescript
export function buildPromptWithPhilosophy(philosophy: TrainingPhilosophy | null | undefined): string {
  if (!philosophy) return ''
  const { label, phase_weeks: pw, intensity_profile } = philosophy
  const phaseLines = [
    pw.base > 0 ? `  Base: ${pw.base} weeks` : null,
    pw.build > 0 ? `  Build: ${pw.build} weeks` : null,
    pw.peak > 0 ? `  Peak: ${pw.peak} weeks` : null,
    pw.taper > 0 ? `  Taper: ${pw.taper} weeks` : null,
  ].filter(Boolean).join('\n')
  return `COACHING PHILOSOPHY: ${label}
Intensity profile: ${intensity_profile}
Phase structure:
${phaseLines}
Apply the Friel phase distribution rules from your training guidelines. In base phase, keep ≥75% of sessions Z1–Z2. In build, add threshold (max 1×/week) and VO2max (max 1×/week). De-load every 3rd week (Z1–Z2 only, 40–50% TSS reduction). Never schedule two hard sessions on consecutive days.`
}
```

Add `import type { TrainingPhilosophy } from '@/types'` to the imports at the top of `lib/claude/plan.ts` (line 5, alongside the existing type imports).

Then update `buildPrompt` to accept and use the philosophy. Change the `buildPrompt` function signature from:

```typescript
function buildPrompt(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes: string,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
): string {
```

to:

```typescript
function buildPrompt(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes: string,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
): string {
```

Then in the prompt string returned by `buildPrompt`, after `LOAD CALIBRATION` section (after line 147, before `RECENT ACTIVITIES`), insert:

```typescript
${trainingPhilosophy ? '\n' + buildPromptWithPhilosophy(trainingPhilosophy) + '\n' : ''}
```

Update `createPlanStream` signature to accept and forward `trainingPhilosophy`:

```typescript
export function createPlanStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes = '',
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
) {
  const prompt = buildPrompt(profile, syncData, weeks, startDate, notes, dossierSection, hrvStatus, trainingPhilosophy)
  return anthropic.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx jest --no-coverage __tests__/lib/planPhilosophy.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/plan.ts __tests__/lib/planPhilosophy.test.ts
git commit -m "feat(plan): inject training philosophy into plan generation prompt"
```

---

### Task 6: Wire philosophy through the plan API route

**Files:**
- Modify: `app/api/plan/route.ts`

- [ ] **Step 1: Update POST handler to accept and pass `training_philosophy`**

In `app/api/plan/route.ts`, update the POST handler. Find line 50:

```typescript
const { syncData, weeks = 6, startDate, notes = '' } = await req.json()
```

Change to:

```typescript
const { syncData, weeks = 6, startDate, notes = '', training_philosophy } = await req.json()
```

Then add `import type { TrainingPhilosophy } from '@/types'` to the imports.

Update the `createPlanStream` call (around line 72) to pass the philosophy:

```typescript
messageStream = createPlanStream(
  profileData,
  syncData ?? { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
  safeWeeks,
  safeStartDate,
  typeof notes === 'string' ? notes.trim() : '',
  [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
  hrvStatus,
  training_philosophy as TrainingPhilosophy | null ?? null,
)
```

- [ ] **Step 2: Update PATCH handler to store `training_philosophy`**

In the PATCH handler, find the `supabase.from('training_plans').insert({...})` block (around line 200). Add `training_philosophy` to the insert:

Find:
```typescript
const { data: savedPlan, error: planError } = await supabase
  .from('training_plans')
  .insert({
    name,
    status: 'active',
    target_event_name: plan.target_event_name,
    target_event_date: plan.target_event_date,
    phase: plan.phase,
    week_phases: plan.week_phases ?? null,
    rationale: plan.rationale,
    plan_weeks: planWeeks,
    user_id: user.id,
    baseline_ftp: profile.current_ftp ?? null,
  })
```

Update the destructuring at the top of PATCH to extract `training_philosophy`:

```typescript
const body = await req.json()
plan = body.plan
name = (body.name ?? '').trim()
const rawWeeks = body.weeks
planWeeks = typeof rawWeeks === 'number' && rawWeeks > 0 ? Math.min(13, Math.round(rawWeeks)) : null
const trainingPhilosophy = body.training_philosophy ?? null
```

Update the insert to include it:

```typescript
const { data: savedPlan, error: planError } = await supabase
  .from('training_plans')
  .insert({
    name,
    status: 'active',
    target_event_name: plan.target_event_name,
    target_event_date: plan.target_event_date,
    phase: plan.phase,
    week_phases: plan.week_phases ?? null,
    rationale: plan.rationale,
    plan_weeks: planWeeks,
    user_id: user.id,
    baseline_ftp: profile.current_ftp ?? null,
    training_philosophy: trainingPhilosophy,
  })
```

- [ ] **Step 3: Add philosophy-only PATCH path for legacy plan update**

At the end of the PATCH handler, before the final `return NextResponse.json(...)`, add a new path. The PATCH handler needs to handle both cases. Restructure the destructuring to detect a philosophy-only update:

After the `let plan, name, planWeeks` declarations at the start of PATCH, add:

```typescript
// Philosophy-only update path (for legacy plan re-evaluation)
if (!body.plan && body.training_philosophy !== undefined) {
  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })
  const { error } = await supabase
    .from('training_plans')
    .update({ training_philosophy: body.training_philosophy })
    .eq('id', activePlan.id)
  if (error) return NextResponse.json({ error: 'Failed to update philosophy' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

Place this check immediately after `const body = await req.json()` and before the `let plan: GeneratedPlan` line.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/plan/route.ts
git commit -m "feat(api): pass and store training_philosophy through plan generation and save"
```

---

### Task 7: Show `MethodologyModal` in the plan page flow

**Files:**
- Modify: `app/plan/page.tsx`

The goal is to show `MethodologyModal` after `InterviewModal` completes (i.e., after `onComplete` fires) and before the duration prompt. The page already loads profile data (`events`, `schedule`) so we can compute the methodology inline.

- [ ] **Step 1: Add imports and new state**

At the top of `app/plan/page.tsx`, add imports:

```typescript
import MethodologyModal from '@/components/MethodologyModal'
import { computeMethodology } from '@/lib/claude/methodology'
import type { TrainingPhilosophy } from '@/types'
```

In the component body (alongside other state declarations), add:

```typescript
const [showMethodologyModal, setShowMethodologyModal] = useState(false)
const [methodologyRecommendation, setMethodologyRecommendation] = useState<TrainingPhilosophy | null>(null)
const [trainingPhilosophy, setTrainingPhilosophy] = useState<TrainingPhilosophy | null>(null)
```

- [ ] **Step 2: Compute and show methodology after interview completes**

Find the `onComplete` prop passed to `InterviewModal`. It currently calls something like `setPlanGenNote(brief)` and `setShowDurationPrompt(true)`.

Change it so it computes methodology first. Find the current `onComplete` handler and replace/extend it:

```typescript
// New handler — compute methodology then show modal
function handleInterviewComplete(brief: string) {
  setPlanGenNote(brief)
  setShowInterview(false)

  // Compute methodology from current profile data
  const weeklyHours = Object.values(schedule).reduce((sum, mins) => sum + mins, 0) / 60
  const today = new Date().toISOString().split('T')[0]
  const nearestPriorityEvent = [...events]
    .filter(e => e.date >= today && (e.priority === 'A' || e.priority === 'B'))
    .sort((a, b) => a.date.localeCompare(b.date))[0]
    ?? [...events].filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
    ?? null

  if (!nearestPriorityEvent) {
    // No event — skip methodology modal, proceed straight to duration
    setShowDurationPrompt(true)
    return
  }

  const weeksToEvent = Math.max(1, Math.ceil(
    (new Date(nearestPriorityEvent.date).getTime() - new Date(today).getTime()) / (7 * 24 * 60 * 60 * 1000)
  ))

  const recommendation = computeMethodology({
    weeklyHours,
    weeksToEvent,
    eventType: nearestPriorityEvent.type,
    eventPriority: nearestPriorityEvent.priority,
    currentCTL: syncData?.wellness?.length
      ? syncData.wellness[syncData.wellness.length - 1].ctl ?? null
      : null,
    goals,
  })

  setMethodologyRecommendation(recommendation)
  setShowMethodologyModal(true)
}
```

Update the `InterviewModal` `onComplete` prop to use this handler:

```tsx
<InterviewModal
  wellness={latestWellness()}
  currentFTP={currentFtp}
  onComplete={handleInterviewComplete}
  onClose={() => setShowInterview(false)}
/>
```

- [ ] **Step 3: Handle methodology modal confirmation**

Add a handler for when the user picks a methodology:

```typescript
function handleMethodologyConfirm(philosophy: TrainingPhilosophy) {
  setTrainingPhilosophy(philosophy)
  setShowMethodologyModal(false)
  setShowDurationPrompt(true)
}
```

Add the modal to the JSX (alongside other modals):

```tsx
{showMethodologyModal && methodologyRecommendation && (
  <MethodologyModal
    recommendation={methodologyRecommendation}
    onConfirm={handleMethodologyConfirm}
    onClose={() => {
      setShowMethodologyModal(false)
      setShowDurationPrompt(true)  // proceed without philosophy if closed
    }}
  />
)}
```

- [ ] **Step 4: Pass `training_philosophy` in the plan generation POST**

Find where the page calls `POST /api/plan` (look for `fetch('/api/plan', { method: 'POST' ...`)`. Add `training_philosophy` to the request body:

```typescript
body: JSON.stringify({ syncData, weeks: planWeeks, startDate, notes: planGenNote, training_philosophy: trainingPhilosophy }),
```

Also pass it in the PATCH call that saves the approved plan. Find `fetch('/api/plan', { method: 'PATCH' ...}` and add `training_philosophy: trainingPhilosophy` to its body.

- [ ] **Step 5: Add legacy plan re-evaluation banner**

After the existing `loadPlan()` function reads plan data, `setPlanWeekPhases`, etc., load `training_philosophy` too. In the `.then(data => {...})` block, add:

```typescript
// Check if plan exists but has no philosophy (legacy plan)
const hasPhilosophy = !!(data?.training_philosophy)
const hasPlan = !!(data?.workouts?.length)
setShowPhilosophyBanner(hasPlan && !hasPhilosophy)
```

Add state:

```typescript
const [showPhilosophyBanner, setShowPhilosophyBanner] = useState(false)
const [planPhilosophy, setPlanPhilosophy] = useState<TrainingPhilosophy | null>(null)
```

In `loadPlan`, also set `planPhilosophy`:

```typescript
setPlanPhilosophy(data?.training_philosophy ?? null)
```

Add the banner in the JSX on the plan tab, above the plan journey section:

```tsx
{showPhilosophyBanner && (
  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
    <div>
      <p className="text-xs font-semibold text-blue-700">New: Coaching philosophy</p>
      <p className="text-xs text-blue-600 mt-0.5">Your plan predates the coaching philosophy feature. Re-evaluate remaining sessions with Friel periodization?</p>
    </div>
    <button
      onClick={handlePhilosophyReeval}
      className="text-xs font-semibold text-blue-700 bg-blue-100 rounded-lg px-3 py-1.5 hover:bg-blue-200 transition-colors shrink-0 min-h-[44px] flex items-center"
    >
      Apply
    </button>
  </div>
)}
```

Add the handler:

```typescript
function handlePhilosophyReeval() {
  const weeklyHours = Object.values(schedule).reduce((sum, mins) => sum + mins, 0) / 60
  const today = new Date().toISOString().split('T')[0]
  const nearestEvent = [...events]
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null

  if (!nearestEvent) return
  const weeksToEvent = Math.max(1, Math.ceil(
    (new Date(nearestEvent.date).getTime() - new Date(today).getTime()) / (7 * 24 * 60 * 60 * 1000)
  ))

  const recommendation = computeMethodology({
    weeklyHours,
    weeksToEvent,
    eventType: nearestEvent.type,
    eventPriority: nearestEvent.priority,
    currentCTL: syncData?.wellness?.length
      ? syncData.wellness[syncData.wellness.length - 1].ctl ?? null
      : null,
    goals,
  })
  setMethodologyRecommendation(recommendation)
  setShowMethodologyModal(true)
}
```

When the methodology modal confirms during a re-eval, detect we're in re-eval mode (not interview mode) by checking `showPhilosophyBanner`. Update `handleMethodologyConfirm`:

```typescript
async function handleMethodologyConfirm(philosophy: TrainingPhilosophy) {
  setTrainingPhilosophy(philosophy)
  setShowMethodologyModal(false)

  if (showPhilosophyBanner) {
    // Store philosophy on existing plan, then trigger review
    setShowPhilosophyBanner(false)
    await fetch('/api/plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ training_philosophy: philosophy }),
    })
    startAdaptation(
      `Re-evaluating remaining sessions with ${philosophy.label}. Apply the Friel phase distribution rules and session type caps to restructure the remaining workouts.`
    )
    return
  }

  setShowDurationPrompt(true)
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat(plan): show MethodologyModal in plan creation flow and legacy plan banner"
```

---

### Task 8: Inject philosophy into plan review

**Files:**
- Modify: `lib/claude/review.ts`
- Modify: `app/api/plan/review/route.ts`

- [ ] **Step 1: Update `lib/claude/review.ts`**

Add `import type { TrainingPhilosophy } from '@/types'` and import `buildPromptWithPhilosophy` from plan:

```typescript
import { buildPromptWithPhilosophy } from '@/lib/claude/plan'
import type { TrainingPhilosophy } from '@/types'
```

Update `buildReviewPrompt` signature to accept `trainingPhilosophy`:

```typescript
export function buildReviewPrompt(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
  recentActivities: ICUActivity[] = [],
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
): string {
```

In the prompt string returned, after the `CURRENT ATHLETE STATE` section (after line ~139 of review.ts), add:

```typescript
${trainingPhilosophy ? '\n' + buildPromptWithPhilosophy(trainingPhilosophy) + '\n' : ''}
```

Update `createReviewStream` to accept and forward `trainingPhilosophy`:

```typescript
export function createReviewStream(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
  recentActivities: ICUActivity[] = [],
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
) {
  const prompt = buildReviewPrompt(profile, lastWeekWorkouts, wellness, remainingWorkouts, note, recentActivities, dossierSection, hrvStatus, trainingPhilosophy)
  return anthropic.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
}
```

- [ ] **Step 2: Update `app/api/plan/review/route.ts`**

In the POST handler, after fetching the plan, extract the stored philosophy:

```typescript
const trainingPhilosophy = plan.training_philosophy ?? null
```

Pass it to `createReviewStream`:

```typescript
messageStream = createReviewStream(
  profile,
  lastWeekWorkouts,
  wellness,
  remainingWorkouts,
  note,
  recentActivities,
  formatDossier(dossier as AthleteDossier | null),
  hrvStatus,
  trainingPhilosophy,
)
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/claude/review.ts app/api/plan/review/route.ts
git commit -m "feat(review): inject training philosophy into plan review prompt"
```

---

### Task 9: Add phase context to daily briefing

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/claude/briefing.ts`
- Modify: the API route that calls `generateBriefing` (find by searching for `generateBriefing` usage)

- [ ] **Step 1: Add `currentPhase` to `BriefingContext` in `types/index.ts`**

Find the `BriefingContext` interface. Add an optional field:

```typescript
currentPhase?: string | null    // e.g. 'base' | 'build' | 'peak' | 'taper'
currentPhaseWeek?: number | null  // which week within the current phase (1-based)
```

- [ ] **Step 2: Update `lib/claude/briefing.ts` morning briefing prompt**

In `generateMorningBriefing`, after the `dossierLines` block, add a phase context line:

```typescript
const phaseContext = ctx.currentPhase
  ? `Training phase: ${ctx.currentPhase}${ctx.currentPhaseWeek ? ` (week ${ctx.currentPhaseWeek} of this phase)` : ''}`
  : null
```

Add it to the prompt string, after `dossierLines`:

```typescript
${phaseContext ? phaseContext + '\n' : ''}
```

Also update `SYSTEM_MORNING` to reference phase context — add to the system prompt string:

```
When training phase is provided, make the morning note phase-aware: in base phase, encourage staying in Z2 and building aerobic base; in build phase, prime for threshold quality work; in peak phase, affirm sharpening; in taper, reassure that reduced volume is intentional.
```

Add this sentence to the end of `SYSTEM_MORNING` before the closing quote.

- [ ] **Step 3: Populate `currentPhase` in the briefing API route**

Find the API route that calls `generateBriefing` (search for `generateBriefing` — likely in `app/api/briefing/today/route.ts` or similar).

In that route, fetch the active plan and derive the current phase:

```typescript
const { data: activePlan } = await supabase
  .from('training_plans')
  .select('phase, week_phases, created_at, plan_weeks')
  .eq('status', 'active')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()

// Determine current phase week number
let currentPhaseWeek: number | null = null
if (activePlan?.week_phases && activePlan.created_at) {
  const planStart = new Date(activePlan.created_at)
  const todayDate = new Date()
  const weekIndex = Math.floor((todayDate.getTime() - planStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
  const clampedIndex = Math.max(0, Math.min(weekIndex, (activePlan.week_phases as string[]).length - 1))
  const currentPhaseFromWeekPhases = (activePlan.week_phases as string[])[clampedIndex]

  // Count how many consecutive weeks at current phase we are into
  let phaseStart = clampedIndex
  while (phaseStart > 0 && (activePlan.week_phases as string[])[phaseStart - 1] === currentPhaseFromWeekPhases) {
    phaseStart--
  }
  currentPhaseWeek = clampedIndex - phaseStart + 1
}
```

Pass to `BriefingContext`:

```typescript
currentPhase: activePlan?.phase ?? null,
currentPhaseWeek,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/claude/briefing.ts
git commit -m "feat(briefing): add phase-aware context to morning briefing prompt"
```

---

### Task 10: Final verification and push

- [ ] **Step 1: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass. Note the count — should be ≥735 (prior baseline) plus the new tests from Tasks 2 and 4 (8 + 7 = 15 new tests).

- [ ] **Step 2: TypeScript clean check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Push**

```bash
git push
```
