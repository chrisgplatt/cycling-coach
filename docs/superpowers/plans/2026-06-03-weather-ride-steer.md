# Weather-Aware Indoor/Outdoor Ride Steer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold a same-day Open-Meteo forecast into the morning briefing so the coach can recommend an indoor (trainer) or outdoor ride based on the athlete's stored location and today's planned session.

**Architecture:** A new keyless `lib/weather/` module fetches a daily forecast and formats it for the prompt. The morning-briefing generators fetch it best-effort, pass it into the briefing `ctx`, persist it in the `daily_briefings` cache, and return it to the client. The TodayCard renders a `WeatherStrip`; Settings gains a geocoded location control. Weather is strictly additive — any failure degrades to today's behaviour with no strip.

**Tech Stack:** Next.js App Router (route handlers, `force-dynamic`), React 19 client components, TypeScript strict, Supabase, Anthropic SDK, Jest + Testing Library, Tailwind v4. Spec: `docs/superpowers/specs/2026-06-03-weather-ride-steer-design.md`.

**Conventions to follow:**
- Run a single test file with `npx jest <path>`; full suite with `npx jest`. Type gate is `npm run typecheck` (`tsc --noEmit`) — SWC/Jest skips types.
- On Windows PowerShell, `npx jest` may emit a harmless `NativeCommandError` wrapper; judge by the `Tests: N passed` line, or run via the Bash tool.
- Lib tests that touch `fetch` use `/** @jest-environment node */` and `const mockFetch = jest.fn(); global.fetch = mockFetch`.
- Metric units everywhere (°C, km/h) — matches the app's existing kg/W/km convention.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Create:**
- `lib/weather/open-meteo.ts` — `describeWeatherCode`, `fetchDailyForecast`, `geocodeLocation`
- `lib/weather/format.ts` — `formatWeatherForPrompt`
- `app/api/profile/geocode/route.ts` — server proxy for the geocoder
- `components/WeatherStrip.tsx` — presentational forecast strip
- `supabase/migrations/20260603_weather_location.sql` — `user_profile` location columns
- `supabase/migrations/20260603_briefing_weather.sql` — `daily_briefings.weather`
- `__tests__/lib/open-meteo.test.ts`, `__tests__/lib/weather-format.test.ts`
- `__tests__/api/profile-geocode.test.ts`
- `__tests__/components/WeatherStrip.test.tsx`

**Modify:**
- `types/index.ts` — `WeatherSummary`, `GeocodeMatch`, `BriefingContext.weather`, `UserProfile` location fields
- `lib/claude/briefing.ts` — `SYSTEM_MORNING` guidance + weather line in `generateMorningBriefing`
- `app/api/briefing/today/route.ts` — fetch/persist/return weather (incl. cached path)
- `app/api/cron/daily-briefing/route.ts` — fetch/persist weather
- `app/api/cron/test/route.ts` — fetch weather into ctx
- `components/TodayCard.tsx` — render `<WeatherStrip>`, carry weather through cache/fetch
- `app/settings/page.tsx` — location control
- `__tests__/lib/claude-briefing.test.ts` — weather-line + verdict-unaffected tests

---

## Task 1: Weather types + `describeWeatherCode`

**Files:**
- Modify: `types/index.ts`
- Create: `lib/weather/open-meteo.ts`
- Test: `__tests__/lib/open-meteo.test.ts`

- [ ] **Step 1: Add the types**

In `types/index.ts`, add near the other shared interfaces:

```ts
export interface WeatherSummary {
  temp_min_c: number
  temp_max_c: number
  precip_prob_pct: number   // daily max precipitation probability (0–100)
  wind_max_kph: number      // daily max sustained wind
  gust_max_kph: number      // daily max wind gust
  weather_code: number      // WMO weather interpretation code
  description: string        // human label derived from weather_code
}

export interface GeocodeMatch {
  label: string
  latitude: number
  longitude: number
}
```

In the same file, add the location fields to `UserProfile` (after `timezone?`):

```ts
  location_label?: string
  latitude?: number
  longitude?: number
```

And add to `BriefingContext` (after `today: string`):

```ts
  weather?: WeatherSummary | null
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/open-meteo.test.ts`:

