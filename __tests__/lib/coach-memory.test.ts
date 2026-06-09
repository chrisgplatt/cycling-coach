/** @jest-environment node */
import type { CoachMessage } from '@/types'

describe('CoachMessage type', () => {
  it('accepts a valid coach message object', () => {
    const msg: CoachMessage = {
      id: 'abc',
      user_id: 'u1',
      surface: 'coach',
      role: 'user',
      content: 'hello',
      context: null,
      created_at: '2026-06-09T10:00:00Z',
    }
    expect(msg.surface).toBe('coach')
  })
})
