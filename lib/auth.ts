import { createHmac } from 'crypto'

export const COOKIE_NAME = 'cc_session'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export function createSessionToken(password: string): string | null {
  const APP_PASSWORD = process.env.APP_PASSWORD!
  const SESSION_SECRET = process.env.SESSION_SECRET!
  if (password !== APP_PASSWORD) return null
  return createHmac('sha256', SESSION_SECRET).update('authenticated').digest('hex')
}

export function validateSessionToken(token: string): boolean {
  const SESSION_SECRET = process.env.SESSION_SECRET!
  const expected = createHmac('sha256', SESSION_SECRET).update('authenticated').digest('hex')
  return token === expected
}
