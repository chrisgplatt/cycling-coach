import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlanReviewModal from '@/components/PlanReviewModal'
import type { GeneratedPlan } from '@/types'

const mockPlan: GeneratedPlan = {
  rationale: 'Adapted based on last week.\n\nSecond paragraph.',
  target_event_name: 'Dragon Ride',
  target_event_date: '2026-06-25',
  phase: 'build',
  workouts: [
    { date: '2026-05-25', type: 'endurance', duration_minutes: 90, description: 'Easy Z2 ride', target_zones: 'Zone 2', steps: [] },
  ],
}

describe('PlanReviewModal', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('shows loading state when loading=true', () => {
    render(<PlanReviewModal plan={null} loading={true} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText(/adapting your training plan/i)).toBeInTheDocument()
  })

  it('shows adapted plan header when plan is provided', () => {
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText(/adapted training plan/i)).toBeInTheDocument()
  })

  it('renders rationale as separate paragraphs', () => {
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('Adapted based on last week.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
  })

  it('calls onReject when Reject button is clicked', () => {
    const onReject = jest.fn()
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={jest.fn()} onReject={onReject} />)
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('calls PATCH /api/plan/review and then onApprove on success', async () => {
    const onApprove = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={onApprove} onReject={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /approve adapted plan/i }))
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith('/api/plan/review', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"plan"'),
    }))
  })

  it('shows progress bar when workoutsFound > 0 in loading state', () => {
    render(<PlanReviewModal plan={null} loading={true} workoutsFound={3} estimatedWorkouts={10} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText(/3 workout/i)).toBeInTheDocument()
  })
})