```ts
/** @jest-environment node */
import { describeWeatherCode } from '@/lib/weather/open-meteo'

describe('describeWeatherCode', () => {
  it('maps representative WMO codes to labels', () => {
    expect(describeWeatherCode(0)).toBe('Clear')
    expect(describeWeatherCode(2)).toBe('Partly cloudy')
    expect(describeWeatherCode(61)).toBe('Light rain')
    expect(describeWeatherCode(65)).toBe('Heavy rain')
    expect(describeWeatherCode(71)).toBe('Light snow')
    expect(describeWeatherCode(95)).toBe('Thunderstorm')
  })

  it('returns "Unknown" for an unmapped code', () => {
    expect(describeWeatherCode(123)).toBe('Unknown')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/lib/open-meteo.test.ts`
Expected: FAIL — `describeWeatherCode` is not exported / module missing.

- [ ] **Step 4: Implement `describeWeatherCode`**

Create `lib/weather/open-meteo.ts`:

```ts
import type { WeatherSummary, GeocodeMatch } from '@/types'

const WMO_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Partly cloudy', 2: 'Partly cloudy', 3: 'Partly cloudy',
  45: 'Fog', 48: 'Fog',
  51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

export function describeWeatherCode(code: number): string {
  return WMO_LABELS[code] ?? 'Unknown'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/lib/open-meteo.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts lib/weather/open-meteo.ts __tests__/lib/open-meteo.test.ts
git commit -m "feat: weather types and WMO code labels"
```

---

## Task 2: `fetchDailyForecast`

**Files:**
- Modify: `lib/weather/open-meteo.ts`
- Test: `__tests__/lib/open-meteo.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/open-meteo.test.ts`:

```ts
import { fetchDailyForecast } from '@/lib/weather/open-meteo'

const mockFetch = jest.fn()
global.fetch = mockFetch
beforeEach(() => mockFetch.mockReset())

function dailyPayload() {
  return {
    daily: {
      time: ['2026-06-03'],
      temperature_2m_max: [14.2],
      temperature_2m_min: [8.1],
      precipitation_probability_max: [75],
      wind_speed_10m_max: [22.3],
      wind_gusts_10m_max: [38.5],
      weather_code: [65],
    },
  }
}

describe('fetchDailyForecast', () => {
  it('maps the Open-Meteo daily payload to a WeatherSummary', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => dailyPayload() })
    const w = await fetchDailyForecast(51.45, -2.58, '2026-06-03', 'Europe/London')
    expect(w).toEqual({
      temp_min_c: 8.1, temp_max_c: 14.2, precip_prob_pct: 75,
      wind_max_kph: 22.3, gust_max_kph: 38.5, weather_code: 65,
      description: 'Heavy rain',
    })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('latitude=51.45')
    expect(url).toContain('timezone=Europe%2FLondon')
    expect(url).toContain('start_date=2026-06-03')
  })

  it('treats null precipitation probability as 0', async () => {
    const p = dailyPayload()
    p.daily.precipitation_probability_max = [null] as unknown as number[]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => p })
    const w = await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')
    expect(w?.precip_prob_pct).toBe(0)
  })

  it('returns null on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')).toBeNull()
  })

  it('returns null on a malformed payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ daily: {} }) })
    expect(await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    expect(await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/open-meteo.test.ts`
Expected: FAIL — `fetchDailyForecast` not exported.

- [ ] **Step 3: Implement `fetchDailyForecast`**

Append to `lib/weather/open-meteo.ts`:

```ts
function firstNumber(arr: unknown): number | null {
  if (!Array.isArray(arr) || arr.length === 0) return null
  const v = arr[0]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function fetchDailyForecast(
  lat: number,
  lon: number,
  dateStr: string,
  tz: string,
): Promise<WeatherSummary | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code',
    timezone: tz,
    start_date: dateStr,
    end_date: dateStr,
  })
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
    if (!res.ok) return null
    const data = await res.json() as { daily?: Record<string, unknown> }
    const d = data.daily
    if (!d) return null
    const temp_max_c = firstNumber(d.temperature_2m_max)
    const temp_min_c = firstNumber(d.temperature_2m_min)
    const wind_max_kph = firstNumber(d.wind_speed_10m_max)
    const gust_max_kph = firstNumber(d.wind_gusts_10m_max)
    const weather_code = firstNumber(d.weather_code)
    if (temp_max_c === null || temp_min_c === null || wind_max_kph === null
      || gust_max_kph === null || weather_code === null) return null
    const precip_prob_pct = firstNumber(d.precipitation_probability_max) ?? 0
    return {
      temp_min_c, temp_max_c, precip_prob_pct,
      wind_max_kph, gust_max_kph, weather_code,
      description: describeWeatherCode(weather_code),
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/open-meteo.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/weather/open-meteo.ts __tests__/lib/open-meteo.test.ts
git commit -m "feat: fetchDailyForecast from Open-Meteo with null-safe parsing"
```

