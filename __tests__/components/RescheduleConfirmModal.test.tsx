import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RescheduleConfirmModal from '@/components/RescheduleConfirmModal'
import type { Workout } from '@/types'

const workout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-05-20',
  type: 'threshold', duration_minutes: 60,
  description: '2x20 at FTP', target_zones: 'Zone 4',
  intervals_icu_event_id: 'evt1', status: 'planned',
  icu_activity_id: null, tss: null, created_at: '',
}

describe('RescheduleConfirmModal', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('renders correct prompt with workout type and formatted dates', () => {
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={jest.fn()} onCancel={jest.fn()}
      />
    )
    // 2026-05-20 = Wed 20 May, 2026-05-22 = Fri 22 May
    expect(screen.getByRole('heading')).toHaveTextContent(
      /move threshold workout from wed 20 may to fri 22 may/i
    )
  })

  it('calls onCancel without fetching when Cancel is clicked', () => {
    const onCancel = jest.fn()
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={jest.fn()} onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('calls PATCH with correct body and then onConfirm on success', async () => {
    const onConfirm = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={onConfirm} onCancel={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ date: '2026-05-22' }),
    }))
  })

  it('shows error inline and does not call onConfirm on failed PATCH', async () => {
    const onConfirm = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, json: async () => ({ error: 'DB error' }),
    } as unknown as Response)
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={onConfirm} onCancel={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByText('DB error')).toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables both buttons while PATCH is in-flight', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={jest.fn()} onCancel={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /moving/i })).toBeDisabled())
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
  })
})
