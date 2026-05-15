/**
 * @jest-environment node
 */
import { isEmailAllowed } from '@/app/auth/callback/route'

describe('isEmailAllowed', () => {
  it('returns true for an email in the list', () => {
    expect(isEmailAllowed('alice@example.com', 'alice@example.com,bob@example.com')).toBe(true)
  })

  it('returns false for an email not in the list', () => {
    expect(isEmailAllowed('carol@example.com', 'alice@example.com,bob@example.com')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isEmailAllowed('Alice@Example.COM', 'alice@example.com')).toBe(true)
  })

  it('returns false for an empty allowed list', () => {
    expect(isEmailAllowed('alice@example.com', '')).toBe(false)
  })

  it('trims whitespace around email entries', () => {
    expect(isEmailAllowed('alice@example.com', ' alice@example.com , bob@example.com ')).toBe(true)
  })
})
