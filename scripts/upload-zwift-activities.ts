// One-time script: upload Garmin-exported Zwift activity data into intervals.icu.
// The 15 Virtual Cycling rides exist as Strava stubs in intervals.icu (no type, no
// distance/elevation/time). This script matches them by datetime and updates each stub,
// or creates a new manual activity if the update is rejected.
//
// Run: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/upload-zwift-activities.ts

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

// --- env ---

function readEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(join(process.cwd(), '.env.local'), 'utf-8')
        .split(/\r?\n/)
        .flatMap(l => { const m = l.match(/^([^=]+)=(.*)$/); return m ? [[m[1], m[2]]] : [] })
    )
  } catch { return {} }
}

const env = readEnvLocal()
const SUPABASE_URL = process.env.SUPABASE_URL ?? env['SUPABASE_URL'] ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const CSV_PATH = process.env.CSV_PATH ?? 'C:/Users/chris/Downloads/Activities (1).csv'

// --- CSV parsing ---

interface GarminRow {
  date: string          // "2026-02-16T17:03:30" (normalised)
  name: string
  distanceKm: number
  movingTimeSecs: number
  totalAscent: number   // metres
  avgHR: number | null
  maxHR: number | null
  avgWatts: number | null
  maxWatts: number | null
  np: number | null     // Normalized Power
  avgCadence: number | null
  tss: number | null
}

function parseTime(t: string): number {
  const parts = t.split(':').map(Number)
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function num(s: string): number | null {
  const clean = s.replace(/^'/, '').trim()   // strip leading apostrophe (Excel export artefact)
  const n = parseFloat(clean)
  return isNaN(n) ? null : n
}

function parseCSV(raw: string): GarminRow[] {
  const lines = raw.trim().split(/\r?\n/)
  const rows: GarminRow[] = []
  for (const line of lines.slice(1)) {
    // Simple CSV split respecting quoted fields
    const cols: string[] = []
    let inQuote = false, cur = ''
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { cols.push(cur); cur = ''; continue }
      cur += ch
    }
    cols.push(cur)

    if (cols[0] !== 'Virtual Cycling') continue

    rows.push({
      date: cols[1].trim().replace(' ', 'T'),
      name: cols[3].trim(),
      distanceKm: parseFloat(cols[4]) || 0,
      movingTimeSecs: parseTime(cols[23].trim()),
      totalAscent: parseFloat(cols[12]) || 0,
      avgHR: num(cols[7]),
      maxHR: num(cols[8]),
      avgWatts: num(cols[18]),
      maxWatts: num(cols[19]),
      np: num(cols[15]),
      avgCadence: num(cols[13]),
      tss: num(cols[16]),
    })
  }
  return rows
}

// --- intervals.icu API ---

async function icuRequest(
  athleteId: string,
  apiKey: string,
  path: string,
  opts: RequestInit = {}
): Promise<unknown> {
  const auth = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
  const res = await fetch(`https://intervals.icu/api/v1${path}`, {
    ...opts,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...opts.headers },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// --- main ---

async function main() {
  if (!SERVICE_KEY) {
    console.error('Set SUPABASE_SERVICE_ROLE_KEY env var')
    process.exit(1)
  }

  // 1. Get intervals.icu credentials from Supabase
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: profile, error } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .not('intervals_icu_athlete_id', 'is', null)
    .limit(1)
    .single()

  if (error || !profile) {
    console.error('Could not fetch profile:', error?.message)
    process.exit(1)
  }

  const { intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey } = profile
  console.log(`Using athlete ${athleteId}`)

  // 2. Parse CSV
  const csv = readFileSync(CSV_PATH, 'utf-8')
  const rows = parseCSV(csv)
  console.log(`Parsed ${rows.length} Zwift rows from CSV`)

  // 3. Fetch 2026 activities from intervals.icu (all of them)
  const today = new Date().toISOString().split('T')[0]

  // Try no-limit first to see if limit was masking an issue
  const raw = await icuRequest(athleteId, apiKey,
    `/athlete/${athleteId}/activities?oldest=2026-01-01&newest=${today}`
  ) as Array<Record<string, unknown>>

  const typeCounts: Record<string, number> = {}
  for (const a of raw) typeCounts[String(a.type ?? 'undefined')] = (typeCounts[String(a.type ?? 'undefined')] ?? 0) + 1
  console.log(`Fetched ${raw.length} total activities. Types:`, typeCounts)

  // Show the date range covered
  const dates = raw.map(a => String(a.start_date_local ?? '')).sort()
  if (dates.length) console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`)

  // 4. Match and update
  let updated = 0, created = 0, failed = 0

  for (const row of rows) {
    // Match by exact datetime across all activities (not just stubs).
    const rowMin = row.date.slice(0, 16)   // "2026-02-16T17:03"
    const stub = raw.find(a => {
      const d = String(a.start_date_local ?? '').replace(' ', 'T').slice(0, 16)
      return d === rowMin
    })
    if (stub) {
      console.log(`  → Found: id=${stub.id} type="${stub.type}" dist=${stub.distance} movingTime=${stub.moving_time}`)
    }

    const body = {
      type: 'VirtualRide',
      name: row.name,
      distance: Math.round(row.distanceKm * 1000),
      moving_time: row.movingTimeSecs,
      total_elevation_gain: row.totalAscent,
      ...(row.avgHR != null && { average_heartrate: row.avgHR }),
      ...(row.maxHR != null && { max_heartrate: row.maxHR }),
      ...(row.avgWatts != null && { average_watts: row.avgWatts }),
      ...(row.maxWatts != null && { max_watts: row.maxWatts }),
      ...(row.np != null && { icu_weighted_avg_watts: row.np }),
      ...(row.avgCadence != null && { average_cadence: row.avgCadence }),
      ...(row.tss != null && { icu_training_load: row.tss }),
    }

    if (stub) {
      const id = stub.id as string
      try {
        await icuRequest(athleteId, apiKey, `/activity/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        console.log(`  ✓ Updated stub ${id}  ${row.date}  ${row.name}`)
        updated++
      } catch (err) {
        console.log(`  ✗ PUT failed for ${id}: ${(err as Error).message}`)
        failed++
      }
    } else {
      console.log(`  ✗ No stub found for ${row.date} (${row.name})`)
      failed++
    }
  }

  console.log(`\nDone — updated: ${updated}, created: ${created}, failed: ${failed}`)
}

main().catch(e => { console.error(e); process.exit(1) })
