import { render, screen } from '@testing-library/react'
import TriggerProgressBar from '@/components/gear/TriggerProgressBar'

const base = { label: 'Re-wax', used: 212, interval: 300, metric: 'km' as const, kind: 'recurring' as const }

describe('TriggerProgressBar', () => {
  it('shows the label and used / interval', () => {
    render(<TriggerProgressBar {...base} status="ok" />)
    expect(screen.getByText('Re-wax')).toBeInTheDocument()
    expect(screen.getByText('212 / 300 km')).toBeInTheDocument()
  })

  it('rounds to one decimal place', () => {
    render(<TriggerProgressBar {...base} used={12.345} interval={20} metric="hours" status="ok" />)
    expect(screen.getByText('12.3 / 20 hours')).toBeInTheDocument()
  })

  it('is green when ok, amber when due soon, red with an Overdue label when overdue', () => {
    const { rerender } = render(<TriggerProgressBar {...base} status="ok" />)
    expect(screen.getByRole('progressbar').firstElementChild?.className).toContain('green')
    rerender(<TriggerProgressBar {...base} used={250} status="due_soon" />)
    expect(screen.getByRole('progressbar').firstElementChild?.className).toContain('amber')
    rerender(<TriggerProgressBar {...base} used={320} status="overdue" />)
    expect(screen.getByRole('progressbar').firstElementChild?.className).toContain('red')
    expect(screen.getByText('Overdue')).toBeInTheDocument()
  })

  it('clamps the bar to 100% wide', () => {
    render(<TriggerProgressBar {...base} used={900} status="overdue" />)
    expect((screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width).toBe('100%')
  })

  it('exposes progress to assistive tech', () => {
    render(<TriggerProgressBar {...base} status="ok" />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '71')
    expect(bar).toHaveAttribute('aria-label', 'Re-wax')
  })

  it('marks lifetime triggers as replacement limits', () => {
    render(<TriggerProgressBar {...base} kind="lifetime" label="Replace chain" status="ok" />)
    expect(screen.getByText('Lifetime limit')).toBeInTheDocument()
  })
})
