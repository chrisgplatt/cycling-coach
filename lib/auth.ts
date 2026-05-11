import { createHmac, timingSafeEqual } from 'crypto'

export const COOKIE_NAME = 'cc_session'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export function createSessionToken(password: string): string | null {
  const appPassword = getEnv('APP_PASSWORD')
  const sessionSecret = getEnv('SESSION_SECRET')
  if (password !== appPassword) return null
  return createHmac('sha256', sessionSecret).update('authenticated').digest('hex')
}

export function validateSessionToken(token: string): boolean {
  const sessionSecret = getEnv('SESSION_SECRET')
  const expected = createHmac('sha256', sessionSecret).update('authenticated').digest('hex')
  // Expected is always 64 hex chars; token from cookie may vary
  if (token.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}
