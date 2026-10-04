import { render, screen } from '@testing-library/react'
import GearDueBanner from '@/components/gear/GearDueBanner'
import type { BikeView } from '@/lib/gear/view'

const trig = (o: Record<string, unknown>) => ({
  id: 't', user_id: 'u', component_id: 'c', label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 300,
  last_done_at: null, heads_up_notified_at: null, due_notified_at: null,
  progress: { used: 100, interval: 300, fraction: 0.33, status: 'ok' }, ...o,
})
const bikes = (triggers: unknown[], compRetired: string | null = null, bikeRetired: string | null = null) => [{
  id: 'b', user_id: 'u', name: 'Road', kind: 'road', is_default: true, is_indoor_default: false, retired_at: bikeRetired,
  totals: { km: 0, hours: 0 },
  components: [{ id: 'c', user_id: 'u', bike_id: 'b', name: 'Chain', category: 'chain', installed_at: '2026-01-01', retired_at: compRetired, usage: { km: 0, hours: 0 }, triggers }],
}] as unknown as BikeView[]

describe('GearDueBanner', () => {
  it('renders nothing when everything is ok', () => {
    const { container } = render(<GearDueBanner bikes={bikes([trig({})])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists due-soon and overdue triggers with progress and links to the gear page', () => {
    render(<GearDueBanner bikes={bikes([
      trig({ id: 'a', label: 'Re-wax', progress: { used: 312, interval: 300, fraction: 1.04, status: 'overdue' } }),
      trig({ id: 'b', label: 'Replace chain', interval_value: 4000, kind: 'lifetime', progress: { used: 3300, interval: 4000, fraction: 0.82, status: 'due_soon' } }),
    ])} />)
    expect(screen.getByText(/Chain: Re-wax due — 312 \/ 300 km/)).toBeInTheDocument()
    expect(screen.getByText(/Chain: Replace chain coming up — 3300 \/ 4000 km/)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/gear')
  })

  it('ignores retired components and retired bikes', () => {
    const overdue = trig({ progress: { used: 400, interval: 300, fraction: 1.3, status: 'overdue' } })
    expect(render(<GearDueBanner bikes={bikes([overdue], '2026-03-01')} />).container).toBeEmptyDOMElement()
    expect(render(<GearDueBanner bikes={bikes([overdue], null, '2026-03-01T00:00:00Z')} />).container).toBeEmptyDOMElement()
  })
})
