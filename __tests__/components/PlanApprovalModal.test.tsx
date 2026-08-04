import { act, render, screen, fireEvent } from '@testing-library/react'
import PlanApprovalModal from '@/components/PlanApprovalModal'
import type { GeneratedPlan } from '@/types'

const plan: GeneratedPlan = {
  rationale: 'First paragraph.\n\nSecond paragraph.',
  target_event_name: 'Gran Fondo',
  target_event_date: '2026-09-01',
  phase: 'base',
  workouts: [],
}

describe('PlanApprovalModal', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('renders rationale as separate paragraphs', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
  })

  it('renders plan name input', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByPlaceholderText(/e\.g\. base block 1/i)).toBeInTheDocument()
  })

  it('disables Approve button when name is empty', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled()
  })

  it('enables Approve button when name is typed', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. base block 1/i), { target: { value: 'Base Block 1' } })
    expect(screen.getByRole('button', { name: /approve/i })).not.toBeDisabled()
  })

  it('sends name in PATCH body on approve', () => {
    (globalThis as any).fetch = jest.fn()
    jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. base block 1/i), { target: { value: 'Base Block 1' } })
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(global.fetch).toHaveBeenCalledWith('/api/plan', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"name":"Base Block 1"'),
    }))
  })
})

describe('PlanApprovalModal — loading state', () => {
  afterEach(() => { jest.useRealTimers() })

  it('shows a generic heading while loading with no batch status', () => {
    render(<PlanApprovalModal plan={null} loading onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('Building your training plan…')).toBeInTheDocument()
  })

  it('shows the week range and batch count when batchStatus is provided', () => {
    render(
      <PlanApprovalModal
        plan={null}
        loading
        weeks={12}
        batchStatus={{ weekLabel: 'weeks 7-12', batchIndex: 1, totalBatches: 2 }}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />
    )
    expect(screen.getByText('Building weeks 7-12 of 12 (batch 2 of 2)…')).toBeInTheDocument()
  })

  it('omits the batch count suffix when there is only one batch', () => {
    render(
      <PlanApprovalModal
        plan={null}
        loading
        weeks={6}
        batchStatus={{ weekLabel: 'weeks 1-6', batchIndex: 0, totalBatches: 1 }}
        onApprove={jest.fn()}
        onReject={jest.fn()}
      />
    )
    expect(screen.getByText('Building weeks 1-6 of 6…')).toBeInTheDocument()
  })

  it('counts up an elapsed-seconds timer while loading', () => {
    jest.useFakeTimers()
    render(<PlanApprovalModal plan={null} loading onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('0s elapsed')).toBeInTheDocument()
    act(() => { jest.advanceTimersByTime(3000) })
    expect(screen.getByText('3s elapsed')).toBeInTheDocument()
  })

  it('rotates the thinking message as time passes with no workouts found yet', () => {
    jest.useFakeTimers()
    render(<PlanApprovalModal plan={null} loading workoutsFound={0} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('Analysing your goals, fitness and schedule…')).toBeInTheDocument()
    act(() => { jest.advanceTimersByTime(4000) })
    expect(screen.getByText('Reviewing your recent training load…')).toBeInTheDocument()
  })

  it('shows the progress bar instead of the thinking message once workouts are found', () => {
    render(<PlanApprovalModal plan={null} loading workoutsFound={3} estimatedWorkouts={10} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('3 workouts scheduled of 10')).toBeInTheDocument()
    expect(screen.queryByText(/Analysing your goals/)).not.toBeInTheDocument()
  })
})
