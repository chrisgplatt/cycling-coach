import { render, screen } from '@testing-library/react'
import ConsistencyStrip from '@/components/plan/ConsistencyStrip'

it('shows hit %, streak and hours', () => {
  render(<ConsistencyStrip hitPct={86} streak={5} hours={11} />)
  expect(screen.getByText('86%')).toBeInTheDocument()
  expect(screen.getByText('🔥5')).toBeInTheDocument()
  expect(screen.getByText('11h')).toBeInTheDocument()
})
