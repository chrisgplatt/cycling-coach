# Ride Weather Impact Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each completed GPS ride, compute a myWindsock-style weather impact analysis (headwind %, tailwind %, crosswind %, air speed, weather impact %) and surface it on workout cards, the ride detail modal, and the daily coach briefing.

**Architecture:** A pure computation library (`lib/weather/activity-weather.ts`) fetches the GPS track from intervals.icu and historical weather from open-meteo's free archive API, computes headwind analysis, and caches results in a new `activity_weather` Supabase table. A lazy-compute pattern means the API endpoint returns cached data instantly on repeat views, while a fire-and-forget post-sync pass pre-warms the cache for recently completed rides.

**Tech Stack:** TypeScript, Next.js App Router, Supabase (RLS), open-meteo archive API (free, no key), intervals.icu `getActivityMap()` for GPS tracks, Jest for unit tests.

## Global Constraints

- Mobile-first UI: every new component must work at 375px width; use `text-[10px]`/`text-[11px]` for chip labels (matches existing pattern in `DayWeatherChip`).
- Auth-gated API routes: follow the pattern in `app/api/weather/week/route.ts` — call `supabase.auth.getUser()` and return 401 if no user.
- No new npm packages — use only existing dependencies.
- `activity_id` is the intervals.icu activity ID (type `string`, same as `ICUActivity.id`).
- The open-meteo **archive** API host is `archive-api.open-meteo.com` (not `api.open-meteo.com`).
- Do NOT commit throwaway scripts or Supabase service keys.
- TypeScript strict — no implicit `any`.

---

## File Map

| Path | Action | Purpose |
|------|--------|---------|
| `types/index.ts` | Modify | Add `ActivityWeather` interface; add `completedRideWeather` to `BriefingContext` |
| `lib/weather/activity-weather.ts` | Create | Pure computation + async orchestrator |
| `app/api/weather/activity/[activityId]/route.ts` | Create | Cache-first REST endpoint |
| `components/ActivityWeatherPanel.tsx` | Create | Full breakdown UI for modal |
| `components/WorkoutCard.tsx` | Modify | Add optional `weather` prop + compact chip |
| `components/WorkoutDetailModal.tsx` | Modify | Fetch + show `ActivityWeatherPanel` |
| `app/dashboard/page.tsx` | Modify | Fetch weather map for completed rides; pass to cards |
| `app/calendar/page.tsx` | Modify | Same as dashboard |
| `app/api/sync/route.ts` | Modify | Fire-and-forget pre-warm for up to 5 recent rides |
| `app/api/briefing/today/route.ts` | Modify | Fetch `completedRideWeather` when ride is completed |
| `lib/claude/briefing.ts` | Modify | Inject weather conditions into `generatePostRideNote` |
| `__tests__/lib/activity-weather.test.ts` | Create | Unit tests for computation + historical fetch |

---

## Task 1: DB migration + `ActivityWeather` type

**Files:**
- Modify: `types/index.ts` (after the `WeatherSummary` interface — search for `wind_direction_deg`)
- Manual SQL: run in Supabase SQL editor

**Interfaces:**
- Produces: `ActivityWeather` — used by Tasks 2, 4, 5, 6, 7, 8, 10

- [ ] **Step 1: Run this SQL in the Supabase SQL editor**

```sql
CREATE TABLE IF NOT EXISTS activity_weather (
  activity_id        text        PRIMARY KEY,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  temp_min_c         float,
  temp_max_c         float,
  precip_mm          float,
  wind_avg_kph       float,
  wind_dir_deg       float,
  headwind_pct       float,
  tailwind_pct       float,
  crosswind_pct      float,
  air_speed_kph      float,
  weather_impact_pct float
);

ALTER TABLE activity_weather ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows" ON activity_weather
  FOR ALL USING (user_id = auth.uid());
```

- [ ] **Step 2: Verify the table exists**

In the Supabase dashboard, navigate to Table Editor and confirm `activity_weather` appears with all columns.

- [ ] **Step 3: Add `ActivityWeather` interface to `types/index.ts`**

Find the `WeatherSummary` interface (search for `wind_direction_deg?: number`). Add the new interface immediately after it:

```ts
export interface ActivityWeather {
  activity_id:        string
  temp_min_c:         number
  temp_max_c:         number
  precip_mm:          number
  wind_avg_kph:       number
  wind_dir_deg:       number
  headwind_pct:       number
  tailwind_pct:       number
  crosswind_pct:      number
  air_speed_kph:      number
  weather_impact_pct: number
}
```

- [ ] **Step 4: Add `completedRideWeather` to `BriefingContext` in `types/index.ts`**

Find `export interface BriefingContext` (line 575). Add one field after `completedRides`:

```ts
  completedRideWeather?: ActivityWeather | null
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts
git commit -m "feat: add ActivityWeather type and activity_weather DB table"
```

---

## Task 2: Pure computation library — haversine helpers + `computeHeadwindAnalysis`

**Files:**
- Create: `lib/weather/activity-weather.ts`
- Create: `__tests__/lib/activity-weather.test.ts`

