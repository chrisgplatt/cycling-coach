import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep } from '@/types'

const BASE = 'https://intervals.icu/api/v1'

interface CreateEventParams {
  date: string             // YYYY-MM-DD
  name: string
  description: string
  duration_minutes: number
  steps?: WorkoutStep[]
}

export interface ICUEvent {
  id: string
  category: string   // 'RACE', 'WORKOUT', 'TARGET', 'HOLIDAY', etc.
  name: string
  start_date_local: string  // ISO datetime e.g. "2026-09-14T00:00:00"
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
    return this.request<ICUActivity[]>(
      `/athlete/${this.athleteId}/activities?oldest=${oldest}&newest=${newest}`
    )
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
    const data = await this.request<{ id: string }>(
      `/athlete/${this.athleteId}/events`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    return data.id
  }

  async updateEvent(eventId: string, params: Partial<CreateEventParams>): Promise<void> {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body.name = params.name
    if (params.description !== undefined) body.description = params.description
    if (params.duration_minutes !== undefined) body.moving_time = params.duration_minutes * 60
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, { method: 'DELETE' })
  }
}
