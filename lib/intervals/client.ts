import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep, ICUEvent, ICUPowerCurvePoint } from '@/types'

const BASE = 'https://intervals.icu/api/v1'

interface CreateEventParams {
  date: string             // YYYY-MM-DD
  name: string
  description: string
  duration_minutes: number
  steps?: WorkoutStep[]
}

// Converts flat WorkoutStep array to intervals.icu description text format.
// Format reference: https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701
function buildWorkoutNotation(steps: WorkoutStep[]): string {
  const sections: string[] = []
  let i = 0

  while (i < steps.length) {
    const s = steps[i]
    const label = s.label.toLowerCase()
    const isFirst = i === 0
    const isLast = i === steps.length - 1

    // Warmup section
    if (isFirst || label.includes('warm')) {
      sections.push(`Warm Up\n- ${s.duration_minutes}m ${s.power_pct_ftp}%`)
      i++; continue
    }

    // Cooldown section
    if (isLast || label.includes('cool')) {
      sections.push(`Cool Down\n- ${s.duration_minutes}m ${s.power_pct_ftp}%`)
      i++; continue
    }

    // Repeated (work + recovery) pairs → "Main Set Nx\n- Dm P%\n- Dm P%"
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

  async getActivities(oldest: string, newest: string): Promise<ICUActivity[]> {
    const raw = await this.request<Record<string, unknown>[]>(
      `/athlete/${this.athleteId}/activities?oldest=${oldest}&newest=${newest}`
    )
    return raw.map(a => ({
      id: a.id as string,
      start_date_local: a.start_date_local as string,
      type: a.type as string,
      moving_time: a.moving_time as number,
      name: a.name as string,
      average_watts: (a.icu_average_watts ?? null) as number | null,
      max_watts: (a.p_max ?? null) as number | null,
      weighted_average_watts: (a.icu_weighted_avg_watts ?? null) as number | null,
      average_heartrate: (a.average_heartrate ?? null) as number | null,
      training_load: (a.icu_training_load ?? null) as number | null,
      rolling_ftp: (a.icu_rolling_ftp ?? null) as number | null,
      distance: (a.distance ?? null) as number | null,
      total_elevation_gain: (a.total_elevation_gain ?? null) as number | null,
      left_right_balance: (a.avg_lr_balance ?? null) as number | null,
    }))
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
    const description = params.steps?.length
      ? `${params.description}\n\n---\n\n${buildWorkoutNotation(params.steps)}`
      : params.description

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
  }): Promise<string> {
    const raceCategory = { A: 'RACE_A', B: 'RACE_B', C: 'RACE_C' }[params.priority]
    const category =
      params.type === 'race' || params.type === 'sportive' ? raceCategory :
      params.type === 'fitness' ? 'TARGET' :
      params.type === 'holiday' ? 'HOLIDAY' :
      'NOTE'
    const data = await this.request<{ id: number }>(
      `/athlete/${this.athleteId}/events?upsertOnUid=false`,
      {
        method: 'POST',
        body: JSON.stringify({
          category,
          start_date_local: `${params.date}T00:00:00`,
          name: params.name,
        }),
      }
    )
    return String(data.id)
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
  }): Promise<void> {
    const raceCategory = { A: 'RACE_A', B: 'RACE_B', C: 'RACE_C' }[params.priority]
    const category =
      params.type === 'race' || params.type === 'sportive' ? raceCategory :
      params.type === 'fitness' ? 'TARGET' :
      params.type === 'holiday' ? 'HOLIDAY' :
      'NOTE'
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify({
        category,
        start_date_local: `${params.date}T00:00:00`,
        name: params.name,
      }),
    })
  }

  async updateEventFull(eventId: string, params: {
    name: string
    description: string
    duration_minutes: number
    steps: WorkoutStep[]
  }): Promise<void> {
    const fullDescription = params.steps.length
      ? `${params.description}\n\n---\n\n${buildWorkoutNotation(params.steps)}`
      : params.description
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
