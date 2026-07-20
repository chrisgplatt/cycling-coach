import { render, fireEvent } from '@testing-library/react'
import RideGraph from '@/components/ride/RideGraph'
import type { RideStreams } from '@/types'

const streams: RideStreams = {
  time: [0, 60, 120], distance: [0, 1000, 2000], latlng: null,
  power: [100, 200, 150], hr: [120, 140, 150], altitude: [10, 20, 15],
  cadence: null, velocity: null,
}

describe('RideGraph', () => {
  it('renders power + HR as lines, elevation as an area, and a crosshair', () => {
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={1} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance" />,
    )
    expect(container.querySelectorAll('polyline').length).toBe(2) // power + HR
    expect(container.querySelector('polygon')).toBeTruthy()        // elevation area
    expect(container.querySelector('line')).toBeTruthy()           // crosshair
  })
})

describe('RideGraph highlight markers', () => {
  // Note: this project's jsdom does not implement `PointerEvent` (confirmed during
  // planning — `new window.PointerEvent(...)` throws "not a constructor"), so
  // `fireEvent.pointerDown` cannot be used here and the marker's `onPointerDown`
  // stopPropagation guard (which exists to stop a marker tap from also triggering
  // the parent SVG's scrub-on-pointerdown handler) is not exercised by this test.
  // That guard is still correct real-browser behaviour; it's just untestable in
  // this environment. This test only verifies the click-driven tap callback.
  it('renders one marker per highlight and calls onMarkerTap on click', () => {
    const onMarkerTap = jest.fn()
    const markers = [{ arrayIndex: 0, streamIndex: 1, kind: 'climb' as const }]
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={0} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance"
        highlightMarkers={markers} onMarkerTap={onMarkerTap} />,
    )
    const marker = container.querySelector('[data-testid="graph-marker"]')
    expect(marker).toBeTruthy()
    fireEvent.click(marker!)
    expect(onMarkerTap).toHaveBeenCalledWith(0)
  })

  it('renders no markers when highlightMarkers is omitted', () => {
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={0} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance" />,
    )
    expect(container.querySelectorAll('[data-testid="graph-marker"]').length).toBe(0)
  })

  it('gives the active marker a blue outline; others stay white', () => {
    const markers = [
      { arrayIndex: 0, streamIndex: 1, kind: 'climb' as const },
      { arrayIndex: 1, streamIndex: 2, kind: 'effort' as const },
    ]
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={0} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance"
        highlightMarkers={markers} activeArrayIndex={0} />,
    )
    const circles = container.querySelectorAll('[data-testid="graph-marker"] circle[r="9"]')
    expect(circles).toHaveLength(2)
    expect(circles[0]).toHaveAttribute('stroke', '#60a5fa')
    expect(circles[0]).toHaveAttribute('stroke-width', '4')
    expect(circles[1]).toHaveAttribute('stroke', '#fff')
    expect(circles[1]).toHaveAttribute('stroke-width', '2')
  })
})
