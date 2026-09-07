import { logUsage } from '@/lib/claude/usage-log'

describe('logUsage', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => logSpy.mockRestore())

  it('logs a structured usage record when usage is present', () => {
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
})
