import { render, screen, fireEvent } from '@testing-library/react'
import MetricRing from '@/components/MetricRing'

test('renders the display value, label, and band label', () => {
  render(<MetricRing displayValue="78" pct={78} label="Recovery" bandLabel="High" color="#059669" />)
  expect(screen.getByText('78')).toBeInTheDocument()
  expect(screen.getByText('Recovery')).toBeInTheDocument()
  expect(screen.getByText('High')).toBeInTheDocument()
})

test('calls onTap when clicked, and renders as a button', () => {
  const onTap = jest.fn()
  render(<MetricRing displayValue="13" pct={62} label="Strain" bandLabel="Moderate" color="#d97706" onTap={onTap} />)
  fireEvent.click(screen.getByRole('button'))
  expect(onTap).toHaveBeenCalledTimes(1)
})

test('renders without a button role when onTap is not provided', () => {
  render(<MetricRing displayValue="85" pct={85} label="Sleep" bandLabel="Good" color="#059669" />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('renders tick marks when targetLowPct/targetHighPct are provided', () => {
  render(
    <MetricRing displayValue="13" pct={62} label="Strain" bandLabel="Moderate" color="#d97706"
      targetLowPct={47.6} targetHighPct={81}
    />
  )
  expect(screen.getByTestId('ring-tick-low')).toBeInTheDocument()
  expect(screen.getByTestId('ring-tick-high')).toBeInTheDocument()
})

test('renders no tick marks when targetLowPct/targetHighPct are not provided', () => {
  render(<MetricRing displayValue="13" pct={62} label="Strain" bandLabel="Moderate" color="#d97706" />)
  expect(screen.queryByTestId('ring-tick-low')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ring-tick-high')).not.toBeInTheDocument()
})
