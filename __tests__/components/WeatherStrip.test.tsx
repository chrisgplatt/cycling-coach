import { render, screen } from '@testing-library/react'
import WeatherStrip from '@/components/WeatherStrip'
import type { WeatherSummary } from '@/types'

const w: WeatherSummary = {
  temp_min_c: 8.1, temp_max_c: 14.2, precip_prob_pct: 75,
  wind_max_kph: 22.3, gust_max_kph: 38.5, weather_code: 65, description: 'Heavy rain',
}

describe('WeatherStrip', () => {
  it('renders temp range, rain chance and gusts', () => {
    render(<WeatherStrip weather={w} />)
    const strip = screen.getByTestId('weather-strip')
    expect(strip).toHaveTextContent('8–14°C')
    expect(strip).toHaveTextContent('75%')
    expect(strip).toHaveTextContent(/gust/i)
    expect(strip).toHaveTextContent('39')
  })

  it('shows the weather description', () => {
    render(<WeatherStrip weather={w} />)
    expect(screen.getByTestId('weather-strip')).toHaveTextContent('Heavy rain')
  })
})
