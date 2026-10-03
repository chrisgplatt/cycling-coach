/** @jest-environment node */
const mockInsert = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: () => ({ insert: mockInsert }) })),
}))
const mockWaitUntil = jest.fn()
jest.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => mockWaitUntil(p) }))

import { createClient } from '@supabase/supabase-js'
import {
  logUsage, setUsageContext, getUsageContext, estimateCostUsd, flushUsageWrites,
} from '@/lib/claude/usage-log'

describe('logUsage', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    mockInsert.mockReset().mockResolvedValue({ error: null })
    mockWaitUntil.mockReset()
  })

  afterEach(() => logSpy.mockRestore())

  it('logs a structured usage record with an estimated cost when usage is present', () => {
    logUsage('briefing.morning', {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 1200,
        output_tokens: 80,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1000,
      } as never,
    })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(logged).toEqual({
      claude_usage: true,
      label: 'briefing.morning',
      model: 'claude-opus-5',
      input_tokens: 1200,
      output_tokens: 80,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1000,
      // 1200×$5 + 80×$25 + 1000×$0.50 per MTok
      cost_usd: 0.0085,
      user_id: null,
    })
  })

  it('defaults missing cache fields to 0', () => {
    logUsage('ftp.predict', {
      model: 'claude-opus-5',
      usage: { input_tokens: 500, output_tokens: 40 } as never,
    })

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(logged.cache_creation_input_tokens).toBe(0)
    expect(logged.cache_read_input_tokens).toBe(0)
  })

  it('does not log or throw when usage is absent (e.g. a bare test mock response)', () => {
    logUsage('steps.generate', {})
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('does not write to the database under test unless opted in', () => {
    logUsage('steps.generate', { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 } })
    expect(createClient).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  describe('persistence', () => {
    const env = { ...process.env }
    beforeEach(() => {
      process.env.CLAUDE_USAGE_DB_IN_TESTS = '1'
      process.env.SUPABASE_URL = 'https://example.supabase.co'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    })
    afterEach(() => { process.env = { ...env } })

    it('inserts a row carrying the async usage context and keeps the function alive via waitUntil', async () => {
      await (async () => {
        await Promise.resolve()
        setUsageContext({ userId: 'user-1', trigger: 'user', route: '/api/chat' })
        // Simulate a deep lib call further down the same async chain.
        await new Promise(r => setTimeout(r, 1))
        logUsage(
          'plan.fillSession',
          { model: 'claude-sonnet-5', stop_reason: 'max_tokens', usage: { input_tokens: 1000, output_tokens: 2000 } },
          { metadata: { date: '2026-10-05' } },
        )
      })()
      await flushUsageWrites()

      expect(mockInsert).toHaveBeenCalledWith({
        label: 'plan.fillSession',
        model: 'claude-sonnet-5',
        input_tokens: 1000,
        output_tokens: 2000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cost_usd: 0.022,
        user_id: 'user-1',
        trigger: 'user',
        route: '/api/chat',
        stop_reason: 'max_tokens',
        metadata: { date: '2026-10-05' },
      })
      expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    })

    it('swallows insert errors so a coaching response never fails on logging', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockInsert.mockRejectedValue(new Error('db down'))
      expect(() => logUsage('chat.general', { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 } })).not.toThrow()
      await flushUsageWrites()
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })
})

describe('usage context', () => {
  it('keeps concurrent requests isolated', async () => {
    const tick = () => new Promise(r => setTimeout(r, 2))
    const handler = async (id: string) => {
      await tick()
      setUsageContext({ userId: id })
      await tick()
      return getUsageContext()?.userId
    }
    await expect(Promise.all([handler('a'), handler('b')])).resolves.toEqual(['a', 'b'])
  })
})

describe('estimateCostUsd', () => {
  it('prices cache reads and writes at their own rates', () => {
    expect(estimateCostUsd('claude-opus-5', {
      input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
    })).toBeCloseTo(0.5 + 6.25)
  })

  it('matches suffixed model ids to the base price, not a shorter prefix', () => {
    expect(estimateCostUsd('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(4)
    expect(estimateCostUsd('claude-opus-5-20260101', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(5)
  })

  it('returns 0 for unknown models', () => {
    expect(estimateCostUsd('mystery-model', { input_tokens: 1_000_000, output_tokens: 1 })).toBe(0)
  })
})
