/** @jest-environment node */
import { GarminClient } from './client'

jest.mock('garmin-connect', () => ({
  GarminConnect: jest.fn().mockImplementation(() => ({
    login: jest.fn().mockResolvedValue(undefined),
    exportToken: jest.fn().mockReturnValue({ oauth1: { token: 'abc' }, oauth2: { access_token: 'xyz' } }),
    loadToken: jest.fn(),
    get: jest.fn(),
  })),
}))

const { GarminConnect: MockGarminConnect } = require('garmin-connect') as { GarminConnect: jest.Mock }

function makeMockGC(overrides: Partial<ReturnType<typeof MockGarminConnect>> = {}) {
  const instance = {
    login: jest.fn().mockResolvedValue(undefined),
    exportToken: jest.fn().mockReturnValue({ oauth1: { token: 'abc' }, oauth2: { access_token: 'xyz' } }),
    loadToken: jest.fn(),
    get: jest.fn(),
    ...overrides,
  }
  MockGarminConnect.mockReturnValueOnce(instance)
  return instance
}

describe('GarminClient.fromCredentials', () => {
  it('calls login and creates client', async () => {
    const gc = makeMockGC()
    const client = await GarminClient.fromCredentials('test@example.com', 'pass')
    expect(gc.login).toHaveBeenCalledWith('test@example.com', 'pass')
    expect(client).toBeInstanceOf(GarminClient)
  })

  it('throws if login fails', async () => {
    makeMockGC({ login: jest.fn().mockRejectedValue(new Error('bad creds')) })
    await expect(GarminClient.fromCredentials('a@b.com', 'wrong')).rejects.toThrow('bad creds')
  })
})

describe('GarminClient.fromToken', () => {
  it('creates client from token without calling login', async () => {
    const gc = makeMockGC()
    const token = { oauth1: { token: 'abc' }, oauth2: { access_token: 'xyz' } }
    const client = await GarminClient.fromToken(token)
    expect(gc.login).not.toHaveBeenCalled()
    expect(gc.loadToken).toHaveBeenCalledWith(token.oauth1, token.oauth2)
    expect(client).toBeInstanceOf(GarminClient)
  })
})

describe('GarminClient.exportToken', () => {
  it('returns the serialised token from the underlying client', async () => {
    makeMockGC({ exportToken: jest.fn().mockReturnValue({ oauth1: { tok: 'xyz' }, oauth2: { at: '123' } }) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    expect(client.exportToken()).toEqual({ oauth1: { tok: 'xyz' }, oauth2: { at: '123' } })
  })
})

describe('GarminClient.getTrainingReadiness', () => {
  it('returns score and recoveryTimeMins from API response', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue([{
        score: 72,
        recoveryTime: 360,
        level: 'GOOD',
        calendarDate: '2026-06-20',
      }]),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error replace internal gc for test
    client['_gc'] = gc
    const result = await client.getTrainingReadiness('2026-06-20')
    expect(result.score).toBe(72)
    expect(result.recoveryTimeMins).toBe(360)
  })

  it('returns nulls on empty array', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue([]) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getTrainingReadiness('2026-06-20')
    expect(result.score).toBeNull()
    expect(result.recoveryTimeMins).toBeNull()
  })

  it('returns nulls on network error', async () => {
    const gc = makeMockGC({ get: jest.fn().mockRejectedValue(new Error('net fail')) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getTrainingReadiness('2026-06-20')
    expect(result.score).toBeNull()
    expect(result.recoveryTimeMins).toBeNull()
  })
})

describe('GarminClient.getTrainingStatus', () => {
  it('returns status string', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({ mostRecentTrainingStatus: 'MAINTAINING' }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingStatus('2026-06-20')).toBe('MAINTAINING')
  })

  it('returns null on unexpected shape', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue({}) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingStatus('2026-06-20')).toBeNull()
  })
})

describe('GarminClient.getBodyBattery', () => {
  it('returns current, charged, and drained', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue([{
        date: '2026-06-20',
        charged: 35,
        drained: 21,
        bodyBatteryValuesArray: [
          [1000000, 80],
          [2000000, 55],
          [3000000, 48],
        ],
      }]),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getBodyBattery('2026-06-20')
    expect(result.current).toBe(48)
    expect(result.charged).toBe(35)
    expect(result.drained).toBe(21)
  })

  it('returns nulls for empty time series', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue([{ date: '2026-06-20', bodyBatteryValuesArray: [] }]),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getBodyBattery('2026-06-20')
    expect(result.current).toBeNull()
  })
})

describe('GarminClient.getDailyStress', () => {
  it('returns avg and max stress', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({ avgStressLevel: 42, maxStressLevel: 87 }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getDailyStress('2026-06-20')
    expect(result.avg).toBe(42)
    expect(result.max).toBe(87)
  })

  it('returns nulls on missing fields', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue({}) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getDailyStress('2026-06-20')
    expect(result.avg).toBeNull()
    expect(result.max).toBeNull()
  })
})
