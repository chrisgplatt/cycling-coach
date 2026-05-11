process.env.APP_PASSWORD = 'test-password'
process.env.SESSION_SECRET = 'test-secret-32-chars-long-padding'

import { createSessionToken, validateSessionToken } from '@/lib/auth'

describe('auth', () => {
  it('returns null for wrong password', async () => {
    expect(await createSessionToken('wrong')).toBeNull()
  })

  it('returns a token string for correct password', async () => {
    const token = await createSessionToken('test-password')
    expect(typeof token).toBe('string')
    expect(token!.length).toBe(64) // hex HMAC-SHA256
  })

  it('validates a genuine token', async () => {
    const token = (await createSessionToken('test-password'))!
    expect(await validateSessionToken(token)).toBe(true)
  })

  it('rejects a tampered token', async () => {
    expect(await validateSessionToken('not-a-real-token')).toBe(false)
  })
})
