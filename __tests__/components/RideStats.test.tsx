import { render, screen } from '@testing-library/react'
import RideStats, { rideStatsFromActivity, rideStatsFromMetrics } from '@/components/RideStats'
import type { ICUActivity, ActivityMetrics } from '@/types'

const activity: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
  name: 'Morning Ride', average_watts: 200, max_watts: 350, weighted_average_watts: 210,
  average_heartrate: 145, training_load: 85, rolling_ftp: null, distance: 30000,
  total_elevation_gain: 320, left_right_balance: 52, power_1min: 380, power_5min: 320,
  power_10min: 300, power_20min: 280,
}

const metrics: ActivityMetrics = {
  np: 210, avg_power: 200, max_power: 350, avg_hr: 145, distance_m: 30000, elevation_m: 320,
  lr_balance: 52, best_efforts: [{ secs: 60, watts: 380 }, { secs: 300, watts: 320 }, { secs: 1200, watts: 280 }],
  intervals: null, decoupling_pct: null, climbs: null, time_in_zone: null, shape: null, distributions: null, synced_at: '',
}

describe('RideStats adapters', () => {
  it('maps an ICUActivity', () => {
    const d = rideStatsFromActivity(activity)
    expect(d).toMatchObject({
      avgWatts: 200, np: 210, tss: 85, distanceM: 30000, elevationM: 320,
      durationSecs: 3600, avgHr: 145, lrBalanceRight: 52,
      best: { p1: 380, p5: 320, p10: 300, p20: 280 },
    })
  })

  it('maps ActivityMetrics, looking up best efforts by secs and tolerating gaps', () => {
    const d = rideStatsFromMetrics(metrics, 3600, 85)
    expect(d).toMatchObject({
      avgWatts: 200, np: 210, tss: 85, distanceM: 30000, elevationM: 320,
      durationSecs: 3600, avgHr: 145, lrBalanceRight: 52,
      best: { p1: 380, p5: 320, p10: null, p20: 280 }, // 600s effort absent → null
    })
  })
})

describe('RideStats render', () => {
  it('shows power, totals, HR and L/R', () => {
    render(<RideStats data={rideStatsFromActivity(activity)} />)
    expect(screen.getByText('NP')).toBeInTheDocument()
    expect(screen.getByText('210')).toBeInTheDocument()  // NP watts
    expect(screen.getByText('1h 0m')).toBeInTheDocument() // duration
    expect(screen.getByText('Avg HR')).toBeInTheDocument()
    expect(screen.getByText(/L \/ /)).toBeInTheDocument()  // balance text
  })

  it('hides Best Power, HR and L/R cards when their data is absent', () => {
    const d = rideStatsFromActivity({ ...activity, average_heartrate: null, left_right_balance: null,
      power_1min: null, power_5min: null, power_10min: null, power_20min: null })
    render(<RideStats data={d} />)
    expect(screen.queryByText('Best Power')).toBeNull()
    expect(screen.queryByText('Heart Rate')).toBeNull()
    expect(screen.queryByText('L/R Balance')).toBeNull()
  })
})
