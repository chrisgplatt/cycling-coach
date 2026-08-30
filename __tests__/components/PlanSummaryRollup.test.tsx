import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlanSummaryRollup from '@/components/plan/PlanSummaryRollup'
import type { TrainingSummary } from '@/lib/plan/summary'

const SUMMARY: TrainingSummary = {
  windowMonths: 12, windowStart: '2025-09-04',
  ridesCompleted: 42, hoursTrained: 63.5, weeksWithPlan: 30, weeksActive: 25, weeksInWindow: 52,
  ctlStart: 40, ctlEnd: 55, fitnessChange: 15,
  ftpStart: 230, ftpEnd: 250, ftpChange: 20, ftpStartIsPartial: false,
}

const originalFetch = global.fetch
afterEach(() => { global.fetch = originalFetch; jest.resetAllMocks() })

function mockFetch(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body }) as never
}

describe('PlanSummaryRollup', () => {
  it('renders tiles from the fetched summary', async () => {
    mockFetch(SUMMARY)
    render(<PlanSummaryRollup />)
    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.getByText('63.5')).toBeInTheDocument()
    expect(screen.getByText('30/52')).toBeInTheDocument()
    expect(screen.getByText('25/52')).toBeInTheDocument()
    expect(screen.getByText('+15')).toBeInTheDocument()
    expect(screen.getByText('+20W')).toBeInTheDocument()
  })

  it('shows "Not available" for null fitness and FTP fields', async () => {
    mockFetch({ ...SUMMARY, fitnessChange: null, ftpChange: null })
    render(<PlanSummaryRollup />)
    expect(await screen.findAllByText('Not available')).toHaveLength(2)
  })

  it('shows a caveat note when the FTP start is partial', async () => {
    mockFetch({ ...SUMMARY, ftpStartIsPartial: true })
    render(<PlanSummaryRollup />)
    expect(await screen.findByText(/since your first recorded FTP/)).toBeInTheDocument()
  })

  it('fetches with months=12 by default and refetches with months=6 when the 6mo button is tapped', async () => {
    mockFetch(SUMMARY)
    render(<PlanSummaryRollup />)
    await screen.findByText('42')
    expect(global.fetch).toHaveBeenCalledWith('/api/plan/summary?months=12')

    fireEvent.click(screen.getByText('6mo'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/plan/summary?months=6'))
  })

  it('shows a loading skeleton before the fetch resolves', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    global.fetch = jest.fn().mockReturnValue(new Promise(resolve => { resolveFetch = resolve })) as never
    render(<PlanSummaryRollup />)
    expect(screen.getByTestId('plan-summary-skeleton')).toBeInTheDocument()
    resolveFetch({ ok: true, json: async () => SUMMARY })
    await screen.findByText('42')
  })

  it('shows an error message when the fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as never
    render(<PlanSummaryRollup />)
    expect(await screen.findByText("Couldn't load your training summary.")).toBeInTheDocument()
  })

  it('shows an error message instead of crashing when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    }) as never
    render(<PlanSummaryRollup />)
    expect(await screen.findByText("Couldn't load your training summary.")).toBeInTheDocument()
  })
})
