import { render, screen } from '@testing-library/react'
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'
import type { DailyStrainPoint } from '@/types'

function makeStrainToday(overrides: Partial<DailyStrainPoint> = {}): DailyStrainPoint {
  return {
    date: '2026-07-18',
    dailyTrimp: 108,
    trimpRef: 150,
    workoutStrain: 16,
    ...overrides,
  }
}

describe('StrainBreakdownSheet', () => {
  it('renders the total strain number and band label from strainToday.workoutStrain', () => {
    render(
      <StrainBreakdownSheet
        strainToday={makeStrainToday()}
        activities={[{ name: 'Morning ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }]}
        maxHr={190}
        restingHr={50}
        onClose={() => {}}
      />
    )
    expect(screen.getAllByText('16').length).toBeGreaterThan(0)
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('renders one row per activity that has HR or training-load data', () => {
    render(
      <StrainBreakdownSheet
        strainToday={makeStrainToday()}
        activities={[
          { name: 'Morning ride', durationMin: 60, avgHr: 150, trainingLoad: 80 },
          { name: 'Evening spin', durationMin: 30, avgHr: null, trainingLoad: 20 },
        ]}
        maxHr={190}
        restingHr={50}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Morning ride/)).toBeInTheDocument()
    expect(screen.getByText(/Evening spin/)).toBeInTheDocument()
  })

  it('does not render a row for an activity with neither avgHr nor trainingLoad', () => {
    render(
      <StrainBreakdownSheet
        strainToday={makeStrainToday()}
        activities={[
          { name: 'Morning ride', durationMin: 60, avgHr: 150, trainingLoad: 80 },
          { name: 'Untracked walk', durationMin: 15, avgHr: null, trainingLoad: null },
        ]}
        maxHr={190}
        restingHr={50}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Morning ride/)).toBeInTheDocument()
    expect(screen.queryByText(/Untracked walk/)).not.toBeInTheDocument()
  })

  it('shows "No activity recorded today" when activities is empty', () => {
    render(
      <StrainBreakdownSheet
        strainToday={makeStrainToday()}
        activities={[]}
        maxHr={190}
        restingHr={50}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('No activity recorded today')).toBeInTheDocument()
  })

  it('calls onClose when the Close button is clicked', () => {
    const onClose = jest.fn()
    render(
      <StrainBreakdownSheet
        strainToday={makeStrainToday()}
        activities={[]}
        maxHr={190}
        restingHr={50}
        onClose={onClose}
      />
    )
    screen.getByText('Close').click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
