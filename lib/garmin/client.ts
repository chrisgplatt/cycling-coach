import { GarminConnect } from 'garmin-connect'
import type { IGarminTokens } from 'garmin-connect/dist/garmin/types'

const GARMIN_API = 'https://connectapi.garmin.com'

export interface TrainingReadinessData {
  score: number | null
  recoveryTimeMins: number | null
}

export interface BodyBatteryData {
  current: number | null
  charged: number | null
  drained: number | null
}

export interface StressData {
  avg: number | null
  max: number | null
}

export class GarminClient {
  private _gc: GarminConnect

  private constructor(gc: GarminConnect) {
    this._gc = gc
  }

  static async fromToken(token: object): Promise<GarminClient> {
    const t = token as IGarminTokens
    const gc = new GarminConnect({ username: '', password: '' })
    gc.loadToken(t.oauth1, t.oauth2)
    return new GarminClient(gc)
  }

  static async fromCredentials(email: string, password: string): Promise<GarminClient> {
    const gc = new GarminConnect({ username: email, password })
    await gc.login(email, password)
    return new GarminClient(gc)
  }

  exportToken(): object {
    return this._gc.exportToken()
  }

  async getTrainingReadiness(date: string): Promise<TrainingReadinessData> {
    try {
      const url = `${GARMIN_API}/metrics-service/metrics/trainingreadiness/${date}`
      const data = await this._gc.get(url) as unknown
      if (!Array.isArray(data) || data.length === 0) return { score: null, recoveryTimeMins: null }
      const first = data[0] as Record<string, unknown>
      const score = typeof first.score === 'number' ? first.score : null
      const recoveryTimeMins = typeof first.recoveryTime === 'number' ? first.recoveryTime : null
      return { score, recoveryTimeMins }
    } catch {
      return { score: null, recoveryTimeMins: null }
    }
  }

  async getTrainingStatus(date: string): Promise<string | null> {
    try {
      const url = `${GARMIN_API}/metrics-service/metrics/trainingstatus/aggregated/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const mrt = data?.mostRecentTrainingStatus
      if (typeof mrt === 'string') return mrt
      if (mrt && typeof mrt === 'object') {
        const s = (mrt as Record<string, unknown>).trainingStatus
        return typeof s === 'string' ? s : null
      }
      return null
    } catch {
      return null
    }
  }

  async getBodyBattery(date: string): Promise<BodyBatteryData> {
    try {
      const url = `${GARMIN_API}/wellness-service/wellness/bodyBattery/reports/daily`
      const data = await this._gc.get(url, { params: { startDate: date, endDate: date } }) as unknown
      if (!Array.isArray(data) || data.length === 0) return { current: null, charged: null, drained: null }
      const day = data[0] as Record<string, unknown>
      const arr = day?.bodyBatteryValuesArray as Array<[number, number]> | undefined
      const current = Array.isArray(arr) && arr.length > 0
        ? (typeof arr[arr.length - 1][1] === 'number' ? arr[arr.length - 1][1] : null)
        : null
      const charged = typeof day.charged === 'number' ? day.charged : null
      const drained = typeof day.drained === 'number' ? Math.abs(day.drained) : null
      return { current, charged, drained }
    } catch {
      return { current: null, charged: null, drained: null }
    }
  }

  async getDailyStress(date: string): Promise<StressData> {
    try {
      const url = `${GARMIN_API}/wellness-service/wellness/dailyStress/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const avg = typeof data?.avgStressLevel === 'number' ? data.avgStressLevel : null
      const max = typeof data?.maxStressLevel === 'number' ? data.maxStressLevel : null
      return { avg, max }
    } catch {
      return { avg: null, max: null }
    }
  }
}