---

## Task 3: `geocodeLocation`

**Files:**
- Modify: `lib/weather/open-meteo.ts`
- Test: `__tests__/lib/open-meteo.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/open-meteo.test.ts`:

```ts
import { geocodeLocation } from '@/lib/weather/open-meteo'

describe('geocodeLocation', () => {
  it('maps results to GeocodeMatch with a composed label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { name: 'Bristol', admin1: 'England', country: 'United Kingdom', latitude: 51.45, longitude: -2.58 },
          { name: 'Bath', admin1: '', country: 'United Kingdom', latitude: 51.38, longitude: -2.36 },
        ],
      }),
    })
    const matches = await geocodeLocation('bristol')
    expect(matches).toEqual([
      { label: 'Bristol, England, United Kingdom', latitude: 51.45, longitude: -2.58 },
      { label: 'Bath, United Kingdom', latitude: 51.38, longitude: -2.36 },
    ])
  })

  it('returns [] when there are no results', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await geocodeLocation('zzzzzz')).toEqual([])
  })

  it('returns [] on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
    expect(await geocodeLocation('bristol')).toEqual([])
  })

  it('returns [] when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    expect(await geocodeLocation('bristol')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/open-meteo.test.ts`
Expected: FAIL — `geocodeLocation` not exported.

- [ ] **Step 3: Implement `geocodeLocation`**

Append to `lib/weather/open-meteo.ts`:

```ts
interface GeocodeApiResult {
  name?: string
  admin1?: string
  country?: string
  latitude?: number
  longitude?: number
}

export async function geocodeLocation(query: string): Promise<GeocodeMatch[]> {
  const params = new URLSearchParams({
    name: query,
    count: '5',
    language: 'en',
    format: 'json',
  })
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
    if (!res.ok) return []
    const data = await res.json() as { results?: GeocodeApiResult[] }
    if (!Array.isArray(data.results)) return []
    return data.results
      .filter(r => typeof r.latitude === 'number' && typeof r.longitude === 'number')
      .map(r => ({
        label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        latitude: r.latitude as number,
        longitude: r.longitude as number,
      }))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/open-meteo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/weather/open-meteo.ts __tests__/lib/open-meteo.test.ts
git commit -m "feat: geocodeLocation via Open-Meteo geocoding API"
```

---

## Task 4: `formatWeatherForPrompt`

**Files:**
- Create: `lib/weather/format.ts`
- Test: `__tests__/lib/weather-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/weather-format.test.ts`:

```ts
/** @jest-environment node */
import { formatWeatherForPrompt } from '@/lib/weather/format'
import type { WeatherSummary } from '@/types'

const w: WeatherSummary = {
  temp_min_c: 8.1, temp_max_c: 14.2, precip_prob_pct: 75,
  wind_max_kph: 22.3, gust_max_kph: 38.5, weather_code: 65, description: 'Heavy rain',
}

describe('formatWeatherForPrompt', () => {
  it('renders a single rounded line', () => {
    expect(formatWeatherForPrompt(w)).toBe(
      'Weather today: 8–14°C, 75% chance of rain, wind to 22 km/h gusting 39 km/h (Heavy rain).',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/weather-format.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `formatWeatherForPrompt`**

Create `lib/weather/format.ts`:

```ts
import type { WeatherSummary } from '@/types'