**Interfaces:**
- Consumes: `ActivityWeather` from `@/types` (Task 1)
- Produces:
  - `computeHeadwindAnalysis(params)` — pure function, exported
  - `haversineBearing` and `haversineDistance` are module-private helpers

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/activity-weather.test.ts`:

```ts
/** @jest-environment node */
import { computeHeadwindAnalysis } from '@/lib/weather/activity-weather'

describe('computeHeadwindAnalysis', () => {
  it('returns all-headwind when riding directly into wind', () => {
    // Ride north (bearing ~0°), wind FROM north (windDir 0°) → diff = 0° → headwind
    // Two points: [0,0] to [0.01,0] is roughly north
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 0, windSpeedKph: 20, avgSpeedKph: 25 })
    expect(result.headwind_pct).toBe(100)
    expect(result.tailwind_pct).toBe(0)
    expect(result.weather_impact_pct).toBeGreaterThan(0)
  })

  it('returns all-tailwind when wind is directly behind', () => {
    // Ride north (bearing ~0°), wind FROM south (windDir 180°) → diff = 180° → tailwind
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 180, windSpeedKph: 20, avgSpeedKph: 25 })
    expect(result.tailwind_pct).toBe(100)
    expect(result.headwind_pct).toBe(0)
    expect(result.weather_impact_pct).toBeLessThan(0)
  })

  it('classifies perpendicular wind as crosswind', () => {
    // Ride north, wind FROM east (90°) → diff = 90° → crosswind
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 90, windSpeedKph: 20, avgSpeedKph: 25 })
    expect(result.crosswind_pct).toBe(100)
  })

  it('percentages always sum to 100', () => {
    // Mixed route: go north then east
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 0, windSpeedKph: 15, avgSpeedKph: 20 })
    expect(result.headwind_pct + result.tailwind_pct + result.crosswind_pct).toBe(100)
  })

  it('handles fewer than 2 points gracefully', () => {
    const result = computeHeadwindAnalysis({ latlngs: [[0, 0]], windDirDeg: 0, windSpeedKph: 10, avgSpeedKph: 20 })
    expect(result.headwind_pct).toBe(0)
    expect(result.tailwind_pct).toBe(0)
    expect(result.crosswind_pct).toBe(100)
    expect(result.weather_impact_pct).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/lib/activity-weather.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '@/lib/weather/activity-weather'"

- [ ] **Step 3: Implement `lib/weather/activity-weather.ts` — pure part only**

```ts
import type { ActivityWeather } from '@/types'
import type { IntervalsClient } from '@/lib/intervals/client'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Haversine helpers (module-private)
// ---------------------------------------------------------------------------

function toRad(deg: number): number {
  return deg * Math.PI / 180
}

function haversineBearing([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function haversineDistance([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6_371_000 // metres
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lon2 - lon1)
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Returns angle between two bearings, normalised to 0–180.
function angleDiff(bearing: number, windDir: number): number {
  const raw = Math.abs(bearing - windDir) % 360
  return raw > 180 ? 360 - raw : raw
}

// ---------------------------------------------------------------------------
// computeHeadwindAnalysis — pure, no I/O
// ---------------------------------------------------------------------------

export function computeHeadwindAnalysis(params: {
  latlngs: [number, number][]
  windDirDeg: number
  windSpeedKph: number
  avgSpeedKph: number
}): {
  headwind_pct: number
  tailwind_pct: number
  crosswind_pct: number
  air_speed_kph: number
  weather_impact_pct: number
} {
  const { latlngs, windDirDeg, windSpeedKph, avgSpeedKph } = params
  if (latlngs.length < 2) {
    return { headwind_pct: 0, tailwind_pct: 0, crosswind_pct: 100,
             air_speed_kph: Math.round(avgSpeedKph * 10) / 10, weather_impact_pct: 0 }
  }

  let totalDist = 0
  let headwindDist = 0
  let tailwindDist = 0
  let weightedAirSpeed = 0
  let weightedImpact = 0

  for (let i = 0; i + 1 < latlngs.length; i++) {
    const dist = haversineDistance(latlngs[i], latlngs[i + 1])
    if (dist < 0.1) continue // skip duplicate GPS points

    const bearing = haversineBearing(latlngs[i], latlngs[i + 1])
    const diff = angleDiff(bearing, windDirDeg)

    // Positive windComponent = headwind; negative = tailwind
    const windComponent = windSpeedKph * Math.cos(toRad(diff))
    const vAir = avgSpeedKph + windComponent

    // Aerodynamic drag power scales with v_air³. Impact relative to still air.
    const impact = avgSpeedKph > 0
      ? ((Math.max(vAir, 0) ** 3 / avgSpeedKph ** 3) - 1) * 100
      : 0

    totalDist += dist
    weightedAirSpeed += vAir * dist
    weightedImpact += impact * dist

    if (diff <= 45) headwindDist += dist
    else if (diff >= 135) tailwindDist += dist
  }

  if (totalDist === 0) {
    return { headwind_pct: 0, tailwind_pct: 0, crosswind_pct: 100,
             air_speed_kph: Math.round(avgSpeedKph * 10) / 10, weather_impact_pct: 0 }
  }

  const crosswindDist = totalDist - headwindDist - tailwindDist
  const hw = Math.round((headwindDist / totalDist) * 100)
  const tw = Math.round((tailwindDist / totalDist) * 100)
  const cw = 100 - hw - tw  // guarantees sum === 100

  return {
    headwind_pct: hw,
    tailwind_pct: tw,
    crosswind_pct: cw,
    air_speed_kph: Math.round((weightedAirSpeed / totalDist) * 10) / 10,
    weather_impact_pct: Math.round((weightedImpact / totalDist) * 10) / 10,
  }
}

// Placeholder stubs — implemented in Task 3
export async function fetchHistoricalWeather(
  _lat: number, _lon: number, _dateStr: string, _rideHour: number,
): Promise<{ temp_min_c: number; temp_max_c: number; precip_mm: number; wind_avg_kph: number; wind_dir_deg: number } | null> {
  throw new Error('not yet implemented')
}

export async function fetchActivityWeather(
  _activityId: string, _userId: string, _client: IntervalsClient, _supabase: SupabaseClient,
): Promise<ActivityWeather | null> {
  throw new Error('not yet implemented')
}
```

- [ ] **Step 4: Run tests — pure computation tests should pass**

```bash
npx jest __tests__/lib/activity-weather.test.ts --no-coverage
```

Expected: PASS (all 5 `computeHeadwindAnalysis` tests)

- [ ] **Step 5: Commit**

```bash
git add lib/weather/activity-weather.ts __tests__/lib/activity-weather.test.ts
git commit -m "feat: add computeHeadwindAnalysis pure function with haversine helpers"
```

---

## Task 3: `fetchHistoricalWeather` + `fetchActivityWeather` orchestrator

**Files:**
- Modify: `lib/weather/activity-weather.ts` (replace the two placeholder stubs)
- Modify: `__tests__/lib/activity-weather.test.ts` (add historical weather tests)

**Interfaces:**
- Consumes: `IntervalsClient` from `@/lib/intervals/client`; `SupabaseClient` from `@supabase/supabase-js`
- Produces:
  - `fetchHistoricalWeather(lat, lon, dateStr, rideHour)` — exported
  - `fetchActivityWeather(activityId, userId, client, supabase)` — exported

- [ ] **Step 1: Add `fetchHistoricalWeather` tests to `__tests__/lib/activity-weather.test.ts`**

Append to the existing test file:

```ts
const mockFetch = jest.fn()
global.fetch = mockFetch
beforeEach(() => mockFetch.mockReset())

import { fetchHistoricalWeather } from '@/lib/weather/activity-weather'

function archivePayload() {
  return {
    hourly: {
      time: ['2026-06-20T00:00', '2026-06-20T01:00', '2026-06-20T12:00', '2026-06-20T13:00'],
      temperature_2m: [15.0, 14.5, 27.4, 27.8],
      wind_speed_10m: [18.0, 17.5, 21.0, 22.0],
      wind_direction_10m: [270, 268, 275, 278],
      precipitation: [0.0, 0.0, 0.0, 0.0],
    },
  }
}

describe('fetchHistoricalWeather', () => {
  it('returns conditions for the requested ride hour', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => archivePayload() })
    const result = await fetchHistoricalWeather(53.58, -2.43, '2026-06-20', 12)
    expect(result).not.toBeNull()
    expect(result!.wind_avg_kph).toBe(21.0)
    expect(result!.wind_dir_deg).toBe(275)
    // temp range covers hours 12–15 (or available end)
    expect(result!.temp_max_c).toBe(27.8)
    expect(result!.temp_min_c).toBe(27.4)
  })

  it('uses the archive API host', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => archivePayload() })
    await fetchHistoricalWeather(53.58, -2.43, '2026-06-20', 12)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('archive-api.open-meteo.com')
    expect(url).toContain('start_date=2026-06-20')
  })

  it('returns null on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await fetchHistoricalWeather(53, -2, '2026-06-20', 12)).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    expect(await fetchHistoricalWeather(53, -2, '2026-06-20', 12)).toBeNull()
  })
})
```

- [ ] **Step 2: Run new tests to confirm they fail**

```bash
npx jest __tests__/lib/activity-weather.test.ts --no-coverage -t "fetchHistoricalWeather"
```

Expected: FAIL — "not yet implemented"

- [ ] **Step 3: Replace the `fetchHistoricalWeather` stub in `lib/weather/activity-weather.ts`**

Replace the `fetchHistoricalWeather` stub with:

```ts
interface HistoricalWeatherResult {
  temp_min_c: number
  temp_max_c: number
  precip_mm: number
  wind_avg_kph: number
  wind_dir_deg: number
}

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  dateStr: string,
  rideHour: number,
): Promise<HistoricalWeatherResult | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: dateStr,
    end_date: dateStr,
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  })
  try {
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`)
    if (!res.ok) return null
    const data = await res.json() as {
      hourly?: {
        time?: string[]
        temperature_2m?: (number | null)[]
        wind_speed_10m?: (number | null)[]
        wind_direction_10m?: (number | null)[]
        precipitation?: (number | null)[]
      }
    }
    const h = data.hourly
    if (!h?.time?.length) return null

    const clamp = (i: number) => Math.max(0, Math.min(i, h.time!.length - 1))
    const hourIdx = clamp(rideHour)
    // Temp range: cover up to 3 hours of ride duration
    const endIdx = clamp(rideHour + 3)
    const temps = (h.temperature_2m ?? [])
      .slice(hourIdx, endIdx + 1)
      .filter((v): v is number => v != null)

    return {
      temp_min_c: temps.length ? Math.min(...temps) : (h.temperature_2m?.[hourIdx] ?? 0),
      temp_max_c: temps.length ? Math.max(...temps) : (h.temperature_2m?.[hourIdx] ?? 0),
      precip_mm:  h.precipitation?.[hourIdx] ?? 0,
      wind_avg_kph:  h.wind_speed_10m?.[hourIdx] ?? 0,
      wind_dir_deg:  h.wind_direction_10m?.[hourIdx] ?? 0,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Replace the `fetchActivityWeather` stub in `lib/weather/activity-weather.ts`**

Replace the `fetchActivityWeather` stub with:

```ts
export async function fetchActivityWeather(
  activityId: string,
  userId: string,
  client: IntervalsClient,
  supabase: SupabaseClient,
): Promise<ActivityWeather | null> {
  // 1. GPS track (null = indoor ride)
  const { latlngs } = await client.getActivityMap(activityId)
  if (!latlngs || latlngs.length < 2) return null

  // 2. Activity metadata for timing + speed
  const activity = await client.getActivity(activityId)
  const dateStr = activity.start_date_local.split('T')[0]
  // Parse hour from local datetime string (e.g. "2026-06-20T12:21:00")
  const rideHour = parseInt(activity.start_date_local.split('T')[1]?.split(':')[0] ?? '12', 10)
  const avgSpeedKph = activity.distance != null && activity.moving_time > 0
    ? (activity.distance / 1000) / (activity.moving_time / 3600)
    : 20  // fallback if no GPS distance

  // 3. Historical weather at start location
  const [startLat, startLon] = latlngs[0]
  const historicalWeather = await fetchHistoricalWeather(startLat, startLon, dateStr, rideHour)
  if (!historicalWeather) return null

  // 4. Headwind analysis
  const analysis = computeHeadwindAnalysis({
    latlngs,
    windDirDeg: historicalWeather.wind_dir_deg,
    windSpeedKph: historicalWeather.wind_avg_kph,
    avgSpeedKph,
  })

  // 5. Assemble + cache
  const result: ActivityWeather = {
    activity_id: activityId,
    ...historicalWeather,
    ...analysis,
  }

  await supabase.from('activity_weather').upsert(
    { ...result, user_id: userId, computed_at: new Date().toISOString() },
    { onConflict: 'activity_id' },
  )

  return result
}
```

- [ ] **Step 5: Run all activity-weather tests**

```bash
npx jest __tests__/lib/activity-weather.test.ts --no-coverage
```

Expected: PASS (all tests including `fetchHistoricalWeather`)

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add lib/weather/activity-weather.ts __tests__/lib/activity-weather.test.ts
git commit -m "feat: add fetchHistoricalWeather and fetchActivityWeather orchestrator"
```

---

## Task 4: API endpoint `GET /api/weather/activity/[activityId]`

**Files:**
- Create: `app/api/weather/activity/[activityId]/route.ts`

**Interfaces:**
- Consumes: `fetchActivityWeather` from `@/lib/weather/activity-weather` (Task 3)
- Produces: `GET /api/weather/activity/:id` → `ActivityWeather | null`

- [ ] **Step 1: Create the directory and route file**

Create `app/api/weather/activity/[activityId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchActivityWeather } from '@/lib/weather/activity-weather'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { activityId: string } },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activityId } = params

  // Cache hit — return instantly
  const { data: cached } = await supabase
    .from('activity_weather')
    .select('activity_id,temp_min_c,temp_max_c,precip_mm,wind_avg_kph,wind_dir_deg,headwind_pct,tailwind_pct,crosswind_pct,air_speed_kph,weather_impact_pct')
    .eq('activity_id', activityId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (cached) return NextResponse.json(cached)

  // Cache miss — compute
  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json(null)
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const result = await fetchActivityWeather(activityId, user.id, client, supabase)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[weather/activity] compute failed:', err)
    return NextResponse.json(null)
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Manually test the endpoint**

With the dev server running (`npm run dev`), open a browser and navigate to:
```
http://localhost:3000/api/weather/activity/<a-real-activity-id>
```
Replace `<a-real-activity-id>` with a valid activity ID visible in the app (check the URL when viewing a completed ride). Expected: JSON object with weather fields, or `null` for indoor rides.

- [ ] **Step 4: Commit**

```bash
git add "app/api/weather/activity/[activityId]/route.ts"
git commit -m "feat: add GET /api/weather/activity/[activityId] cache-first endpoint"
```

---

## Task 5: `ActivityWeatherPanel` component

**Files:**
- Create: `components/ActivityWeatherPanel.tsx`

**Interfaces:**
- Consumes: `ActivityWeather` from `@/types` (Task 1)
- Produces: `<ActivityWeatherPanel weather={w} groundSpeedKph={n} />` used in Task 7

- [ ] **Step 1: Create `components/ActivityWeatherPanel.tsx`**

```tsx
'use client'
import type { ActivityWeather } from '@/types'

// Arrow points where wind is GOING: meteorological direction + 180°
const WIND_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const
function windArrow(deg: number): string {
  return WIND_ARROWS[Math.round(((deg + 180) % 360) / 45) % 8]
}

interface Props {
  weather: ActivityWeather
  groundSpeedKph?: number | null
}

export default function ActivityWeatherPanel({ weather, groundSpeedKph }: Props) {
  const impactAbs = Math.abs(weather.weather_impact_pct)
  const isPositive = weather.weather_impact_pct > 1
  const isNegative = weather.weather_impact_pct < -1

  const impactColour = isPositive ? 'text-red-500' : isNegative ? 'text-emerald-600' : 'text-slate-500'
  const impactText = impactAbs < 1
    ? 'Negligible wind effect'
    : isPositive
      ? `+${impactAbs.toFixed(1)}% harder than still air`
      : `−${impactAbs.toFixed(1)}% easier than still air`

  return (
    <div className="space-y-2.5">
      {/* Headline */}
      <p className={`text-sm font-semibold ${impactColour}`}>{impactText}</p>

      {/* Three-segment bar */}
      <div className="flex rounded-full overflow-hidden h-3.5 bg-slate-100">
        {weather.headwind_pct > 0 && (
          <div
            className="bg-red-400 flex items-center justify-center shrink-0"
            style={{ width: `${weather.headwind_pct}%` }}
          >
            {weather.headwind_pct >= 12 && (
              <span className="text-[9px] font-bold text-white leading-none">{weather.headwind_pct}%</span>
            )}
          </div>
        )}
        {weather.crosswind_pct > 0 && (
          <div
            className="bg-amber-400 flex items-center justify-center shrink-0"
            style={{ width: `${weather.crosswind_pct}%` }}
          >
            {weather.crosswind_pct >= 12 && (
              <span className="text-[9px] font-bold text-white leading-none">{weather.crosswind_pct}%</span>
            )}
          </div>
        )}
        {weather.tailwind_pct > 0 && (
          <div
            className="bg-emerald-400 flex items-center justify-center shrink-0"
            style={{ width: `${weather.tailwind_pct}%` }}
          >
            {weather.tailwind_pct >= 12 && (
              <span className="text-[9px] font-bold text-white leading-none">{weather.tailwind_pct}%</span>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-400" />Headwind {weather.headwind_pct}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />Cross {weather.crosswind_pct}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />Tailwind {weather.tailwind_pct}%
        </span>
      </div>

      {/* Conditions row */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
        <span>{Math.round(weather.temp_min_c)}–{Math.round(weather.temp_max_c)}°C</span>
        <span className="text-slate-300">·</span>
        <span>{weather.precip_mm > 0 ? `${weather.precip_mm.toFixed(1)}mm rain` : 'No rain'}</span>
        <span className="text-slate-300">·</span>
        <span>{windArrow(weather.wind_dir_deg)} {Math.round(weather.wind_avg_kph)} km/h</span>
      </div>

      {/* Air speed vs ground speed */}
      <p className="text-xs text-slate-500">
        Air speed {weather.air_speed_kph.toFixed(1)} km/h
        {groundSpeedKph != null && groundSpeedKph > 0
          ? ` · Ground speed ${groundSpeedKph.toFixed(1)} km/h`
          : ''}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/ActivityWeatherPanel.tsx
git commit -m "feat: add ActivityWeatherPanel component with wind breakdown bar"
```

---

## Task 6: WorkoutCard compact weather chip

**Files:**
- Modify: `components/WorkoutCard.tsx`

**Interfaces:**
- Consumes: `ActivityWeather` from `@/types` (Task 1)
- Produces: `WorkoutCard` now accepts optional `weather?: ActivityWeather | null` prop

- [ ] **Step 1: Update the `Props` interface in `components/WorkoutCard.tsx`**

The current `Props` interface is at line 47:

```ts
interface Props {
  workout: Workout
  onClick?: () => void
  ftp?: number
}
```

Change to:

```ts
interface Props {
  workout: Workout
  onClick?: () => void
  ftp?: number
  weather?: import('@/types').ActivityWeather | null
}
```

- [ ] **Step 2: Update the function signature**

Change line 53:

```ts
export default function WorkoutCard({ workout, onClick, ftp }: Props) {
```

to:

```ts
export default function WorkoutCard({ workout, onClick, ftp, weather }: Props) {
```

- [ ] **Step 3: Add the wind arrow helper and weather chip JSX**

Add the wind arrow helper as a module-level constant (before the component function):

```ts
const WIND_ARROWS_CARD = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const
function cardWindArrow(deg: number): string {
  return WIND_ARROWS_CARD[Math.round(((deg + 180) % 360) / 45) % 8]
}
```

In the JSX, find the existing closing `</div>` at the end of the card body (after the `target_zones` paragraph, before `</div>` closing the outer card):

```tsx
      <div className="px-4 py-3">
        <p className="text-sm text-gray-700 leading-snug mb-1">{workout.description}</p>
        <p className="text-xs text-gray-400 font-medium">{deriveTargetZones(workout.steps, ftp) ?? workout.target_zones}</p>
      </div>
```

Change to:

```tsx
      <div className="px-4 py-3">
        <p className="text-sm text-gray-700 leading-snug mb-1">{workout.description}</p>
        <p className="text-xs text-gray-400 font-medium">{deriveTargetZones(workout.steps, ftp) ?? workout.target_zones}</p>
        {workout.status === 'completed' && weather && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap">
            <span>💨</span>
            <span>{weather.headwind_pct}% headwind</span>
            <span className="text-slate-300">·</span>
            <span>{Math.round(weather.temp_max_c)}°C</span>
            <span className="text-slate-300">·</span>
            <span className={
              Math.abs(weather.weather_impact_pct) < 1 ? 'text-slate-400'
              : weather.weather_impact_pct > 1 ? 'text-red-500'
              : 'text-emerald-600'
            }>
              {weather.weather_impact_pct > 0 ? '+' : ''}{weather.weather_impact_pct.toFixed(1)}%
            </span>
            <span className="text-slate-300">·</span>
            <span>{cardWindArrow(weather.wind_dir_deg)} {Math.round(weather.wind_avg_kph)} km/h</span>
          </div>
        )}
      </div>
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add components/WorkoutCard.tsx
git commit -m "feat: add weather chip to completed WorkoutCard"
```

---

## Task 7: WorkoutDetailModal — weather panel

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`

**Interfaces:**
- Consumes: `ActivityWeatherPanel` (Task 5); `GET /api/weather/activity/[activityId]` (Task 4)
- `WorkoutDetailModal` receives no new props — it fetches its own weather data internally

- [ ] **Step 1: Add imports to `components/WorkoutDetailModal.tsx`**

At the top of the file, add after the existing imports:

```ts
import ActivityWeatherPanel from '@/components/ActivityWeatherPanel'
import type { ActivityWeather } from '@/types'
```

- [ ] **Step 2: Add weather state inside the component**

Find the top of the `WorkoutDetailModal` component function. Add weather state alongside the existing state variables:

```ts
const [weather, setWeather] = useState<ActivityWeather | null>(null)
const [weatherLoading, setWeatherLoading] = useState(false)
```

- [ ] **Step 3: Add weather fetch effect**

After the existing state declarations, add:

```ts
useEffect(() => {
  const activityId = workout.icu_activity_id
  if (!activityId || workout.status !== 'completed') return
  setWeatherLoading(true)
  fetch(`/api/weather/activity/${activityId}`)
    .then(r => r.ok ? r.json() : null)
    .then((d: ActivityWeather | null) => { setWeather(d); setWeatherLoading(false) })
    .catch(() => setWeatherLoading(false))
}, [workout.icu_activity_id, workout.status])
```

- [ ] **Step 4: Add the weather panel to the modal JSX**

Find the section in the JSX that renders `RideStats` or the ride summary section. The exact location depends on the tab structure, but add the weather section after the ride stats block and before the coach note / feedback section. Search for the closing `</div>` after `<RideStats` or the last stats block:

Add this block:

```tsx
{/* Weather impact panel — shown for completed GPS rides */}
{workout.status === 'completed' && (weather || weatherLoading) && (
  <div className="px-4 py-3 border-t border-gray-100">
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-2">Wind Impact</p>
    {weatherLoading ? (
      <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
    ) : weather ? (
      <ActivityWeatherPanel
        weather={weather}
        groundSpeedKph={
          workout.activity_metrics
            ? (() => {
                const m = workout.activity_metrics
                // distance_km and duration_minutes are stored on activity_metrics
                return m.distance_km && workout.duration_minutes > 0
                  ? (m.distance_km / (workout.duration_minutes / 60))
                  : null
              })()
            : null
        }
      />
    ) : null}
  </div>
)}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Visual test**

Start the dev server (`npm run dev`), open the dashboard, click into a completed outdoor ride, and confirm the "Wind Impact" section appears with the breakdown bar and conditions row. For indoor rides (no GPS), it should not appear.

- [ ] **Step 7: Commit**

```bash
git add components/WorkoutDetailModal.tsx
git commit -m "feat: add wind impact panel to WorkoutDetailModal"
```

---

## Task 8: Dashboard + Calendar — fetch weather for completed rides

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/calendar/page.tsx`

**Interfaces:**
- Consumes: `GET /api/weather/activity/[activityId]` (Task 4)
- `WorkoutCard` now accepts `weather` prop (Task 6)

### Dashboard

- [ ] **Step 1: Add weather state to `app/dashboard/page.tsx`**

Find the existing imports (around line 7) and add `ActivityWeather` to the type import:

```ts
import type { ..., ActivityWeather } from '@/types'
```

Add state near the other state declarations (look for `useState` calls):

```ts
const [weatherByActivity, setWeatherByActivity] = useState<Map<string, ActivityWeather>>(new Map())
```

- [ ] **Step 2: Add weather fetch effect to `app/dashboard/page.tsx`**

After the existing `useEffect` blocks (e.g. near the weather chip fetch for the week), add:

```ts
useEffect(() => {
  const completedIds = workouts
    .filter(w => w.status === 'completed' && w.icu_activity_id)
    .map(w => w.icu_activity_id!)

  if (!completedIds.length) return

  let cancelled = false
  Promise.all(
    completedIds.map(id =>
      fetch(`/api/weather/activity/${id}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: ActivityWeather | null) => d ? [id, d] as const : null)
        .catch(() => null)
    )
  ).then(results => {
    if (cancelled) return
    const map = new Map<string, ActivityWeather>()
    for (const r of results) { if (r) map.set(r[0], r[1]) }
    setWeatherByActivity(map)
  })

  return () => { cancelled = true }
}, [workouts])
```

- [ ] **Step 3: Pass `weather` to `WorkoutCard` in `app/dashboard/page.tsx`**

Find all usages of `<WorkoutCard workout={...}` in the dashboard file. For each one where the workout could be completed, pass the weather prop. Search for `<WorkoutCard` and update each instance to add:

```tsx
weather={workout.icu_activity_id ? weatherByActivity.get(workout.icu_activity_id) ?? null : null}
```

Also update `<DraggableWorkoutCard` if it has a `workout` prop passed through to `WorkoutCard` — it already forwards `ftp` so add `weather` in the same pattern. The `DraggableWorkoutCard` component defined at the top of the file:

```tsx
function DraggableWorkoutCard({ workout, onClick, ftp, weather }: { workout: Workout; onClick: () => void; ftp?: number; weather?: import('@/types').ActivityWeather | null }) {
  // ...existing code...
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="relative">
      {/* ...existing grip bar... */}
      <WorkoutCard workout={workout} onClick={onClick} ftp={ftp} weather={weather} />
      {/* ...existing drag zone... */}
    </div>
  )
}
```

And at the call sites in the JSX, pass `weather={workout.icu_activity_id ? weatherByActivity.get(workout.icu_activity_id) ?? null : null}`.

### Calendar

- [ ] **Step 4: Apply the same pattern to `app/calendar/page.tsx`**

The calendar page also renders `WorkoutCard` components. Apply identical changes:
1. Add `ActivityWeather` to type imports
2. Add `weatherByActivity` state
3. Add the identical `useEffect` fetch (using the calendar's equivalent of `workouts` state — likely `weekWorkouts` or similar; grep for `WorkoutCard` usage in the file to find the right variable)
4. Pass `weather` prop to each `WorkoutCard` call

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Visual test**

Run `npm run dev`. On the dashboard, completed rides should show the `💨 38% headwind · 27°C · +1.4%` chip within a few seconds of page load.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/page.tsx app/calendar/page.tsx
git commit -m "feat: fetch and display weather chips on completed workout cards"
```

---

## Task 9: Sync pre-warm (fire-and-forget)

**Files:**
- Modify: `app/api/sync/route.ts`

**Interfaces:**
- Consumes: `fetchActivityWeather` from `@/lib/weather/activity-weather` (Task 3)

- [ ] **Step 1: Add the pre-warm logic to `app/api/sync/route.ts`**

Find the `return NextResponse.json({...})` near the end of the `POST` handler (currently around line 189). Add the fire-and-forget block immediately before it:

```ts
// Pre-warm weather cache for up to 5 recently-completed outdoor rides that
// don't yet have a cached row. Fire-and-forget — sync response is not delayed.
void (async () => {
  try {
    const { fetchActivityWeather } = await import('@/lib/weather/activity-weather')
    // Get the IDs of completed workouts with an icu_activity_id
    const { data: completedWorkouts } = await supabase
      .from('workouts')
      .select('icu_activity_id')
      .eq('status', 'completed')
      .not('icu_activity_id', 'is', null)
      .order('date', { ascending: false })
      .limit(20)

    if (!completedWorkouts?.length) return

    const allIds = completedWorkouts.map(w => w.icu_activity_id as string)

    // Filter to IDs not yet cached
    const { data: cached } = await supabase
      .from('activity_weather')
      .select('activity_id')
      .in('activity_id', allIds)

    const cachedSet = new Set((cached ?? []).map(r => r.activity_id as string))
    const uncached = allIds.filter(id => !cachedSet.has(id)).slice(0, 5)

    if (!uncached.length) return

    for (const activityId of uncached) {
      try {
        await fetchActivityWeather(activityId, user.id, client, supabase)
      } catch { /* non-fatal — individual failures must not abort the loop */ }
    }
  } catch { /* non-fatal — pre-warm must not affect sync response */ }
})()
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Test the pre-warm**

Trigger a sync from the dashboard. Then query Supabase directly (Table Editor → `activity_weather`) and confirm rows are being created for completed rides.

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat: pre-warm activity_weather cache in background after sync"
```

---

## Task 10: Coach briefing integration

**Files:**
- Modify: `app/api/briefing/today/route.ts`
- Modify: `lib/claude/briefing.ts`

**Interfaces:**
- Consumes: `ActivityWeather` from `@/types`; `fetchActivityWeather` from `@/lib/weather/activity-weather`; `BriefingContext.completedRideWeather` (Task 1)

### Briefing route

- [ ] **Step 1: Fetch weather for the completed ride in `app/api/briefing/today/route.ts`**

Find the block where `completedRides` is assembled (around line 149–177). Immediately after the `completedRide = completedRides[0] ?? null` line, add:

```ts
// Fetch weather for the most recent completed ride — used in post-ride briefing
let completedRideWeather: import('@/types').ActivityWeather | null = null
if (completedRide && todayWorkouts.length > 0) {
  const matchedWorkout = todayWorkouts.find(w => w.status === 'completed' && w.icu_activity_id)
  if (matchedWorkout?.icu_activity_id) {
    try {
      const { data: cachedWeather } = await supabase
        .from('activity_weather')
        .select('activity_id,temp_min_c,temp_max_c,precip_mm,wind_avg_kph,wind_dir_deg,headwind_pct,tailwind_pct,crosswind_pct,air_speed_kph,weather_impact_pct')
        .eq('activity_id', matchedWorkout.icu_activity_id)
        .eq('user_id', user.id)
        .maybeSingle()
      completedRideWeather = cachedWeather ?? null
    } catch { /* non-fatal */ }
  }
}
```

- [ ] **Step 2: Add `completedRideWeather` to the `ctx` object**

Find `const ctx: BriefingContext = {` (around line 234). Add the new field alongside the others:

```ts
completedRideWeather,
```

### Briefing prompt

- [ ] **Step 3: Update `generatePostRideNote` in `lib/claude/briefing.ts`**

Find `async function generatePostRideNote(ctx: BriefingContext)` (around line 225). In its `prompt` template string, add a weather line after the `rideStats` line:

```ts
const weatherLine = ctx.completedRideWeather
  ? (() => {
      const w = ctx.completedRideWeather!
      const impactSign = w.weather_impact_pct > 0 ? '+' : ''
      const windDirs: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
      const windDirLabel = windDirs[Math.round(w.wind_dir_deg / 45) * 45] ?? `${Math.round(w.wind_dir_deg)}°`
      return `Ride conditions: ${w.headwind_pct}% headwind (avg ${Math.round(w.wind_avg_kph)} km/h from ${windDirLabel}), ${Math.round(w.temp_max_c)}°C, net ${impactSign}${w.weather_impact_pct.toFixed(1)}% harder than still air.`
    })()
  : null
```

Then update the `prompt` template string to include `weatherLine`:

Find:

```ts
  const prompt = `Today's date: ${labelDate(ctx.today)}
Sessions today: ${sessionSummary}
Ride data: ${rideStats}
${execution ? `Planned vs actual:\n${execution}\n` : ''}Training load after ride: ${buildLoadString(ctx)}
```

Change to:

```ts
  const prompt = `Today's date: ${labelDate(ctx.today)}
Sessions today: ${sessionSummary}
Ride data: ${rideStats}
${weatherLine ? weatherLine + '\n' : ''}${execution ? `Planned vs actual:\n${execution}\n` : ''}Training load after ride: ${buildLoadString(ctx)}
```

- [ ] **Step 4: Add the prompt rule to `SYSTEM_POST_RIDE` in `lib/claude/briefing.ts`**

Find `const SYSTEM_POST_RIDE = '...'` (around line 39). Append a sentence to the existing string:

```ts
const SYSTEM_POST_RIDE = 'You are a personal cycling coach. Write a short post-ride note — 2–3 sentences maximum. The athlete has just completed their session. Reflect briefly on how the numbers look, how the session fits their current training load, and what to prioritise now (recovery, nutrition, what is coming next). If there are planned sessions in the next few days, factor them into your advice — do not tell the athlete to rest if they already have sessions scheduled; instead advise how to approach those sessions given their current fatigue. Be direct and specific, like a real coach. No markdown, no bullet points, plain text only. When ride conditions are provided, reference them if relevant — a headwind-dominated ride at near-FTP power is a stronger effort than the numbers alone suggest; a tailwind-assisted ride may look faster but cost less than it appears.'
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: PASS — no new test failures.

- [ ] **Step 7: Visual test**

Complete a ride (or mark a planned workout as completed in the app), then open the Today card and expand "Coach's note". Click "Get post-ride note". The note should reference wind conditions if the weather data is available.

- [ ] **Step 8: Commit**

```bash
git add app/api/briefing/today/route.ts lib/claude/briefing.ts
git commit -m "feat: inject ride weather conditions into post-ride coach briefing"
```
