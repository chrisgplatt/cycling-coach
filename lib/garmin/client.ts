import { GarminConnect } from 'garmin-connect'
import type { IGarminTokens } from 'garmin-connect/dist/garmin/types'

const GARMIN_API = 'https://connectapi.garmin.com'

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

  async getTrainingReadiness(date: string): Promise<number | null> {
    try {
      const url = `${GARMIN_API}/metrics-service/metrics/trainingreadiness/${date}`
      const data = await this._gc.get(url) as unknown
      if (!Array.isArray(data) || data.length === 0) return null
      const first = data[0] as Record<string, unknown>
      const score = first.score
      return typeof score === 'number' ? score : null
    } catch {
      return null
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

  async getBodyBatteryCurrent(date: string): Promise<number | null> {
    try {
      const url = `${GARMIN_API}/wellness-service/wellness/bodyBattery/reports/daily`
      const data = await this._gc.get(url, { params: { startDate: date, endDate: date } }) as unknown
      if (!Array.isArray(data) || data.length === 0) return null
      const day = data[0] as Record<string, unknown>
      const arr = day?.bodyBatteryValuesArray as Array<[number, number]> | undefined
      if (!Array.isArray(arr) || arr.length === 0) return null
      const last = arr[arr.length - 1]
      return typeof last[1] === 'number' ? last[1] : null
    } catch {
      return null
    }
  }

  async getDailyStressAvg(date: string): Promise<number | null> {
    try {
      const url = `${GARMIN_API}/wellness-service/wellness/dailyStress/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const val = data?.avgStressLevel
      return typeof val === 'number' ? val : null
    } catch {
      return null
    }
  }
}
