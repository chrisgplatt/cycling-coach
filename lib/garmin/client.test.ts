/** @jest-environment node */
import { GarminClient } from './client'

// All tests mock the garmin-connect package
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
  it('returns score from API response', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue([{ score: 72, level: 'GOOD', calendarDate: '2026-06-20' }]),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error replace internal gc for test
    client['_gc'] = gc
    const result = await client.getTrainingReadiness('2026-06-20')
    expect(result).toBe(72)
  })

  it('returns null on empty array', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue([]) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingReadiness('2026-06-20')).toBeNull()
  })

  it('returns null on network error', async () => {
    const gc = makeMockGC({ get: jest.fn().mockRejectedValue(new Error('net fail')) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingReadiness('2026-06-20')).toBeNull()
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

describe('GarminClient.getBodyBatteryCurrent', () => {
  it('returns the last battery level in the time series', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue([{
        date: '2026-06-20',
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
    expect(await client.getBodyBatteryCurrent('2026-06-20')).toBe(48)
  })

  it('returns null for empty time series', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue([{ date: '2026-06-20', bodyBatteryValuesArray: [] }]),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getBodyBatteryCurrent('2026-06-20')).toBeNull()
  })
})

describe('GarminClient.getDailyStressAvg', () => {
  it('returns avg stress value', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({ avgStressLevel: 42 }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getDailyStressAvg('2026-06-20')).toBe(42)
  })

  it('returns null on missing field', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue({}) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getDailyStressAvg('2026-06-20')).toBeNull()
  })
})