export function formatWeatherForPrompt(w: WeatherSummary): string {
  const r = Math.round
  return `Weather today: ${r(w.temp_min_c)}–${r(w.temp_max_c)}°C, `
    + `${r(w.precip_prob_pct)}% chance of rain, `
    + `wind to ${r(w.wind_max_kph)} km/h gusting ${r(w.gust_max_kph)} km/h `
    + `(${w.description}).`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/weather-format.test.ts`
Expected: PASS. (Note the en-dash `–` between temps, matching the implementation.)

- [ ] **Step 5: Commit**

```bash
git add lib/weather/format.ts __tests__/lib/weather-format.test.ts
git commit -m "feat: formatWeatherForPrompt one-line summary"
```

---

## Task 5: Briefing prompt — weather steer

**Files:**
- Modify: `lib/claude/briefing.ts`
- Test: `__tests__/lib/claude-briefing.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/claude-briefing.test.ts` (the `baseMorningCtx` and `mockCreate` are already defined at the top of the file):

```ts
describe('generateMorningBriefing — weather steer', () => {
  const weather = {
    temp_min_c: 8, temp_max_c: 14, precip_prob_pct: 80,
    wind_max_kph: 30, gust_max_kph: 50, weather_code: 65, description: 'Heavy rain',
  }

  it('includes the weather line in the prompt when weather is present', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"green","headline":"Go hard","note":"Take it to the trainer."}' }] })
    await generateBriefing({ ...baseMorningCtx, weather })
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('Weather today:')
    expect(prompt).toContain('Heavy rain')
  })

  it('omits the weather line when weather is null', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"green","headline":"Go hard","note":"Good to go."}' }] })
    await generateBriefing({ ...baseMorningCtx, weather: null })
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).not.toContain('Weather today:')
  })

  it('does not let weather change the parsed verdict', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"green","headline":"Go hard","note":"Dry and calm."}' }] })
    const result = await generateBriefing({ ...baseMorningCtx, weather })
    expect(result.verdict).toBe('green')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/claude-briefing.test.ts`
Expected: FAIL — prompt does not contain `Weather today:`.

- [ ] **Step 3: Implement the prompt changes**

In `lib/claude/briefing.ts`, add the import near the top (after the `formatHrvForPrompt` import):

```ts
import { formatWeatherForPrompt } from '@/lib/weather/format'
```

Append this sentence to the end of the `SYSTEM_MORNING` string (before the closing quote):

```
 When weather information is provided, weigh today's conditions against the planned session type and give a clear indoor (trainer) vs outdoor steer: precise threshold or VO2 intervals in strong wind or heavy rain favour the trainer for execution quality; easy Z2 in light rain is fine outdoors; genuinely dangerous conditions (storm, ice, heavy snow) mean trainer or reschedule. Keep this to one sentence and only raise it when conditions actually change the advice — say nothing about benign weather. Weather must NOT change the readiness verdict; the verdict reflects physiological readiness only.
```

In `generateMorningBriefing`, build a weather line and add it to the prompt. After the `unavailLine` declaration, add:

```ts
  const weatherLine = ctx.weather ? formatWeatherForPrompt(ctx.weather) : null
```

Then in the prompt template string, add a line after the `Upcoming events:` line:

```ts
${weatherLine ? weatherLine + '\n' : ''}
```

So the relevant part of the template becomes:

```ts
  const prompt = `Today's date: ${ctx.today}
Today's plan: ${sessionLine}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}
${weatherLine ? weatherLine + '\n' : ''}${unavailLine ? `Current unavailability: ${unavailLine}` : ''}
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
Write the morning briefing. Respond ONLY with a JSON object: {"verdict":"green|amber|red","headline":"<=4 words","note":"<the briefing prose>"}`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/claude-briefing.test.ts`
Expected: PASS (new block plus all existing briefing tests still green).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/briefing.ts __tests__/lib/claude-briefing.test.ts
git commit -m "feat: weather-aware indoor/outdoor steer in morning briefing prompt"
```

---

## Task 6: Migrations

**Files:**
- Create: `supabase/migrations/20260603_weather_location.sql`
- Create: `supabase/migrations/20260603_briefing_weather.sql`

No test — these are schema files applied manually by the user (same pattern as `20260603_briefing_verdict.sql`).

- [ ] **Step 1: Create the user_profile migration**

Create `supabase/migrations/20260603_weather_location.sql`:

```sql
-- Stored location for the daily weather forecast (manual, geocoded once).
alter table user_profile add column if not exists location_label text;
alter table user_profile add column if not exists latitude double precision;
alter table user_profile add column if not exists longitude double precision;
```

- [ ] **Step 2: Create the daily_briefings migration**

Create `supabase/migrations/20260603_briefing_weather.sql`:

```sql
-- Cached daily forecast summary for the morning briefing weather strip.
alter table daily_briefings add column if not exists weather jsonb;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260603_weather_location.sql supabase/migrations/20260603_briefing_weather.sql
git commit -m "feat: migrations for location and cached briefing weather"
```

---

## Task 7: Geocode API route

**Files:**
- Create: `app/api/profile/geocode/route.ts`
- Test: `__tests__/api/profile-geocode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/profile-geocode.test.ts`:

