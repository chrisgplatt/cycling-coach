import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep, ICUEvent, ICUPowerCurvePoint, ActivityInterval, RideStreams } from '@/types'
import { normaliseStreams } from './streams'

const BASE = 'https://intervals.icu/api/v1'

interface CreateEventParams {
  date: string             // YYYY-MM-DD
  name: string
  description: string
  duration_minutes: number
  steps?: WorkoutStep[]
  note?: string            // short coach note shown on the head unit (≤200 chars, trimmed)
}

// Garmin caps the workout note shown on the head unit at ~200 characters. Trim a longer
// coach note to fit, breaking on a word boundary and marking the cut with an ellipsis.
const NOTE_MAX_CHARS = 200
export function truncateNote(note: string): string {
  const t = note.trim().replace(/\s+/g, ' ')
  if (t.length <= NOTE_MAX_CHARS) return t
  const cut = t.slice(0, NOTE_MAX_CHARS - 1)        // leave room for the ellipsis
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

// Compose the intervals.icu event description: an optional short coach note first (this
// is what surfaces as the workout note on the head unit), then the prose, then the
// structured step notation after a separator.
function composeEventDescription(note: string | undefined, description: string, steps?: WorkoutStep[]): string {
  const head = note?.trim() ? `${truncateNote(note)}\n\n${description}` : description
  return steps?.length ? `${head}\n\n---\n\n${buildWorkoutNotation(steps)}` : head
}

// A short open-ended hold appended after a timed warm-up or recovery so the rider
// rides the planned time and then presses the lap button to continue. The nominal
// duration is a small placeholder — `press lap` ignores it, so the step ends only
// on the lap press, never when these 10s elapse. Power matches the step it gates so
// there is no jarring target change while the rider waits.
const LAP_GATE_DURATION = '10s'
function lapGate(power_pct_ftp: number): string {
  return `- ${LAP_GATE_DURATION} ${power_pct_ftp}% press lap`
}

// A recovery worth gating sits in Z1–Z2 (≤75% FTP); the effort that follows it must
// be a genuine hard interval (≥80% FTP) to warrant a "press lap to start" prompt.
// The gap between the two thresholds is deliberate — it keeps over/under "under" legs
// (90–95% FTP) out of the recovery bucket and keeps a cool-down (which follows the
// final recovery) from being treated as the next hard effort.
const RECOVERY_GATE_MAX_PCT = 75
const WORK_AFTER_MIN_PCT = 80

// Is step k an easy recovery sitting immediately before a hard effort? If so it gets
// its own lap gate so the rider rides the recovery time and then presses lap to begin
// the next interval. Crucially this is decided per-step from the surrounding powers —
// NOT from detecting an exactly-repeating work/recovery set. AI-generated reps vary by
// a watt or a minute, which broke the old repeat detection and silently dropped every
// recovery gate, so the head unit rolled straight from recovery into the next interval.
function isGatedRecovery(steps: WorkoutStep[], k: number): boolean {
  if (k <= 0 || k >= steps.length - 1) return false // never the warm-up or the last step
  return steps[k].power_pct_ftp <= RECOVERY_GATE_MAX_PCT
    && steps[k + 1].power_pct_ftp >= WORK_AFTER_MIN_PCT
}

// Converts flat WorkoutStep array to intervals.icu description text format.
// Format reference: https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701
//
// Warm-ups and interval recoveries run their planned time and THEN wait for a lap
// button press before continuing. intervals.icu's `press lap` keyword makes a step
// fully open-ended — it ignores the step duration entirely and ends only on the lap
// press (confirmed by the intervals.icu admin). So "run the time, then press lap"
// can't be a single step: each warm-up/recovery is emitted as a timed block followed
// by a short open-ended `press lap` gate (see lapGate), and that gate must live in its
// OWN block (timed step + gate, exactly the warm-up shape) — a gate buried after a work
// leg in a multi-step block advances unreliably on head units.
//
// A recovery is gated whenever it is an easy step before a hard effort (see
// isGatedRecovery), decided from the surrounding powers rather than from detecting an
// exactly-repeating set — so the gates survive the small rep-to-rep variation in
// AI-generated workouts. Steady/easy rides and over/under "under" legs are left as
// plain timed steps; the recovery that leads into the cool-down is not gated.
export function buildWorkoutNotation(steps: WorkoutStep[]): string {
  const sections: string[] = []
  let i = 0

  while (i < steps.length) {
    const s = steps[i]
    const label = s.label.toLowerCase()
    const isFirst = i === 0
    const isLast = i === steps.length - 1

    // Warmup section — timed block, then a lap gate (ride the time, then press lap)
    if (isFirst || label.includes('warm')) {
      sections.push(`Warm Up\n- ${s.duration_minutes}m ${s.power_pct_ftp}%\n${lapGate(s.power_pct_ftp)}`)
      i++; continue
    }

    // Cooldown section
    if (isLast || label.includes('cool')) {
      sections.push(`Cool Down\n- ${s.duration_minutes}m ${s.power_pct_ftp}%`)
      i++; continue
    }

    // A recovery before a hard effort → its OWN block ending in a lap gate, the same
    // proven two-line shape as the warm-up. A gate buried as the third line after the
    // work leg in a single block advances unreliably on head units; a standalone
    // timed-step-then-gate block is what actually holds for the lap press.
    if (isGatedRecovery(steps, i)) {
      sections.push(`${s.label}\n- ${s.duration_minutes}m ${s.power_pct_ftp}%\n${lapGate(s.power_pct_ftp)}`)
      i++; continue
    }

    // An effort immediately before a gated recovery is emitted on its own so the
    // recovery can be peeled into its gated block — don't fold the pair into a Main Set
    // (that would hide the recovery's gate inside a multi-step repeat).
    if (i + 1 < steps.length && isGatedRecovery(steps, i + 1)) {
      sections.push(`${s.label}\n- ${s.duration_minutes}m ${s.power_pct_ftp}%`)
      i++; continue
    }

    // Repeated (a + b) pairs with no gated recovery (e.g. over/unders) → compact Main Set
    if (i + 1 < steps.length) {
      const a = s, b = steps[i + 1]
      let reps = 1, j = i + 2
      while (
        j + 1 < steps.length &&
        steps[j].duration_minutes === a.duration_minutes &&
        steps[j].power_pct_ftp === a.power_pct_ftp &&
        steps[j + 1].duration_minutes === b.duration_minutes &&
        steps[j + 1].power_pct_ftp === b.power_pct_ftp
      ) { reps++; j += 2 }
      if (reps > 1) {
        sections.push(`Main Set ${reps}x\n- ${a.duration_minutes}m ${a.power_pct_ftp}%\n- ${b.duration_minutes}m ${b.power_pct_ftp}%`)
        i = j; continue
      }
    }

    // Repeated single steps → "Main Set Nx\n- Dm P%"
    {
      let reps = 1, j = i + 1
      while (
        j < steps.length &&
        steps[j].duration_minutes === s.duration_minutes &&
        steps[j].power_pct_ftp === s.power_pct_ftp
      ) { reps++; j++ }
      if (reps > 1) {
        sections.push(`Main Set ${reps}x\n- ${s.duration_minutes}m ${s.power_pct_ftp}%`)
        i = j; continue
      }
    }

    // Single step — use its label as the section header
    sections.push(`${s.label}\n- ${s.duration_minutes}m ${s.power_pct_ftp}%`)
    i++
  }

  return sections.join('\n\n')
}

export class IntervalsClient {
  private authHeader: string

  constructor(private athleteId: string, apiKey: string) {
    this.authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      throw new Error(`intervals.icu API error ${res.status}: ${await res.text()}`)
    }
    if (res.status === 204) return undefined as T
    return res.json()
  }

  async getAthlete(): Promise<{ ftp: number | null; weight: number | null }> {
    const data = await this.request<{ ftp?: number; weight?: number }>(
      `/athlete/${this.athleteId}`
    )
    return { ftp: data.ftp ?? null, weight: data.weight ?? null }
  }

  async updateAthleteWeight(weight: number): Promise<void> {
    await this.request(`/athlete/${this.athleteId}`, {
      method: 'PUT',
      body: JSON.stringify({ weight }),
    })
  }

  async updateRideFTP(ftp: number): Promise<void> {
    const settings = await this.request<Array<{ id: number; types: string[] }>>(
      `/athlete/${this.athleteId}/sport-settings`
    )
    const rideEntry = settings.find(s => s.types.includes('Ride'))
    if (!rideEntry) return
    await this.request(`/athlete/${this.athleteId}/sport-settings/${rideEntry.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ftp }),
    })
  }

  async getRideLthr(): Promise<number | null> {
    const settings = await this.request<Array<{ types: string[]; lthr?: number | null }>>(
      `/athlete/${this.athleteId}/sport-settings`
    )
    const ride = settings.find(s => s.types.includes('Ride'))
    return ride?.lthr ?? null
  }

  private mapActivity(a: Record<string, unknown>): ICUActivity {
    return {
      id: a.id as string,
      start_date_local: a.start_date_local as string,
      type: a.type as string,
      moving_time: a.moving_time as number,
      name: a.name as string,
      average_watts: (a.icu_average_watts ?? null) as number | null,
      max_watts: (a.p_max ?? null) as number | null,
      weighted_average_watts: (a.icu_weighted_avg_watts ?? null) as number | null,
      average_heartrate: (a.average_heartrate ?? null) as number | null,
      max_heartrate: (a.max_heartrate ?? null) as number | null,
      training_load: (a.icu_training_load ?? null) as number | null,
      rolling_ftp: (a.icu_rolling_ftp ?? null) as number | null,
      distance: (a.distance ?? null) as number | null,
      total_elevation_gain: (a.total_elevation_gain ?? null) as number | null,
      left_right_balance: (a.avg_lr_balance ?? null) as number | null,
    }
  }

  async getActivities(oldest: string, newest: string): Promise<ICUActivity[]> {
    const raw = await this.request<Record<string, unknown>[]>(
      `/athlete/${this.athleteId}/activities?oldest=${oldest}&newest=${newest}`
    )
    return raw.map(a => this.mapActivity(a))
  }

  // Single activity by id. intervals.icu exposes this as /api/v1/activity/{id}
  // (NOT under /athlete/.../activities/...), returning the full Activity object
  // with the same field names mapActivity reads from the list endpoint.
  async getActivity(activityId: string): Promise<ICUActivity> {
    const raw = await this.request<Record<string, unknown>>(
      `/activity/${activityId}`
    )
    return this.mapActivity(raw)
  }

  // Write the athlete's perceived effort + feel onto a completed activity.
  // intervals.icu activity fields: `icu_rpe` is 1–10 (higher = harder, same
  // direction as ours). `feel` is 1–5 where 1 = Strong, 2 = Good, 3 = Moderate,
  // 4 = Bad, 5 = Weak — the SAME direction as our internal scale (1 = freshest
  // 😀 → 5 = empty 😵), so feel is sent through directly with no conversion.
  async updateActivityFeel(
    activityId: string,
    p: { rpe?: number | null; feel?: number | null },
  ): Promise<void> {
    const body: Record<string, unknown> = {}
    if (p.rpe != null) body.icu_rpe = p.rpe
    if (p.feel != null) body.feel = p.feel
    if (!Object.keys(body).length) return
    await this.request(`/activity/${activityId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  // Detected intervals (laps) for one activity. intervals.icu returns these on
  // the single-activity endpoint with ?intervals=true, as an icu_intervals array.
  // Returns [] on any unexpected shape so a flaky/schema-changed response never
  // aborts a sync.
  async getActivityIntervals(activityId: string): Promise<ActivityInterval[]> {
    const data = await this.request<{ icu_intervals?: Array<Record<string, unknown>> }>(
      `/activity/${activityId}?intervals=true`
    )
    if (!Array.isArray(data?.icu_intervals)) return []
    return data.icu_intervals.map(iv => ({
      label: (iv.label ?? null) as string | null,
      duration_secs: (iv.elapsed_time ?? 0) as number,
      avg_watts: (iv.average_watts ?? null) as number | null,
      avg_hr: (iv.average_heartrate ?? null) as number | null,
    }))
  }

  // Per-second streams for one activity. intervals.icu exposes these at
  // /activity/{id}/streams as an array of { type, data } channels.
  async getActivityStreams(activityId: string): Promise<RideStreams> {
    const types = 'time,latlng,watts,heartrate,altitude,distance,cadence,velocity_smooth'
    const raw = await this.request<Array<{ type: string; data: unknown[] }>>(
      `/activity/${activityId}/streams?types=${types}`
    )
    return normaliseStreams(Array.isArray(raw) ? raw : [])
  }

  // The per-sample route as real [lat,lng] pairs. The streams `latlng` channel is
  // latitude-only for many activities, so the map comes from /activity/{id}/map,
  // whose `latlngs` array is index-aligned with the streams. Null when absent.
  async getActivityMap(activityId: string): Promise<{ latlngs: [number, number][] | null }> {
    const data = await this.request<{ latlngs?: unknown }>(`/activity/${activityId}/map`)
    const ll = data?.latlngs
    const latlngs = Array.isArray(ll) && ll.length && Array.isArray(ll[0])
      ? (ll as [number, number][])
      : null
    return { latlngs }
  }

  async getWellness(start: string, end: string): Promise<ICUWellness[]> {
    const raw = await this.request<Array<Record<string, unknown>>>(
      `/athlete/${this.athleteId}/wellness?start=${start}&end=${end}`
    )
    return raw.map(w => ({
      id: w.id as string,
      ctl: (w.ctl ?? null) as number | null,
      atl: (w.atl ?? null) as number | null,
      form: (w.form ?? null) as number | null,
      hrv: (w.hrv ?? null) as number | null,
      resting_hr: ((w.restingHR ?? w.resting_hr) ?? null) as number | null,
      sleep_secs: ((w.sleepSecs ?? w.sleep_secs) ?? null) as number | null,
      body_battery_low: ((w.BodyBatteryMin ?? w.bodyBatteryMin ?? w.bodyBatteryLow ?? w.body_battery_low) ?? null) as number | null,
      body_battery_high: ((w.BodyBatteryMax ?? w.bodyBatteryMax ?? w.bodyBatteryHigh ?? w.body_battery_high) ?? null) as number | null,
      stress_avg: (w.stress ?? null) as number | null,
      stress_high: ((w.stressHigh ?? w.stress_high) ?? null) as number | null,
      garmin_training_load: (w.atlLoad ?? null) as number | null,
      sleep_score: (w.sleepScore ?? null) as number | null,
    }))
  }

  async getEvents(oldest: string, newest: string): Promise<ICUEvent[]> {
    return this.request<ICUEvent[]>(
      `/athlete/${this.athleteId}/events?oldest=${oldest}&newest=${newest}`
    )
  }

  async getPowerCurve(oldest: string, newest: string): Promise<ICUPowerCurvePoint[]> {
    const data = await this.request<{
      secs: number[]
      curves: Array<{ watts: number[] }>
    }>(`/athlete/${this.athleteId}/activity-power-curves.json?type=Ride&oldest=${oldest}&newest=${newest}`)
    if (!data.secs?.length || !data.curves?.length) return []
    return data.secs.map((secs, i) => ({
      secs,
      watts: Math.max(...data.curves.map(c => c.watts[i] ?? 0)),
    }))
  }

  async sync(weeksBack = 6): Promise<ICUSyncData> {
    const newest = new Date().toISOString().split('T')[0]
    const oldest = new Date(Date.now() - weeksBack * 7 * 864e5).toISOString().split('T')[0]

    const [athlete, activities, wellness] = await Promise.all([
      this.getAthlete(),
      this.getActivities(oldest, newest),
      this.getWellness(oldest, newest),
    ])

    return {
      activities,
      wellness,
      athlete_ftp: athlete.ftp,
      athlete_weight: athlete.weight,
    }
  }

  async createEvent(params: CreateEventParams): Promise<string> {
    const description = composeEventDescription(params.note, params.description, params.steps)

    const body = {
      category: 'WORKOUT',
      start_date_local: `${params.date}T08:00:00`,
      name: params.name,
      description,
      type: 'Ride',
      moving_time: params.duration_minutes * 60,
    }
    const data = await this.request<{ id: number }>(
      `/athlete/${this.athleteId}/events?upsertOnUid=false`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    return String(data.id)
  }

  async createTargetEvent(params: {
    date: string
    name: string
    type: 'race' | 'sportive' | 'holiday' | 'fitness'
    priority: 'A' | 'B' | 'C'
    race_type?: string
    start_time?: string       // HH:MM
    duration_minutes?: number
    distance_km?: number
    rpe?: string
  }): Promise<string> {
    const raceCategory = { A: 'RACE_A', B: 'RACE_B', C: 'RACE_C' }[params.priority]
    const category =
      params.type === 'race' || params.type === 'sportive' ? raceCategory :
      params.type === 'fitness' ? 'TARGET' :
      params.type === 'holiday' ? 'HOLIDAY' :
      'NOTE'
    const startTime = params.start_time ? `${params.start_time}:00` : '00:00:00'
    const body: Record<string, unknown> = {
      category,
      start_date_local: `${params.date}T${startTime}`,
      name: params.name,
      type: 'Ride',
    }
    if (params.duration_minutes) body.moving_time = params.duration_minutes * 60
    if (params.distance_km) body.distance = params.distance_km * 1000
    const notes: string[] = []
    if (params.race_type) notes.push(`Race type: ${params.race_type.replace(/_/g, ' ')}`)
    if (params.rpe) notes.push(`Expected effort: ${params.rpe.replace('_', ' ')}`)
    if (notes.length) body.description = notes.join('\n')
    const data = await this.request<{ id: number }>(
      `/athlete/${this.athleteId}/events`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    return String(data.id)
  }

  async createUnavailabilityEvent(params: {
    type: import('@/types').UnavailabilityType
    start_date: string
    end_date: string
    notes?: string
  }): Promise<string> {
    const { icuCategory } = await import('@/lib/utils/unavailability')
    const label = params.type.charAt(0).toUpperCase() + params.type.slice(1)
    const body: Record<string, unknown> = {
      category: icuCategory(params.type),
      start_date_local: `${params.start_date}T00:00:00`,
      end_date_local: `${params.end_date}T23:59:59`,
      name: label,
    }
    if (params.notes) body.description = params.notes
    try {
      const data = await this.request<{ id: number }>(
        `/athlete/${this.athleteId}/events?upsertOnUid=false`,
        { method: 'POST', body: JSON.stringify(body) }
      )
      return String(data.id)
    } catch {
      // ICU may not support end_date_local — fall back to start_date only
      const fallback: Record<string, unknown> = {
        category: icuCategory(params.type),
        start_date_local: `${params.start_date}T00:00:00`,
        name: label,
      }
      if (params.notes) fallback.description = params.notes
      const data = await this.request<{ id: number }>(
        `/athlete/${this.athleteId}/events?upsertOnUid=false`,
        { method: 'POST', body: JSON.stringify(fallback) }
      )
      return String(data.id)
    }
  }

  async updateUnavailabilityEvent(eventId: string, params: {
    type: import('@/types').UnavailabilityType
    start_date: string
    end_date: string
    notes?: string
  }): Promise<void> {
    const { icuCategory } = await import('@/lib/utils/unavailability')
    const label = params.type.charAt(0).toUpperCase() + params.type.slice(1)
    const body: Record<string, unknown> = {
      category: icuCategory(params.type),
      start_date_local: `${params.start_date}T00:00:00`,
      end_date_local: `${params.end_date}T23:59:59`,
      name: label,
    }
    if (params.notes) body.description = params.notes
    try {
      await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    } catch {
      // Fall back without end_date_local
      const fallback: Record<string, unknown> = {
        category: icuCategory(params.type),
        start_date_local: `${params.start_date}T00:00:00`,
        name: label,
      }
      if (params.notes) fallback.description = params.notes
      await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify(fallback),
      })
    }
  }

  async updateEvent(eventId: string, params: Partial<CreateEventParams>): Promise<void> {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body.name = params.name
    if (params.description !== undefined) body.description = params.description
    if (params.duration_minutes !== undefined) body.moving_time = params.duration_minutes * 60
    if (params.date !== undefined) body.start_date_local = `${params.date}T08:00:00`
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async updateTargetEvent(eventId: string, params: {
    date: string
    name: string
    type: 'race' | 'sportive' | 'holiday' | 'fitness'
    priority: 'A' | 'B' | 'C'
    race_type?: string
    start_time?: string
    duration_minutes?: number
    distance_km?: number
    rpe?: string
  }): Promise<void> {
    const raceCategory = { A: 'RACE_A', B: 'RACE_B', C: 'RACE_C' }[params.priority]
    const category =
      params.type === 'race' || params.type === 'sportive' ? raceCategory :
      params.type === 'fitness' ? 'TARGET' :
      params.type === 'holiday' ? 'HOLIDAY' :
      'NOTE'
    const startTime = params.start_time ? `${params.start_time}:00` : '00:00:00'
    const body: Record<string, unknown> = {
      category,
      start_date_local: `${params.date}T${startTime}`,
      name: params.name,
      type: 'Ride',
    }
    if (params.duration_minutes) body.moving_time = params.duration_minutes * 60
    if (params.distance_km) body.distance = params.distance_km * 1000
    const notes: string[] = []
    if (params.race_type) notes.push(`Race type: ${params.race_type.replace(/_/g, ' ')}`)
    if (params.rpe) notes.push(`Expected effort: ${params.rpe.replace('_', ' ')}`)
    if (notes.length) body.description = notes.join('\n')
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async updateEventFull(eventId: string, params: {
    name: string
    description: string
    duration_minutes: number
    steps: WorkoutStep[]
    note?: string
  }): Promise<void> {
    const fullDescription = composeEventDescription(params.note, params.description, params.steps)
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: params.name,
        description: fullDescription,
        moving_time: params.duration_minutes * 60,
      }),
    })
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, { method: 'DELETE' })
  }
}
