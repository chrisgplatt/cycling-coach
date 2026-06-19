import { render, screen, fireEvent } from '@testing-library/react'
import WellnessCard from '@/components/WellnessCard'
import type { DailyWellness } from '@/types'

const logged: DailyWellness = {
  id: 'w1', user_id: 'u1', date: '2026-06-16',
  energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5,
  created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z',
}

describe('WellnessCard', () => {
  it('shows tap-to-log prompt when no wellness logged', () => {
    render(<WellnessCard date="2026-06-16" wellness={undefined} onTap={() => {}} />)
    expect(screen.getByText(/tap to log/i)).toBeInTheDocument()
  })

  it('shows dot summary when wellness is logged', () => {
    render(<WellnessCard date="2026-06-16" wellness={logged} onTap={() => {}} />)
    expect(screen.getByText(/wellness logged/i)).toBeInTheDocument()
    expect(screen.getByText(/Energy/i)).toBeInTheDocument()
  })

  it('calls onTap when clicked', () => {
    const onTap = jest.fn()
    render(<WellnessCard date="2026-06-16" wellness={undefined} onTap={onTap} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('calls onTap when logged entry is clicked', () => {
    const onTap = jest.fn()
    render(<WellnessCard date="2026-06-16" wellness={logged} onTap={onTap} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onTap).toHaveBeenCalledTimes(1)
  })
})
