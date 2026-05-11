process.env.APP_PASSWORD = 'test-password'
process.env.SESSION_SECRET = 'test-secret-32-chars-long-padding'

import { createSessionToken, validateSessionToken } from '@/lib/auth'

describe('auth', () => {
  it('returns null for wrong password', () => {
    expect(createSessionToken('wrong')).toBeNull()
  })

  it('returns a token string for correct password', () => {
    const token = createSessionToken('test-password')
    expect(typeof token).toBe('string')
    expect(token!.length).toBe(64) // hex HMAC-SHA256
  })

  it('validates a genuine token', () => {
    const token = createSessionToken('test-password')!
    expect(validateSessionToken(token)).toBe(true)
  })

  it('rejects a tampered token', () => {
    expect(validateSessionToken('not-a-real-token')).toBe(false)
  })
})