```ts
/** @jest-environment node */
import { GET } from '@/app/api/profile/geocode/route'

const mockGeocode = jest.fn()
jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/weather/open-meteo', () => ({
  geocodeLocation: (...args: unknown[]) => mockGeocode(...args),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function authedSupabase(userId: string | null) {
  return { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) } }
}
const req = (url: string) => ({ url }) as Request

beforeEach(() => {
  jest.clearAllMocks()
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(authedSupabase('u1'))
})

describe('GET /api/profile/geocode', () => {
  it('401s when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(authedSupabase(null))
    const res = await GET(req('http://x/api/profile/geocode?q=bristol') as never)
    expect(res.status).toBe(401)
  })

  it('returns empty matches when q is blank', async () => {
    const res = await GET(req('http://x/api/profile/geocode') as never)
    const body = await res.json()
    expect(body.matches).toEqual([])
    expect(mockGeocode).not.toHaveBeenCalled()
  })

  it('returns geocoder matches for a query', async () => {
    mockGeocode.mockResolvedValue([{ label: 'Bristol, England, United Kingdom', latitude: 51.45, longitude: -2.58 }])
    const res = await GET(req('http://x/api/profile/geocode?q=bristol') as never)
    const body = await res.json()
    expect(mockGeocode).toHaveBeenCalledWith('bristol')
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].label).toContain('Bristol')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/profile-geocode.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 3: Implement the route**

Create `app/api/profile/geocode/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { geocodeLocation } from '@/lib/weather/open-meteo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ matches: [] })

  const matches = await geocodeLocation(q)
  return NextResponse.json({ matches })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/profile-geocode.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/profile/geocode/route.ts __tests__/api/profile-geocode.test.ts
git commit -m "feat: /api/profile/geocode server proxy for location search"
```

---

## Task 8: Wire weather into `briefing/today` route

**Files:**
- Modify: `app/api/briefing/today/route.ts`

This route is integration-heavy and has no existing unit test (matching the codebase convention for these handlers); verify via typecheck + full suite.

- [ ] **Step 1: Add the import**

At the top of `app/api/briefing/today/route.ts`, after the `IntervalsClient` import:

```ts
import { fetchDailyForecast } from '@/lib/weather/open-meteo'
```

- [ ] **Step 2: Select location columns**

Change the profile select (around line 27) to include the location columns:

```ts
  const { data: profile } = await supabase.from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events, timezone, latitude, longitude')
    .maybeSingle()
