# Session Distributions (Histograms) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute power/cadence/HR distributions once at sync from streams the app already fetches, persist them on the existing `activity_metrics` JSON, surface a distilled text line to single-ride coach prompts, and render a toggle histogram on the session detail.

**Architecture:** A new pure `extractDistributions` runs inside `enrichActivity` (same place as the existing Tier-4 stream insights), reading the `power`/`hr`/`cadence` streams already in hand plus FTP and a newly-fetched LTHR. Output lands on `ActivityMetrics.distributions` (no DB migration — it's a JSON column). A pure `formatDistributions` produces the coach text; a `<SessionHistogram>` renders the chart. Backfill is widened to recompute rides that predate the field.

**Tech Stack:** TypeScript, Next.js App Router, Jest + Testing Library, intervals.icu REST client, Supabase (Postgres JSON column).

---

## File Structure

- `types/index.ts` — add `DistributionBin`, `SessionDistributions`; add `distributions` to `ActivityMetrics`.
- `lib/claude/activity-metrics.ts` — add `extractDistributions` (compute) and `formatDistributions` (coach text), alongside the existing `extractStreamInsights`/`formatRideShape`.
- `lib/intervals/client.ts` — add `getRideLthr()`.
- `lib/intervals/enrich.ts` — thread `lthr` through `enrichActivity`/`enrichActivityById`; call `extractDistributions`; fetch LTHR + widen the predicate in `backfillActivityMetrics`.
- `app/api/feedback/route.ts` — add `formatDistributions` to the shared `rideExecution` block.
- `app/api/briefing/today/route.ts` — add `formatDistributions` to each ride's `execution`.
- `lib/claude/session-chat.ts` — add a distributions section to `buildSessionSystemPrompt`.
- `components/SessionHistogram.tsx` — new chart component (segmented Power/Cadence/HR toggle).
- `components/WorkoutDetailModal.tsx` — mount `<SessionHistogram>` under the Stats tab.

**Data model (final):**
```ts
export interface DistributionBin { edge: number; secs: number }   // edge = lower bin edge; unit implied by which array
export interface SessionDistributions {
  power: DistributionBin[] | null          // 5%-FTP bins, edge 0..150 (150 = "150%+" catch-all)
  power_vi: number | null                  // NP/avg, 2dp
  power_steady_pct: number | null          // % of time within ±5% of NP
  cadence: DistributionBin[] | null        // 10-rpm bins, edge 0..120 (120 = "120+"); coasting excluded
  coasting_secs: number | null             // time pedalling-stopped (<30 rpm)
  hr: DistributionBin[] | null             // 5-bpm bins
  hr_lthr: number | null                   // LTHR for zone overlay; null = raw bpm
}
```
(Refinement from the spec: a uniform `edge` field instead of per-distribution `edge_pct/edge_rpm/edge_bpm` — DRY, the unit is implied by which array the bin sits in. `power_vi`/`power_steady_pct` are stored so both the coach text and the chart's summary line read the same precomputed values.)

---

## Task 1: Types

**Files:**
- Modify: `types/index.ts` (the `ActivityMetrics` interface around lines 310–329)

- [ ] **Step 1: Add the distribution types and the `distributions` field**

In `types/index.ts`, immediately **before** `export interface ActivityMetrics {`, add:

```ts
export interface DistributionBin {
  edge: number   // lower edge of the bin; unit implied by context (%FTP, rpm, or bpm)
  secs: number   // seconds spent in this bin
}

export interface SessionDistributions {
  power: DistributionBin[] | null          // 5%-FTP bins, edge 0..150 (150 = "150%+" catch-all)
  power_vi: number | null                  // variability index = NP/avg, 2dp
  power_steady_pct: number | null          // % of moving time within ±5% of NP
  cadence: DistributionBin[] | null        // 10-rpm bins, edge 0..120 (120 = "120+"); coasting excluded
  coasting_secs: number | null             // time pedalling-stopped (<30 rpm)
  hr: DistributionBin[] | null             // 5-bpm bins
  hr_lthr: number | null                   // LTHR used for zone overlay; null = raw bpm
}
```

Then inside `ActivityMetrics`, add a new line after the `shape` field (currently line 327):

```ts
  distributions: SessionDistributions | null  // Tier-4 within-session histograms
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (exit 0). Existing code that builds `ActivityMetrics` literals (e.g. `extractActivityMetrics` in `lib/claude/activity-metrics.ts`) will now error for a missing `distributions` — that is expected and fixed in Step 3.

If `tsc` reports `Property 'distributions' is missing` in `lib/claude/activity-metrics.ts`, proceed to Step 3.

- [ ] **Step 3: Default `distributions` to null in `extractActivityMetrics`**

In `lib/claude/activity-metrics.ts`, in the object returned by `extractActivityMetrics` (currently ends with `shape: null,` then `synced_at: ...`), add `distributions: null,` so the base metrics always carry the key:

```ts
    shape: null,
    distributions: null,
    synced_at: new Date().toISOString(),
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS (exit 0).

- [ ] **Step 5: Commit**

```bash
git add types/index.ts lib/claude/activity-metrics.ts
git commit -m "feat: add SessionDistributions type to ActivityMetrics"
```

---

## Task 2: `extractDistributions` (compute)

**Files:**
- Modify: `lib/claude/activity-metrics.ts` (add at the end, after `formatRideShape`)
- Test: `__tests__/lib/activity-distributions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/activity-distributions.test.ts`:

```ts
import { extractDistributions } from '@/lib/claude/activity-metrics'
import type { RideStreams } from '@/types'

// 11 samples, 10 gaps of 60s = 600s total (the final sample contributes no dt).
const time = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]
const base: RideStreams = {
  time, distance: time.map(() => 0), latlng: null,
  power: null, hr: null, altitude: null, cadence: null, velocity: null,
}

describe('extractDistributions — power', () => {
  it('buckets power by %FTP and computes VI + steadiness', () => {
    const power = time.map(() => 200) // 200W at FTP 200 = 100% FTP
    const d = extractDistributions({ ...base, power }, 200, null, 210, 200)
    expect(d.power).toEqual([{ edge: 100, secs: 600 }])
    expect(d.power_vi).toBeCloseTo(1.05, 2)      // NP 210 / avg 200
    expect(d.power_steady_pct).toBe(100)          // every sample within ±5% of NP 210
  })

  it('returns null power when FTP is missing', () => {
    const power = time.map(() => 200)
    const d = extractDistributions({ ...base, power }, null, null, 210, 200)
    expect(d.power).toBeNull()
    expect(d.power_steady_pct).toBeNull()
  })

  it('caps power bins at a 150%+ catch-all', () => {
    const power = time.map(() => 400) // 200% FTP
    const d = extractDistributions({ ...base, power }, 200, null, 400, 400)
    expect(d.power).toEqual([{ edge: 150, secs: 600 }])
  })
})

describe('extractDistributions — cadence', () => {
  it('buckets pedalling cadence and sums coasting separately', () => {
    // first 5 gaps at 90rpm, next 5 at 20rpm (coasting, <30)
    const cadence = [90, 90, 90, 90, 90, 20, 20, 20, 20, 20, 20]
    const d = extractDistributions({ ...base, cadence }, 200, null, null, null)
    expect(d.cadence).toEqual([{ edge: 90, secs: 300 }])
    expect(d.coasting_secs).toBe(300)
  })

  it('returns null cadence (but keeps coasting) when all samples are coasting', () => {
    const cadence = time.map(() => 0)
    const d = extractDistributions({ ...base, cadence }, 200, null, null, null)
    expect(d.cadence).toBeNull()
    expect(d.coasting_secs).toBe(600)
  })
})

describe('extractDistributions — hr', () => {
  it('buckets HR into 5bpm bins and records the LTHR overlay when supplied', () => {
    const hr = [150, 150, 150, 150, 150, 165, 165, 165, 165, 165, 165]
    const d = extractDistributions({ ...base, hr }, 200, 160, null, null)
    expect(d.hr).toEqual([{ edge: 150, secs: 300 }, { edge: 165, secs: 300 }])
    expect(d.hr_lthr).toBe(160)
  })

  it('keeps hr_lthr null (raw bpm) when no LTHR is known', () => {
    const hr = time.map(() => 150)
    const d = extractDistributions({ ...base, hr }, 200, null, null, null)
    expect(d.hr).toEqual([{ edge: 150, secs: 600 }])
    expect(d.hr_lthr).toBeNull()
  })
})

describe('extractDistributions — empty', () => {
  it('nulls every distribution when no streams are present', () => {
    const d = extractDistributions(base, 200, 160, 210, 200)
    expect(d).toEqual({
      power: null, power_vi: 1.05, power_steady_pct: null,
      cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
    })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/lib/activity-distributions.test.ts`
Expected: FAIL — `extractDistributions is not a function`.

- [ ] **Step 3: Implement `extractDistributions` and its helpers**

In `lib/claude/activity-metrics.ts`, append at the end of the file:

```ts
// ── Within-session distributions (histograms) ─────────────────────────────
// Pure, computed from the same streams as extractStreamInsights. Each channel
// degrades to null independently. Bin `edge` is the lower edge; widths are fixed
// by convention (power 5% FTP, cadence 10 rpm, HR 5 bpm). Trapezoidal dt, matching
// computeTimeInZone: a sample's duration is the gap to the next sample.

function binByTime(
  values: number[] | null, time: number[], binOf: (v: number) => number | null,
): DistributionBin[] | null {
  if (!values) return null
  const acc = new Map<number, number>()
  for (let i = 0; i < values.length - 1; i++) {
    const dt = time[i + 1] - time[i]
    const v = values[i]
    if (dt <= 0 || !Number.isFinite(v)) continue
    const edge = binOf(v)
    if (edge === null) continue
    acc.set(edge, (acc.get(edge) ?? 0) + dt)
  }
  if (acc.size === 0) return null
  return [...acc.entries()]
    .map(([edge, secs]) => ({ edge, secs: Math.round(secs) }))
    .sort((a, b) => a.edge - b.edge)
}

// Cadence is special: coasting (<30 rpm) is excluded from the distribution and
// summed separately so descents/freewheeling don't skew the pedalling shape.
function cadenceDistribution(
  cadence: number[] | null, time: number[],
): { bins: DistributionBin[] | null; coasting_secs: number | null } {
  if (!cadence) return { bins: null, coasting_secs: null }
  const acc = new Map<number, number>()
  let coasting = 0
  for (let i = 0; i < cadence.length - 1; i++) {
    const dt = time[i + 1] - time[i]
    const c = cadence[i]
    if (dt <= 0 || !Number.isFinite(c)) continue
    if (c < 30) { coasting += dt; continue }
    const edge = Math.min(Math.floor(c / 10) * 10, 120)
    acc.set(edge, (acc.get(edge) ?? 0) + dt)
  }
  const bins = acc.size
    ? [...acc.entries()].map(([edge, secs]) => ({ edge, secs: Math.round(secs) })).sort((a, b) => a.edge - b.edge)
    : null
  return { bins, coasting_secs: Math.round(coasting) }
}

function steadyPct(power: number[] | null, time: number[], np: number | null): number | null {
  if (!power || np === null || np <= 0) return null
  const lo = np * 0.95, hi = np * 1.05
  let inBand = 0, total = 0
  for (let i = 0; i < power.length - 1; i++) {
    const dt = time[i + 1] - time[i]
    const p = power[i]
    if (dt <= 0 || !Number.isFinite(p)) continue
    total += dt
    if (p >= lo && p <= hi) inBand += dt
  }
  return total > 0 ? Math.round((inBand / total) * 100) : null
}

export function extractDistributions(
  s: RideStreams, ftp: number | null, lthr: number | null,
  np: number | null, avgPower: number | null,
): SessionDistributions {
  const power = (ftp && ftp > 0)
    ? binByTime(s.power, s.time, v => Math.min(Math.floor((v / ftp * 100) / 5) * 5, 150))
    : null
  const { bins: cadence, coasting_secs } = cadenceDistribution(s.cadence, s.time)
  const hr = binByTime(s.hr, s.time, v => Math.floor(v / 5) * 5)
  return {
    power,
    power_vi: (np !== null && avgPower !== null && avgPower > 0) ? Math.round((np / avgPower) * 100) / 100 : null,
    power_steady_pct: power ? steadyPct(s.power, s.time, np) : null,
    cadence,
    coasting_secs,
    hr,
    hr_lthr: hr ? lthr : null,
  }
}
```

Also add `DistributionBin, SessionDistributions` to the type import at the top of the file (line 4) so the new code type-checks:

```ts
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions } from '@/types'
```

- [ ] **Step 4: Run the tests**

Run: `npx jest __tests__/lib/activity-distributions.test.ts`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/activity-metrics.ts __tests__/lib/activity-distributions.test.ts
git commit -m "feat: extractDistributions — power/cadence/HR histograms from streams"
```

---

## Task 3: `formatDistributions` (coach text)

**Files:**
- Modify: `lib/claude/activity-metrics.ts` (append after `extractDistributions`)
- Test: `__tests__/lib/format-distributions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/format-distributions.test.ts`:

```ts
import { formatDistributions } from '@/lib/claude/activity-metrics'
import type { SessionDistributions } from '@/types'

const empty: SessionDistributions = {
  power: null, power_vi: null, power_steady_pct: null,
  cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
}

describe('formatDistributions', () => {
  it('returns "" when given null or all-empty distributions', () => {
    expect(formatDistributions(null)).toBe('')
    expect(formatDistributions(empty)).toBe('')
  })

  it('emits a power variability line (metrics only, no interpretation)', () => {
    const out = formatDistributions({
      ...empty, power: [{ edge: 100, secs: 600 }], power_vi: 1.18, power_steady_pct: 34,
    })
    expect(out).toContain('Power shape: VI 1.18, 34% of time within ±5% of NP.')
    expect(out).not.toMatch(/surgey|steady ride/i) // the coach interprets, not the formatter
  })

  it('emits a cadence line with median, in-band %, grinding %, and coasting', () => {
    const out = formatDistributions({
      ...empty,
      cadence: [{ edge: 60, secs: 120 }, { edge: 90, secs: 820 }, { edge: 100, secs: 60 }],
      coasting_secs: 360,
    })
    expect(out).toContain('Cadence: median 95 rpm') // 90-bin holds the 50% mark → 90 + 5
    expect(out).toContain('% in 80–100')
    expect(out).toContain('% grinding <70')
    expect(out).toContain('Coasted 6 min')
  })

  it('emits an LTHR-relative HR line when LTHR is known', () => {
    const out = formatDistributions({
      ...empty, hr: [{ edge: 140, secs: 700 }, { edge: 165, secs: 100 }], hr_lthr: 160,
    })
    expect(out).toContain('% below LTHR')
  })

  it('emits a raw HR line (median + peak) when LTHR is absent', () => {
    const out = formatDistributions({
      ...empty, hr: [{ edge: 140, secs: 700 }, { edge: 165, secs: 100 }], hr_lthr: null,
    })
    expect(out).toContain('HR: median')
    expect(out).toContain('peak')
    expect(out).not.toContain('LTHR')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/lib/format-distributions.test.ts`
Expected: FAIL — `formatDistributions is not a function`.

- [ ] **Step 3: Implement `formatDistributions` and its helpers**

In `lib/claude/activity-metrics.ts`, append after `extractDistributions`:

```ts
const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0)

function binMedian(bins: DistributionBin[], width: number): number {
  const total = bins.reduce((s, b) => s + b.secs, 0)
  let cum = 0
  for (const b of bins) {
    cum += b.secs
    if (cum >= total / 2) return b.edge + Math.round(width / 2)
  }
  return bins[bins.length - 1].edge + Math.round(width / 2)
}

// Distilled distribution summary for single-ride coach surfaces. Emits metrics
// only — interpretation ("surgey for a tempo ride") is the coach's job. Each line
// is omitted when its distribution is absent.
export function formatDistributions(d: SessionDistributions | null): string {
  if (!d) return ''
  const lines: string[] = []

  if (d.power?.length && d.power_vi !== null) {
    const steady = d.power_steady_pct !== null ? `, ${d.power_steady_pct}% of time within ±5% of NP` : ''
    lines.push(`Power shape: VI ${d.power_vi.toFixed(2)}${steady}.`)
  }

  if (d.cadence?.length) {
    const total = d.cadence.reduce((s, b) => s + b.secs, 0)
    const median = binMedian(d.cadence, 10)
    const inBand = d.cadence.filter(b => b.edge >= 80 && b.edge < 100).reduce((s, b) => s + b.secs, 0)
    const grind = d.cadence.filter(b => b.edge < 70).reduce((s, b) => s + b.secs, 0)
    const parts = [`median ${median} rpm`, `${pct(inBand, total)}% in 80–100`]
    if (grind > 0) parts.push(`${pct(grind, total)}% grinding <70`)
    let line = `Cadence: ${parts.join(', ')}.`
    if (d.coasting_secs && d.coasting_secs >= 60) line += ` Coasted ${Math.round(d.coasting_secs / 60)} min.`
    lines.push(line)
  }

  if (d.hr?.length) {
    const total = d.hr.reduce((s, b) => s + b.secs, 0)
    if (d.hr_lthr !== null) {
      const below = d.hr.filter(b => b.edge < d.hr_lthr!).reduce((s, b) => s + b.secs, 0)
      const belowPct = pct(below, total)
      lines.push(`HR: ${belowPct}% below LTHR, ${100 - belowPct}% above (LTHR ${d.hr_lthr}).`)
    } else {
      const median = binMedian(d.hr, 5)
      const peak = d.hr[d.hr.length - 1].edge + 5
      lines.push(`HR: median ${median} bpm, peak ~${peak} bpm.`)
    }
  }

  return lines.length ? `Session distributions:\n${lines.join('\n')}` : ''
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest __tests__/lib/format-distributions.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/activity-metrics.ts __tests__/lib/format-distributions.test.ts
git commit -m "feat: formatDistributions — distilled coach text for distributions"
```

---

## Task 4: Fetch LTHR from intervals.icu

**Files:**
- Modify: `lib/intervals/client.ts` (add `getRideLthr` after `updateRideFTP`, ~line 206)
- Test: `__tests__/lib/intervals.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/intervals.test.ts`, add inside `describe('IntervalsClient', ...)`:

```ts
  it('getRideLthr returns the Ride sport-settings LTHR', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 1, types: ['Run'], lthr: 170 },
        { id: 2, types: ['Ride'], lthr: 158 },
      ],
    })
    const lthr = await client.getRideLthr()
    expect(lthr).toBe(158)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://intervals.icu/api/v1/athlete/i12345/sport-settings')
  })

  it('getRideLthr returns null when the Ride entry has no LTHR', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 2, types: ['Ride'] }],
    })
    expect(await client.getRideLthr()).toBeNull()
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest __tests__/lib/intervals.test.ts -t getRideLthr`
Expected: FAIL — `client.getRideLthr is not a function`.

- [ ] **Step 3: Implement `getRideLthr`**

In `lib/intervals/client.ts`, add directly after the `updateRideFTP` method (after its closing brace ~line 206):

```ts
  async getRideLthr(): Promise<number | null> {
    const settings = await this.request<Array<{ types: string[]; lthr?: number | null }>>(
      `/athlete/${this.athleteId}/sport-settings`
    )
    const ride = settings.find(s => s.types.includes('Ride'))
    return ride?.lthr ?? null
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx jest __tests__/lib/intervals.test.ts -t getRideLthr`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/client.ts __tests__/lib/intervals.test.ts
git commit -m "feat: getRideLthr — fetch ride LTHR from intervals.icu sport-settings"
```

---

## Task 5: Thread LTHR + distributions through enrich, and widen the backfill

**Files:**
- Modify: `lib/intervals/enrich.ts` (`enrichActivity` line 9, `enrichActivityById` line 26, `backfillActivityMetrics` lines 42–86)
- Test: `__tests__/lib/enrich.test.ts` (update stub + add cases)

- [ ] **Step 1: Update the test stub and add failing cases**

In `__tests__/lib/enrich.test.ts`, update `makeClient` so its stub provides LTHR and richer streams. Replace the `getActivityStreams` line and add `getRideLthr` inside the returned object:

```ts
    getActivityStreams: jest.fn(async () => ({
      time: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600],
      distance: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      latlng: null,
      power: Array.from({ length: 11 }, () => 200),
      hr: [150, 150, 150, 150, 150, 165, 165, 165, 165, 165, 165],
      altitude: null,
      cadence: [90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90],
      velocity: null,
    })),
    getRideLthr: jest.fn(async () => 160),
```

Then, inside `describe('backfillActivityMetrics', ...)`, add:

```ts
  it('computes distributions and threads the fetched LTHR', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase([{ id: 'w1', icu_activity_id: 'a1', steps: null }], updateSpy)
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    const [, patch] = updateSpy.mock.calls[0]
    const dist = patch.activity_metrics.distributions
    expect(dist.power).toEqual([{ edge: 100, secs: 600 }]) // 200W @ FTP 200
    expect(dist.cadence).toEqual([{ edge: 90, secs: 600 }])
    expect(dist.hr_lthr).toBe(160)
    expect(client.getRideLthr).toHaveBeenCalledTimes(1)
  })

  it('queries for rows whose distributions are missing', async () => {
    const isSpy = jest.fn()
    const updateSpy = jest.fn()
    const supabase = makeSupabase([], updateSpy, isSpy)
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(isSpy).toHaveBeenCalledWith('activity_metrics->distributions', null)
  })
```

Update `makeSupabase` to record `is` calls when a spy is passed. Replace its signature and the `is:` entry:

```ts
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string; steps: unknown }>, updateSpy: jest.Mock, isSpy?: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, gte: self, not: self,
    is: (col: string, val: unknown) => { isSpy?.(col, val); return query },
    order: self,
    limit: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: { current_ftp: 200 }, error: null }),
  })
  // ... rest unchanged
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: FAIL — `distributions` is undefined on the patch, `getRideLthr` not called, and the `is` query still targets `activity_metrics`.

- [ ] **Step 3: Thread `lthr` through `enrichActivity` and `enrichActivityById`**

In `lib/intervals/enrich.ts`, change `enrichActivity` (line 9) to accept `lthr` and compute distributions:

```ts
export async function enrichActivity(
  client: IntervalsClient,
  activity: ICUActivity,
  ftp: number | null,
  lthr: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const date = activity.start_date_local.split('T')[0]
  const [curve, intervals, streams] = await Promise.all([
    client.getPowerCurve(date, date).catch(() => null),
    client.getActivityIntervals(activity.id).catch(() => null),
    client.getActivityStreams(activity.id).catch(() => null),
  ])
  const base = extractActivityMetrics(activity, curve, intervals)
  if (!streams) return base
  return {
    ...base,
    ...extractStreamInsights(streams, ftp, plannedSteps, intervals),
    distributions: extractDistributions(streams, ftp, lthr, base.np, base.avg_power),
  }
}
```

Add `extractDistributions` to the import at the top of the file (line 4):

```ts
import { extractActivityMetrics, extractStreamInsights, extractDistributions } from '@/lib/claude/activity-metrics'
```

Change `enrichActivityById` (line 26) to accept and forward `lthr`:

```ts
export async function enrichActivityById(
  client: IntervalsClient,
  activityId: string,
  ftp: number | null,
  lthr: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const activity = await client.getActivity(activityId)
  return enrichActivity(client, activity, ftp, lthr, plannedSteps)
}
```

- [ ] **Step 4: Fetch LTHR and widen the predicate in `backfillActivityMetrics`**

In `lib/intervals/enrich.ts`, in `backfillActivityMetrics`: after the `const ftp = ...` line (line 53), add the LTHR fetch:

```ts
  const lthr = await client.getRideLthr().catch(() => null)
```

Change the predicate (line 62) from:

```ts
    .is('activity_metrics', null)
```
to:
```ts
    .is('activity_metrics->distributions', null)
```

Change the enrich call (line 74) to pass `lthr`:

```ts
      const metrics = await enrichActivityById(client, row.icu_activity_id, ftp, lthr, row.steps)
```

- [ ] **Step 5: Run the tests**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: PASS (existing 2 cases + 2 new). The existing `np`/`elevation_m`/`decoupling_pct` assertions still hold because the base metrics are unchanged.

- [ ] **Step 6: Verify types across the change**

Run: `npx tsc --noEmit`
Expected: PASS. (No other callers of `enrichActivity`/`enrichActivityById` exist — confirmed: only `backfillActivityMetrics` uses them.)

- [ ] **Step 7: Commit**

```bash
git add lib/intervals/enrich.ts __tests__/lib/enrich.test.ts
git commit -m "feat: compute distributions at enrich; widen backfill to fill missing distributions"
```

---

## Task 6: Wire distribution text into the coach surfaces

**Files:**
- Modify: `app/api/feedback/route.ts` (the `rideExecution` block, lines 74–78)
- Modify: `app/api/briefing/today/route.ts` (the `execution` array, lines 122–137)
- Modify: `lib/claude/session-chat.ts` (`buildSessionSystemPrompt`)
- Test: `__tests__/lib/session-chat.test.ts` (add a case)

- [ ] **Step 1: Write the failing session-chat test**

In `__tests__/lib/session-chat.test.ts`, add a case asserting the distribution text appears when the workout carries distributions. Use the existing test's workout factory/shape; add:

```ts
  it('includes the session distribution summary when the completed workout has one', () => {
    const workout = {
      id: 'w1', date: '2026-06-07', type: 'threshold', duration_minutes: 60,
      description: '2x20 threshold', steps: null, status: 'completed',
      activity_metrics: {
        np: 240, avg_power: 230, max_power: 600, avg_hr: 150, distance_m: 30000,
        elevation_m: 200, lr_balance: 50, best_efforts: null, intervals: null,
        decoupling_pct: null, climbs: null, time_in_zone: null, shape: null,
        synced_at: '2026-06-07T10:00:00Z',
        distributions: {
          power: [{ edge: 100, secs: 1200 }], power_vi: 1.04, power_steady_pct: 61,
          cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
        },
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = buildSessionSystemPrompt(workout as any, null, [], null, 250, [])
    expect(prompt).toContain('Power shape: VI 1.04')
  })
```

(If the existing test file already imports `buildSessionSystemPrompt`, reuse that import; otherwise add `import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'`.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest __tests__/lib/session-chat.test.ts -t distribution`
Expected: FAIL — the prompt does not contain the distribution text.

- [ ] **Step 3: Wire `formatDistributions` into `buildSessionSystemPrompt`**

In `lib/claude/session-chat.ts`, add the import:

```ts
import { formatDistributions } from '@/lib/claude/activity-metrics'
```

Inside `buildSessionSystemPrompt`, compute the text just before the `return \`...\`` (e.g. after the `weekSection`/`eventsSection` definitions, ~line 66):

```ts
  const distributionSection = formatDistributions(workout.activity_metrics?.distributions ?? null)
```

Then in the prompt template, insert it immediately after the `Target zones:` line in the `TODAY'S SESSION:` block (currently line 76). Change:

```ts
Target zones: ${workout.target_zones}

ATHLETE STATE:
```
to:
```ts
Target zones: ${workout.target_zones}
${distributionSection ? '\n' + distributionSection + '\n' : ''}
ATHLETE STATE:
```

- [ ] **Step 4: Wire `formatDistributions` into the feedback route**

In `app/api/feedback/route.ts`, update the dynamic import (line 74) and the `rideExecution` array (lines 75–78):

```ts
  const { formatRideExecution, formatRideShape, formatDistributions } = await import('@/lib/claude/activity-metrics')
  const rideExecution = [
    formatRideExecution(w.steps, w.activity_metrics),
    formatRideShape(w.activity_metrics?.shape ?? null),
    formatDistributions(w.activity_metrics?.distributions ?? null),
  ].filter(Boolean).join('\n\n')
```

This flows into **both** `assessSession` (the coach note) and `analyseFeedback` (adaptation) with no further change.

- [ ] **Step 5: Wire `formatDistributions` into the briefing route**

In `app/api/briefing/today/route.ts`, update the dynamic import (line 122) and the `execution` array (lines 134–137):

```ts
      const { formatRideExecution, formatRideShape, formatDistributions } = await import('@/lib/claude/activity-metrics')
```
```ts
          execution: [
            formatRideExecution(steps, metrics),
            formatRideShape(metrics?.shape ?? null),
            formatDistributions(metrics?.distributions ?? null),
          ].filter(Boolean).join('\n\n') || null,
```

- [ ] **Step 6: Run the session-chat test and type-check**

Run: `npx jest __tests__/lib/session-chat.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/feedback/route.ts app/api/briefing/today/route.ts lib/claude/session-chat.ts __tests__/lib/session-chat.test.ts
git commit -m "feat: surface session distributions to feedback, briefing, and session chat"
```

---

## Task 7: `<SessionHistogram>` component

**Files:**
- Create: `components/SessionHistogram.tsx`
- Test: `__tests__/components/SessionHistogram.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/SessionHistogram.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionHistogram from '@/components/SessionHistogram'
import type { SessionDistributions } from '@/types'

const full: SessionDistributions = {
  power: [{ edge: 50, secs: 300 }, { edge: 100, secs: 900 }],
  power_vi: 1.12, power_steady_pct: 40,
  cadence: [{ edge: 80, secs: 600 }, { edge: 90, secs: 600 }],
  coasting_secs: 120,
  hr: [{ edge: 140, secs: 500 }, { edge: 160, secs: 300 }],
  hr_lthr: 158,
}

describe('SessionHistogram', () => {
  it('renders nothing when distributions is null', () => {
    const { container } = render(<SessionHistogram distributions={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only tabs that have data', () => {
    render(<SessionHistogram distributions={{ ...full, cadence: null, hr: null }} />)
    expect(screen.getByRole('button', { name: /power/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cadence/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /hr/i })).toBeNull()
  })

  it('defaults to the power chart and shows its summary line', () => {
    render(<SessionHistogram distributions={full} />)
    expect(screen.getByText(/VI 1.12/)).toBeInTheDocument()
    expect(screen.getByText(/40% within ±5% NP/)).toBeInTheDocument()
  })

  it('switches to cadence when its tab is pressed', async () => {
    render(<SessionHistogram distributions={full} />)
    await userEvent.click(screen.getByRole('button', { name: /cadence/i }))
    expect(screen.getByText(/Coasted 2 min/)).toBeInTheDocument()
  })

  it('shows the LTHR summary on the HR tab (zone-overlaid)', async () => {
    render(<SessionHistogram distributions={full} />)
    await userEvent.click(screen.getByRole('button', { name: /hr/i }))
    expect(screen.getByText(/LTHR 158 bpm/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest __tests__/components/SessionHistogram.test.tsx`
Expected: FAIL — cannot find module `@/components/SessionHistogram`.

- [ ] **Step 3: Implement the component**

Create `components/SessionHistogram.tsx`. It renders bars from the persisted bins (no recompute), with a segmented toggle showing only populated channels, zone bands behind power (and HR when `hr_lthr` set), and the distilled summary line under each chart. Reuses `SectionCard` from `RideStats`.

```tsx
'use client'
import { useState } from 'react'
import type { SessionDistributions, DistributionBin } from '@/types'
import { SectionCard } from './RideStats'

type Channel = 'power' | 'cadence' | 'hr'

// Power %FTP zone band edges (CLAUDE.md): Z1<55, Z2 56–75, Z3 76–90, Z4 91–105, Z5 106–120, Z6 >120.
const POWER_ZONES: Array<{ from: number; to: number; cls: string }> = [
  { from: 0, to: 55, cls: 'bg-slate-100' },
  { from: 55, to: 75, cls: 'bg-sky-100' },
  { from: 75, to: 90, cls: 'bg-emerald-100' },
  { from: 90, to: 105, cls: 'bg-amber-100' },
  { from: 105, to: 120, cls: 'bg-orange-100' },
  { from: 120, to: 1000, cls: 'bg-rose-100' },
]

// HR zone bands as a fraction of LTHR (Friel-style, adapted for cycling LTHR):
// Z1 <81%, Z2 81–89%, Z3 90–93%, Z4 94–99%, Z5 ≥100%.
const HR_ZONES: Array<{ to: number; cls: string }> = [
  { to: 0.81, cls: 'bg-slate-100' },
  { to: 0.90, cls: 'bg-sky-100' },
  { to: 0.94, cls: 'bg-emerald-100' },
  { to: 1.00, cls: 'bg-amber-100' },
  { to: Infinity, cls: 'bg-rose-100' },
]
const hrBand = (edge: number, lthr: number): string =>
  (HR_ZONES.find(z => edge / lthr < z.to) ?? HR_ZONES[HR_ZONES.length - 1]).cls

function Bars({ bins, width, barClass, bandFor }: {
  bins: DistributionBin[]
  width: number
  barClass: string
  bandFor?: (edge: number) => string | null
}) {
  const max = Math.max(...bins.map(b => b.secs), 1)
  return (
    <div className="flex items-end gap-px h-32 px-1" role="img" aria-label="distribution histogram">
      {bins.map(b => (
        <div key={b.edge} className="flex-1 flex flex-col justify-end relative" title={`${b.edge}–${b.edge + width}: ${Math.round(b.secs / 60)}min`}>
          {bandFor && <div className={`absolute inset-0 ${bandFor(b.edge) ?? ''}`} />}
          <div className={`relative ${barClass} rounded-t`} style={{ height: `${(b.secs / max) * 100}%` }} />
        </div>
      ))}
    </div>
  )
}

export default function SessionHistogram({ distributions }: { distributions: SessionDistributions | null }) {
  const available: Channel[] = []
  if (distributions?.power?.length) available.push('power')
  if (distributions?.cadence?.length) available.push('cadence')
  if (distributions?.hr?.length) available.push('hr')

  const [channel, setChannel] = useState<Channel>(available[0] ?? 'power')
  if (!distributions || available.length === 0) return null
  const active = available.includes(channel) ? channel : available[0]

  const label: Record<Channel, string> = { power: 'Power', cadence: 'Cadence', hr: 'HR' }

  const powerBand = (edge: number): string | null =>
    POWER_ZONES.find(z => edge >= z.from && edge < z.to)?.cls ?? null

  let summary = ''
  if (active === 'power' && distributions.power_vi !== null) {
    summary = `VI ${distributions.power_vi.toFixed(2)}` +
      (distributions.power_steady_pct !== null ? ` · ${distributions.power_steady_pct}% within ±5% NP` : '')
  } else if (active === 'cadence' && distributions.coasting_secs && distributions.coasting_secs >= 60) {
    summary = `Coasted ${Math.round(distributions.coasting_secs / 60)} min`
  } else if (active === 'hr') {
    summary = distributions.hr_lthr !== null ? `LTHR ${distributions.hr_lthr} bpm` : 'Raw bpm (no LTHR set)'
  }

  return (
    <SectionCard title="Distribution" accent="bg-violet-400">
      <div className="p-3 space-y-2">
        <div className="flex gap-1">
          {available.map(c => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-colors ${
                active === c ? 'bg-violet-500 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {label[c]}
            </button>
          ))}
        </div>

        {active === 'power' && distributions.power && (
          <Bars bins={distributions.power} width={5} barClass="bg-orange-400" bandFor={powerBand} />
        )}
        {active === 'cadence' && distributions.cadence && (
          <Bars bins={distributions.cadence} width={10} barClass="bg-violet-400" />
        )}
        {active === 'hr' && distributions.hr && (
          <Bars
            bins={distributions.hr}
            width={5}
            barClass="bg-red-400"
            bandFor={distributions.hr_lthr !== null ? (edge) => hrBand(edge, distributions.hr_lthr!) : undefined}
          />
        )}

        <p className="text-xs text-gray-500 text-center">
          {active === 'power' ? 'by % FTP' : active === 'cadence' ? 'by rpm' : 'by bpm'}
          {summary && <span className="font-semibold text-gray-600"> · {summary}</span>}
        </p>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest __tests__/components/SessionHistogram.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/SessionHistogram.tsx __tests__/components/SessionHistogram.test.tsx
git commit -m "feat: SessionHistogram — toggle power/cadence/HR distribution chart"
```

---

## Task 8: Mount the histogram in the session detail

**Files:**
- Modify: `components/WorkoutDetailModal.tsx` (import line 6 area; Stats tab block lines 392–396)

- [ ] **Step 1: Add the import**

In `components/WorkoutDetailModal.tsx`, after the `RideStats` import (line 6), add:

```ts
import SessionHistogram from './SessionHistogram'
```

- [ ] **Step 2: Render it under the Stats tab**

In the `tab === 'stats'` block (lines 392–396), add the histogram after `<RideStats>`:

```tsx
          {hasRide && tab === 'stats' && (
            workout.activity_metrics
              ? <>
                  <RideStats data={rideStatsFromMetrics(workout.activity_metrics, workout.duration_minutes * 60, workout.tss)} />
                  <SessionHistogram distributions={workout.activity_metrics.distributions} />
                </>
              : <p className="text-sm text-slate-400 italic">Ride stats not available yet.</p>
          )}
```

- [ ] **Step 3: Verify types and the existing modal test**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS (the histogram renders null for fixtures without `distributions`, so existing assertions are unaffected).

- [ ] **Step 4: Run the full suite**

Run: `npx jest`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add components/WorkoutDetailModal.tsx
git commit -m "feat: show SessionHistogram under the ride Stats tab"
```

- [ ] **Step 6: Manual verification**

1. Trigger a sync (`POST /api/sync`) so `backfillActivityMetrics` recomputes recent rides — confirm `workouts.activity_metrics->distributions` is now populated for a recent completed ride.
2. Open that ride in `WorkoutDetailModal` → **Stats** tab → confirm the **Distribution** card shows, the Power/Cadence/HR toggle only offers channels with data, bars render, and the summary line (VI / coasting / LTHR) reads correctly.
3. On a ride with no LTHR in intervals.icu, confirm HR still renders (raw bpm, no zone bands) and the summary says "Raw bpm (no LTHR set)".
4. Log feedback on a completed ride → confirm the coach note references execution detail (the distribution text is now in its context).

---

## Notes for the implementer

- **No DB migration.** `activity_metrics` is a JSON column; the new `distributions` key rides along. Old rows show no chart until the widened backfill recomputes them (25/run, newest first).
- **Zones bucket against current FTP/LTHR** at compute time — the same caveat the existing `time_in_zone`/`shape` code already carries. Acceptable.
- **Routes aren't unit-tested** (feedback/briefing). Their wiring mirrors the existing `formatRideExecution`/`formatRideShape` lines, which are likewise covered only by the pure-function tests + manual verification. The pure functions (`extractDistributions`, `formatDistributions`) and `buildSessionSystemPrompt` carry the test weight.
- **DRY:** the chart's summary line and the coach text both derive from the same stored `power_vi`/`power_steady_pct`/`coasting_secs`/`hr_lthr` values — no divergent recomputation.
