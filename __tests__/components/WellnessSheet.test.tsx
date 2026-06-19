import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WellnessSheet from '@/components/WellnessSheet'
import type { DailyWellness } from '@/types'

const saved: DailyWellness = {
  id: 'w1', user_id: 'u1', date: '2026-06-16',
  energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5,
  created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z',
}

describe('WellnessSheet', () => {
  it('renders all five scale rows', () => {
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('Energy')).toBeInTheDocument()
    expect(screen.getByText('Leg freshness')).toBeInTheDocument()
    expect(screen.getByText('Mood')).toBeInTheDocument()
    expect(screen.getByText('Stress')).toBeInTheDocument()
    expect(screen.getByText('Sleep quality')).toBeInTheDocument()
  })

  it('Save button is disabled until at least one value selected', () => {
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('Save button enables after selecting a value', () => {
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: '4' })[0])
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('pre-populates values from existing wellness entry', () => {
    render(<WellnessSheet date="2026-06-16" wellness={saved} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('calls onSaved with the returned entry after successful save', async () => {
    const onSaved = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wellness: saved }),
    }) as never

    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={onSaved} />)
    fireEvent.click(screen.getAllByRole('button', { name: '4' })[0])
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
  })

  it('calls onClose when the close button is pressed', () => {
    const onClose = jest.fn()
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={onClose} onSaved={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows error message when save fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
    }) as never

    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: '4' })[0])
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByText(/failed to save/i)).toBeInTheDocument())
  })
})
