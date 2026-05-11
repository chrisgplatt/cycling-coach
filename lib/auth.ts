export const COOKIE_NAME = 'cc_session'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function createSessionToken(password: string): Promise<string | null> {
  const appPassword = getEnv('APP_PASSWORD')
  const sessionSecret = getEnv('SESSION_SECRET')
  if (password !== appPassword) return null
  return hmacHex(sessionSecret, 'authenticated')
}

export async function validateSessionToken(token: string): Promise<boolean> {
  try {
    const sessionSecret = getEnv('SESSION_SECRET')
    const expected = await hmacHex(sessionSecret, 'authenticated')
    if (token.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < token.length; i++) {
      diff |= token.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return diff === 0
  } catch {
    return false
  }
}
