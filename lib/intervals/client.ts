import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep } from '@/types'

const BASE = 'https://intervals.icu/api/v1'

interface CreateEventParams {
  date: string             // YYYY-MM-DD
  name: string
  description: string
  duration_minutes: number
  steps?: WorkoutStep[]
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
    const workout_doc = params.steps?.length
      ? {
          steps: params.steps.map(s => ({
            duration: s.duration_minutes * 60,
            power: s.power_pct_ftp / 100,  // intervals.icu uses FTP fraction (0.65 = 65%)
            cadence: s.cadence ?? null,
            rpe: null,
            text: s.label,
          })),
        }
      : undefined

    const body: Record<string, unknown> = {
      category: 'WORKOUT',
      start_date_local: `${params.date}T08:00:00`,
      name: params.name,
      description: params.description,
      type: 'Ride',
      moving_time: params.duration_minutes * 60,
    }
    if (workout_doc) body.workout_doc = workout_doc
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
