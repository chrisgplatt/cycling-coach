import { GarminConnect } from 'garmin-connect'
import type { IGarminTokens } from 'garmin-connect/dist/garmin/types'

const GARMIN_API = 'https://connectapi.garmin.com'

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
      const url = `${GARMIN_API}/metrics-service/metrics/trainingreadiness/${date}`
      const data = await this._gc.get(url) as unknown
      const keys = data && typeof data === 'object' ? Object.keys(data as object) : typeof data
      console.log(`GR-readiness:keys=${JSON.stringify(keys)},raw=${JSON.stringify(data)?.slice(0,200)}`)
      if (!Array.isArray(data) || data.length === 0) return null
      const first = data[0] as Record<string, unknown>
      const score = first.trainingReadinessScore
      return typeof score === 'number' ? score : null
    } catch (e) {
      console.error(`GR-readiness-err:${String(e)?.slice(0,150)}`)
      return null
    }
  }

  async getTrainingStatus(date: string): Promise<string | null> {
    try {
      const url = `${GARMIN_API}/metrics-service/metrics/trainingstatus/aggregated/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const keys = data && typeof data === 'object' ? Object.keys(data) : typeof data
      console.log(`GR-status:keys=${JSON.stringify(keys)},raw=${JSON.stringify(data)?.slice(0,200)}`)
      const summary = data?.trainingStatusLatestSummary as Record<string, unknown> | undefined
      const status = summary?.trainingStatus
      return typeof status === 'string' ? status : null
    } catch (e) {
      console.error(`GR-status-err:${String(e)?.slice(0,150)}`)
      return null
    }
  }

  async getBodyBatteryCurrent(date: string): Promise<number | null> {
    try {
      const url = `${GARMIN_API}/wellness-service/wellness/bodyBattery/reports/daily`
      const data = await this._gc.get(url, { params: { startDate: date, endDate: date } }) as unknown
      const keys = data && typeof data === 'object' ? Object.keys(data as object) : typeof data
      console.log(`GR-battery:keys=${JSON.stringify(keys)},raw=${JSON.stringify(data)?.slice(0,200)}`)
      const dto = (data as Record<string, unknown>)?.dailyBodyBatteryDTO as Record<string, unknown> | undefined
      const arr = dto?.bodyBatteryValuesArray as Array<[number, number, string]> | undefined
      if (!Array.isArray(arr) || arr.length === 0) return null
      const last = arr[arr.length - 1]
      return typeof last[1] === 'number' ? last[1] : null
    } catch (e) {
      console.error(`GR-battery-err:${String(e)?.slice(0,150)}`)
      return null
    }
  }

  async getDailyStressAvg(date: string): Promise<number | null> {
    try {
      const url = `${GARMIN_API}/wellness-service/wellness/dailyStress/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const keys = data && typeof data === 'object' ? Object.keys(data) : typeof data
      console.log(`GR-stress:keys=${JSON.stringify(keys)},raw=${JSON.stringify(data)?.slice(0,200)}`)
      const val = data?.overallStressLevel
      return typeof val === 'number' ? val : null
    } catch (e) {
      console.error(`GR-stress-err:${String(e)?.slice(0,150)}`)
      return null
    }
  }
}
