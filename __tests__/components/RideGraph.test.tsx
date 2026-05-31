import { render } from '@testing-library/react'
import RideGraph from '@/components/ride/RideGraph'
import type { RideStreams } from '@/types'

const streams: RideStreams = {
  time: [0, 60, 120], distance: [0, 1000, 2000], latlng: null,
  power: [100, 200, 150], hr: [120, 140, 150], altitude: [10, 20, 15],
  cadence: null, velocity: null,
}

describe('RideGraph', () => {
  it('renders a polyline for each active series', () => {
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={1} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} />,
    )
    // power + hr + elevation = 3 polylines, plus the crosshair line
    expect(container.querySelectorAll('polyline').length).toBe(3)
    expect(container.querySelector('line')).toBeTruthy() // crosshair
  })
})
