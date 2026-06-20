import { GarminConnect } from 'garmin-connect'
import type { IGarminTokens } from 'garmin-connect/dist/garmin/types'

const METRICS_BASE = 'https://connectapi.garmin.com'
const WELLNESS_BASE = 'https://connect.garmin.com'

export class GarminClient {
  private _gc: GarminConnect

  private constructor(gc: GarminConnect) {
    this._gc = gc
  }

  /**
   * Restore a GarminClient from a previously exported token.
   * The garmin-connect package exposes loadToken(oauth1, oauth2) to restore
   * session state without re-authenticating.
   */
  static async fromToken(token: object): Promise<GarminClient> {
    const t = token as IGarminTokens
    const gc = new GarminConnect({ username: '', password: '' })
    gc.loadToken(t.oauth1, t.oauth2)
    return new GarminClient(gc)
  }

  /**
   * Authenticate with Garmin Connect using email/password credentials.
   * Throws if login fails.
   */
  static async fromCredentials(email: string, password: string): Promise<GarminClient> {
    const gc = new GarminConnect({ username: email, password })
    await gc.login(email, password)
    return new GarminClient(gc)
  }

  /**
   * Export the current OAuth tokens for storage and later restoration via fromToken().
   */
  exportToken(): object {
    return this._gc.exportToken()
  }

  /**
   * Returns the Training Readiness score (0–100) for the given date, or null on error.
   */
  async getTrainingReadiness(date: string): Promise<number | null> {
    try {
      const url = `${METRICS_BASE}/metrics-service/metrics/trainingreadiness/${date}`
      const data = await this._gc.get(url) as unknown[]
      if (!Array.isArray(data) || data.length === 0) return null
      const first = data[0] as Record<string, unknown>
      const score = first.trainingReadinessScore
      return typeof score === 'number' ? score : null
    } catch {
      return null
    }
  }

  /**
   * Returns the training status string (e.g. 'MAINTAINING', 'PRODUCTIVE') for the
   * given date, or null on error.
   */
  async getTrainingStatus(date: string): Promise<string | null> {
    try {
      const url = `${METRICS_BASE}/metrics-service/metrics/trainingstatus/aggregated/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const summary = data?.trainingStatusLatestSummary as Record<string, unknown> | undefined
      const status = summary?.trainingStatus
      return typeof status === 'string' ? status : null
    } catch {
      return null
    }
  }

  /**
   * Returns the most recent Body Battery level (0–100) for the given date,
   * derived from the last entry in the daily time series, or null on error.
   */
  async getBodyBatteryCurrent(date: string): Promise<number | null> {
    try {
      const url = `${WELLNESS_BASE}/wellness-service/wellness/bodyBattery/reports/daily`
      const data = await this._gc.get(url, { startDate: date, endDate: date }) as Record<string, unknown>
      const dto = data?.dailyBodyBatteryDTO as Record<string, unknown> | undefined
      const arr = dto?.bodyBatteryValuesArray as Array<[number, number, string]> | undefined
      if (!Array.isArray(arr) || arr.length === 0) return null
      const last = arr[arr.length - 1]
      return typeof last[1] === 'number' ? last[1] : null
    } catch {
      return null
    }
  }

  /**
   * Returns the overall (average) stress level for the given date, or null on error.
   */
  async getDailyStressAvg(date: string): Promise<number | null> {
    try {
      const url = `${WELLNESS_BASE}/wellness-service/wellness/dailyStress/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const val = data?.overallStressLevel
      return typeof val === 'number' ? val : null
    } catch {
      return null
    }
  }
}
