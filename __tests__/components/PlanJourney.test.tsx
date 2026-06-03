import { render, screen } from '@testing-library/react'
import PlanJourney from '@/components/plan/PlanJourney'

const states = ['done', 'done', 'current', 'upcoming'] as const
const phases = ['base', 'build', 'peak', 'taper'] as const

describe('PlanJourney', () => {
  it('renders one block per week and a single current marker', () => {
    const { container } = render(
      <PlanJourney states={[...states]} phases={[...phases]} weekLabel="Wk 3 of 4"
        phaseLabel="Peak" eventName="Dragon Ride" daysToEvent={35} />,
    )
    expect(container.querySelectorAll('[data-week-block]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-state="current"]')).toHaveLength(1)
  })

  it('shows the week label, phase and event countdown', () => {
    render(
      <PlanJourney states={[...states]} phases={[...phases]} weekLabel="Wk 3 of 4"
        phaseLabel="Peak" eventName="Dragon Ride" daysToEvent={35} />,
    )
    expect(screen.getByText(/Wk 3 of 4/)).toBeInTheDocument()
    expect(screen.getByText(/Peak/)).toBeInTheDocument()
    expect(screen.getByText(/35 days to Dragon Ride/)).toBeInTheDocument()
  })
})