```

- [ ] **Step 3: Extend the cached path to carry weather**

Change the cached select (around line 35-44) to include `weather` and return it:

```ts
    const { data: cached } = await supabase
      .from('daily_briefings')
      .select('coach_note, verdict, headline, weather, generated_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()
    if (cached) return NextResponse.json({
      coach_note: cached.coach_note, verdict: cached.verdict ?? null,
      headline: cached.headline ?? null, weather: cached.weather ?? null, cached: true,
    })
```

- [ ] **Step 4: Fetch the forecast on the morning path**

After `workoutCompleted` is computed (around line 110) and before the `ctx` is assembled, add:

```ts
  const lat = (profile as { latitude?: number } | null)?.latitude
  const lon = (profile as { longitude?: number } | null)?.longitude
  let weather: BriefingContext['weather'] = null
  if (!workoutCompleted && typeof lat === 'number' && typeof lon === 'number') {
    weather = await fetchDailyForecast(lat, lon, today, tz)
  }
```

- [ ] **Step 5: Add `weather` to ctx, the upsert, and the response**

Add `weather,` to the `ctx` object literal. Then change the upsert and final response:

```ts
  await supabase
    .from('daily_briefings')
    .upsert(
      { user_id: user.id, date: today, coach_note, verdict, headline, weather, generated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )

  return NextResponse.json({ coach_note, verdict, headline, weather, cached: false, ctl, atl, tsb, hrv, readiness_label: readinessLabel(tsb) })
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: all suites pass (no regressions).

- [ ] **Step 8: Commit**

```bash
git add app/api/briefing/today/route.ts
git commit -m "feat: fetch and cache weather in the on-demand briefing route"
```

---

## Task 9: Wire weather into `cron/daily-briefing` route

**Files:**
- Modify: `app/api/cron/daily-briefing/route.ts`

No unit test (matches convention); verify via typecheck + full suite.

- [ ] **Step 1: Add the import**

After the `IntervalsClient` import at the top of `app/api/cron/daily-briefing/route.ts`:

```ts
import { fetchDailyForecast } from '@/lib/weather/open-meteo'
```

- [ ] **Step 2: Select location columns**

Change the profiles select (around line 70-72) to include `latitude, longitude`:

```ts
    .select('user_id, intervals_icu_athlete_id, intervals_icu_api_key, events, unavailability, notification_time, timezone, latitude, longitude')
```

- [ ] **Step 3: Fetch the forecast before assembling ctx**

After `activeUnavailability` is computed (around line 174) and before the `ctx` object (line 176), add:

```ts
    let weather: BriefingContext['weather'] = null
    if (typeof profile.latitude === 'number' && typeof profile.longitude === 'number') {
      weather = await fetchDailyForecast(profile.latitude, profile.longitude, today, tz)
    }
```

(The cron path only ever generates the morning briefing — `workoutCompleted` is always `false` here — so no extra guard is needed.)

- [ ] **Step 4: Add `weather` to ctx and the upsert**

Add `weather,` to the `ctx` object literal. Then add `weather` to the upsert payload (around line 212):

```ts
        { user_id: profile.user_id, date: today, coach_note, verdict, headline, weather, notification_sent_at: nowISO, generated_at: nowISO },
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/cron/daily-briefing/route.ts
git commit -m "feat: fetch and persist weather in the daily briefing cron"
```

---

## Task 10: Wire weather into `cron/test` route

**Files:**
- Modify: `app/api/cron/test/route.ts`

No unit test (matches convention); verify via typecheck + full suite.

- [ ] **Step 1: Add the import**

After the `IntervalsClient` import at the top of `app/api/cron/test/route.ts`:

```ts
import { fetchDailyForecast } from '@/lib/weather/open-meteo'
```

- [ ] **Step 2: Select location columns**

Change the profile select (around line 27) to include `latitude, longitude`:

```ts
    .select('is_admin, intervals_icu_athlete_id, intervals_icu_api_key, events, timezone, latitude, longitude')
```

- [ ] **Step 3: Fetch the forecast and add to ctx**

Before the `ctx` object literal (around line 97), add:

```ts
  let weather: BriefingContext['weather'] = null
  if (typeof profile.latitude === 'number' && typeof profile.longitude === 'number') {
    weather = await fetchDailyForecast(profile.latitude, profile.longitude, today, tz)
  }
```

Then add `weather,` to the `ctx` object literal so the generated note reflects conditions during a manual test run.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/test/route.ts
git commit -m "feat: include weather in the cron test briefing context"
```

---

## Task 11: `WeatherStrip` component

**Files:**
- Create: `components/WeatherStrip.tsx`
- Test: `__tests__/components/WeatherStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/WeatherStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import WeatherStrip from '@/components/WeatherStrip'
import type { WeatherSummary } from '@/types'

const w: WeatherSummary = {
  temp_min_c: 8.1, temp_max_c: 14.2, precip_prob_pct: 75,
  wind_max_kph: 22.3, gust_max_kph: 38.5, weather_code: 65, description: 'Heavy rain',
}

describe('WeatherStrip', () => {
  it('renders temp range, rain chance and gusts', () => {
    render(<WeatherStrip weather={w} />)
    const strip = screen.getByTestId('weather-strip')
    expect(strip).toHaveTextContent('8–14°C')
    expect(strip).toHaveTextContent('75%')
    expect(strip).toHaveTextContent(/gust/i)
    expect(strip).toHaveTextContent('39')
  })

  it('shows the weather description', () => {
    render(<WeatherStrip weather={w} />)
    expect(screen.getByTestId('weather-strip')).toHaveTextContent('Heavy rain')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/WeatherStrip.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component**

Create `components/WeatherStrip.tsx`:

```tsx
import type { WeatherSummary } from '@/types'

interface Props {
  weather: WeatherSummary
}

// Emoji glyph keyed loosely to WMO code ranges.
function glyph(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  if (code <= 82) return '🌦️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

export default function WeatherStrip({ weather }: Props) {
  const r = Math.round
  return (
    <div
      data-testid="weather-strip"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2"
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-sm">{glyph(weather.weather_code)}</span>
        <span className="font-medium text-slate-600">{weather.description}</span>
      </span>
      <span>{r(weather.temp_min_c)}–{r(weather.temp_max_c)}°C</span>
      <span>{r(weather.precip_prob_pct)}% rain</span>
      <span>gusts {r(weather.gust_max_kph)} km/h</span>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/WeatherStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/WeatherStrip.tsx __tests__/components/WeatherStrip.test.tsx
git commit -m "feat: WeatherStrip forecast component"
```

---

## Task 12: Render the strip in `TodayCard`

**Files:**
- Modify: `components/TodayCard.tsx`
- Test: `__tests__/components/TodayCardBadge.test.tsx` (extend) or new assertions

`TodayCard` caches the briefing in `localStorage` and state. Carry `weather` through both, and render `<WeatherStrip>` with the coach note.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/components/TodayCardBadge.test.tsx` a test that the strip renders when the API returns weather. First inspect the existing file to match its mock setup (it already mocks `fetch` and renders `TodayCard`). Add:

```tsx
it('renders the weather strip when the briefing returns weather', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      coach_note: 'Take the intervals indoors.',
      verdict: 'green', headline: 'Go hard',
      weather: {
        temp_min_c: 8, temp_max_c: 14, precip_prob_pct: 80,
        wind_max_kph: 30, gust_max_kph: 50, weather_code: 65, description: 'Heavy rain',
      },
    }),
  })
  render(<TodayCard workout={null} wellness={null} />)
  expect(await screen.findByTestId('weather-strip')).toHaveTextContent('Heavy rain')
})
```

If `TodayCardBadge.test.tsx` uses `localStorage`, call `localStorage.clear()` in this test (or a `beforeEach`) so the cache miss forces a fetch. Match whatever the existing tests in that file already do.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/TodayCardBadge.test.tsx`
Expected: FAIL — no `weather-strip` testid.

- [ ] **Step 3: Implement the TodayCard changes**

In `components/TodayCard.tsx`:

Add the imports:

```ts
import WeatherStrip from '@/components/WeatherStrip'
import type { Workout, ICUWellness, TrainingEvent, WeatherSummary } from '@/types'
```

(Extend the existing `@/types` import rather than duplicating it.)

Add state alongside `verdict`/`headline`:

```ts
  const [weather, setWeather] = useState<WeatherSummary | null>(null)
```

In `fetchNote`, in the cached branch (after `setHeadline(cached.headline ?? null)`), add:

```ts
            setWeather(cached.weather ?? null)
```

In the fetch-success branch (after `setHeadline(data.headline ?? null)`), add:

```ts
        setWeather(data.weather ?? null)
```

And include `weather` in the `localStorage.setItem` payload:

```ts
          localStorage.setItem(BRIEFING_CACHE_KEY, JSON.stringify({
            date: today,
            coach_note: data.coach_note,
            verdict: data.verdict ?? null,
            headline: data.headline ?? null,
            weather: data.weather ?? null,
            workoutCompleted: isCompleted,
          }))
```

In the coach-note block (after the `ReadinessBadge` render, before the loading/coachNote paragraph), render the strip:

```tsx
        {!loading && weather && <WeatherStrip weather={weather} />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/TodayCardBadge.test.tsx`
Expected: PASS (new test plus existing badge tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/TodayCard.tsx __tests__/components/TodayCardBadge.test.tsx
git commit -m "feat: render weather strip on the today card"
```

---

## Task 13: Settings location control

**Files:**
- Modify: `app/settings/page.tsx`
- Test: `__tests__/app/settings/page.test.tsx`

A "Location for weather" section: text input + Find button → `/api/profile/geocode?q=` → selectable matches → stores `location_label`, `latitude`, `longitude` on save. Shows the saved location with a Clear action.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/app/settings/page.test.tsx`:

```tsx
it('shows the location search input', () => {
  render(<SettingsPage />)
  expect(screen.getByPlaceholderText(/town or city/i)).toBeInTheDocument()
})
```

(The file already mocks `global.fetch` to return a profile; the new field renders regardless.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/settings/page.test.tsx`
Expected: FAIL — placeholder not found.

- [ ] **Step 3: Add location state and load**

In `app/settings/page.tsx`, add state near the other `useState` hooks:

```ts
  const [locationLabel, setLocationLabel] = useState('')
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [savedLocationLabel, setSavedLocationLabel] = useState('')
  const [locationQuery, setLocationQuery] = useState('')
  const [geoMatches, setGeoMatches] = useState<Array<{ label: string; latitude: number; longitude: number }> | null>(null)
  const [geoSearching, setGeoSearching] = useState(false)
```

Add location to `isDirty`:

```ts
  const isDirty = fullName !== savedFullName || athleteId !== savedAthleteId || apiKey !== savedApiKey || notifTime !== savedNotifTime || timezone !== savedTimezone || locationLabel !== savedLocationLabel
```

In the load `useEffect` (inside the `.then(data => { ... })`), add:

```ts
        const loc = data.location_label ?? ''
        setLocationLabel(loc); setSavedLocationLabel(loc)
        setLatitude(typeof data.latitude === 'number' ? data.latitude : null)
        setLongitude(typeof data.longitude === 'number' ? data.longitude : null)
```

- [ ] **Step 4: Add the search + select handlers**

Add these functions inside the component (near `save`):

```ts
  async function searchLocation() {
    if (!locationQuery.trim()) return
    setGeoSearching(true)
    setGeoMatches(null)
    try {
      const res = await fetch(`/api/profile/geocode?q=${encodeURIComponent(locationQuery.trim())}`)
      const data = await res.json()
      setGeoMatches(data.matches ?? [])
    } catch {
      setGeoMatches([])
    } finally {
      setGeoSearching(false)
    }
  }

  function selectLocation(m: { label: string; latitude: number; longitude: number }) {
    setLocationLabel(m.label)
    setLatitude(m.latitude)
    setLongitude(m.longitude)
    setGeoMatches(null)
    setLocationQuery('')
  }

  function clearLocation() {
    setLocationLabel('')
    setLatitude(null)
    setLongitude(null)
    setGeoMatches(null)
    setLocationQuery('')
  }
```

- [ ] **Step 5: Include location in the save body**

In `save`, extend both branches of the `body` to include the location fields, and update the saved-state setters in the success path:

```ts
      const locationFields = { location_label: locationLabel || null, latitude, longitude }
      const body = profileId
        ? { id: profileId, full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone, ...locationFields }
        : { full_name: fullName, intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, notification_time: notifTime, timezone, ...locationFields }
```

And in the `else` (success) block, after `setSavedTimezone(timezone)`:

```ts
        setSavedLocationLabel(locationLabel)
```

- [ ] **Step 6: Add the UI section**

Add a new `<section>` inside the "Daily Briefing" section (after the timezone field's closing `</div>`, before the push-notifications row), or as its own section directly after the Daily Briefing `</section>`:

```tsx
      <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Location for weather</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          Used to forecast today's conditions and advise indoor vs outdoor riding.
          Search for your town or city.
        </p>
        {savedLocationLabel && !geoMatches && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <span className="text-sm text-slate-700">{locationLabel}</span>
            <button
              onClick={clearLocation}
              className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors shrink-0"
            >
              Clear
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={locationQuery}
            onChange={e => setLocationQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchLocation() } }}
            placeholder="Town or city (e.g. Bristol)"
            className={inputClass}
          />
          <button
            onClick={searchLocation}
            disabled={geoSearching || !locationQuery.trim()}
            className="shrink-0 text-sm font-medium bg-slate-800 text-white px-4 py-2.5 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
          >
            {geoSearching ? '…' : 'Find'}
          </button>
        </div>
        {geoMatches && geoMatches.length === 0 && (
          <p className="text-xs text-amber-600">No matches — try a nearby town or city name.</p>
        )}
        {geoMatches && geoMatches.length > 0 && (
          <div className="space-y-1.5">
            {geoMatches.map((m, i) => (
              <button
                key={i}
                onClick={() => selectLocation(m)}
                className="w-full text-left text-sm text-slate-700 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        {locationLabel && locationLabel !== savedLocationLabel && (
          <p className="text-xs text-emerald-600">Selected: {locationLabel} — press Save to apply.</p>
        )}
      </section>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest __tests__/app/settings/page.test.tsx`
Expected: PASS (new test plus existing account-page tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 10: Commit**

```bash
git add app/settings/page.tsx __tests__/app/settings/page.test.tsx
git commit -m "feat: location search control in settings for weather forecast"
```

---

## Final verification

- [ ] Run `npx jest` — all suites green.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Confirm the two migrations are listed for the user to apply (`20260603_weather_location.sql`, `20260603_briefing_weather.sql`).
- [ ] Manual smoke (post-merge, after migrations + a saved location): open Settings, search a town, select, Save; open the dashboard and confirm the weather strip renders with the morning briefing and the coach note references conditions when relevant.
```
