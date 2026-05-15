# FTP Detection Improvement — Design Spec

**Goal:** Replace the current activity-list-based FTP guess with a scientifically grounded estimate derived from the rider's best power curve efforts over 3 months, with Claude providing plain-English context and reasoning.

**Architecture:** Fetch the intervals.icu power curve (best watts at each duration over 3 months) alongside a monthly activity summary. Pre-compute the algorithmic FTP estimate (best 20-min power × 0.95) and pass it with the trend data to Claude, whose role shifts from guessing to validating and contextualising.

**Tech Stack:** Next.js 16 App Router, intervals.icu REST API, Anthropic Claude, Supabase (unchanged)

---

## Data Layer — `lib/intervals/client.ts`

Add one new method to `IntervalsClient`:

```ts
async getPowerCurve(oldest: string, newest: string): Promise<ICUPowerCurvePoint[]>
```

Hits `GET /api/v1/athlete/{id}/power-curve?type=Ride&oldest={oldest}&newest={newest}`.

Each point in the response has at minimum `secs` (duration in seconds) and `watts` (best power at that duration). We extract three key durations:

| Duration | Seconds | Use |
|----------|---------|-----|
| 5 min | 300 | Anaerobic capacity indicator |
| 20 min | 1200 | Primary FTP signal |
| 60 min | 3600 | FTP confirmation |

Add `ICUPowerCurvePoint` to `types/index.ts`:

```ts
export interface ICUPowerCurvePoint {
  secs: number
  watts: number
}
```

---

## Claude Reasoning Layer — `lib/claude/ftp.ts`

Replace the current `predictFTP(activities, currentFTP)` signature with:

```ts
export async function predictFTP(input: FTPPredictionInput): Promise<FTPPredictionResult>

interface FTPPredictionInput {
  powerCurve: {
    mins5: number | null
    mins20: number | null
    mins60: number | null
  }
  algorithmicEstimate: number | null   // best20min * 0.95, pre-computed
  monthlyTrend: Array<{
    month: string        // e.g. "2026-03"
    rideCount: number
    peakNP: number
    totalTSS: number
  }>
  currentFTP: number
}
```

The prompt instructs Claude: the algorithm says X based on the best 20-min effort — here is how training has looked over the past 3 months — does the data support that number or does the trend suggest adjusting it?

Claude's output (`FTPPredictionResult`) is unchanged:

```ts
interface FTPPredictionResult {
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}
```

Confidence rules to convey to Claude:
- **high** — best 20-min effort exists and monthly ride counts are consistent
- **medium** — best 20-min exists but monthly volume is low or inconsistent
- **low** — no 20-min effort in the data; estimate is extrapolated from shorter durations

---

## API Route — `app/api/ftp/route.ts`

POST handler orchestration:

1. Authenticate user, load profile (unchanged)
2. Compute `oldest` = today − 91 days, `newest` = today
3. Fetch in parallel:
   - `client.getActivities(oldest, newest)` — for monthly trend summaries
   - `client.getPowerCurve(oldest, newest)` — for best efforts
4. Extract power curve bests at 300s, 1200s, 3600s
5. Compute `algorithmicEstimate = mins20 ? Math.round(mins20 * 0.95) : null`
6. Group activities into 3 calendar-month buckets (by `start_date_local` year-month), compute `rideCount`, `peakNP`, `totalTSS` per bucket
7. Call `predictFTP(input, resolvedFTP)`
8. Insert into `ftp_predictions` (schema unchanged)

No changes to the GET handler, database schema, or UI.

---

## Error Handling

- If power curve returns no data for 1200s (20-min): set `mins20: null`, `algorithmicEstimate: null`. Claude falls back to shorter efforts.
- If `getActivities` or `getPowerCurve` throws: return 502 with the error message (matches existing pattern).
- If Claude returns unparseable JSON: throw with truncated raw text (matches existing pattern).

---

## Files Changed

| File | Change |
|------|--------|
| `lib/intervals/client.ts` | Add `getPowerCurve` method |
| `types/index.ts` | Add `ICUPowerCurvePoint` type |
| `lib/claude/ftp.ts` | Replace `predictFTP` signature and prompt |
| `app/api/ftp/route.ts` | Update POST handler orchestration |
| `__tests__/lib/claude-ftp.test.ts` | Update tests for new signature |

No database migrations. No UI changes.
