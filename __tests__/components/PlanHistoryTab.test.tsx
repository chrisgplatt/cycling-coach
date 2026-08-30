import { render, screen, waitFor } from '@testing-library/react'
import PlanHistoryTab from '@/components/plan/PlanHistoryTab'
import { makeArchiveSummary } from '../support/factories'
import type { TrainingSummary } from '@/lib/plan/summary'

const originalFetch = global.fetch

afterEach(() => { global.fetch = originalFetch; jest.resetAllMocks() })

const SUMMARY: TrainingSummary = {
  windowMonths: 12, windowStart: '2025-09-04',
  ridesCompleted: 0, hoursTrained: 0, weeksWithPlan: 0, weeksInWindow: 52,
  ctlStart: null, ctlEnd: null, fitnessChange: null,
  ftpStart: null, ftpEnd: null, ftpChange: null, ftpStartIsPartial: false,
}

function mockFetch(historyBody: unknown, summaryBody: unknown = SUMMARY) {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/api/plan/summary') ? summaryBody : historyBody
    return Promise.resolve({ json: async () => body })
  }) as never
}

describe('PlanHistoryTab', () => {
  it('renders the training summary rollup above the plan list', async () => {
    mockFetch({ plans: [] })
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText('Training summary')).toBeInTheDocument())
  })

  it('renders a card per archived plan', async () => {
    mockFetch({
      plans: [
        { id: 'p1', name: 'Spring Build', target_event_name: 'Sportive', target_event_date: '2026-06-26', closed_at: '2026-06-26', archive_summary: makeArchiveSummary() },
      ],
    })
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText('Spring Build')).toBeInTheDocument())
  })

  it('shows an empty state when there are no closed plans', async () => {
    mockFetch({ plans: [] })
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText(/No closed plans yet/)).toBeInTheDocument())
  })

  it('shows an error message when the fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as never
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText(/Failed to load plan history/)).toBeInTheDocument())
  })
})
