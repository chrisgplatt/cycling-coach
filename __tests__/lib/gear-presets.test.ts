import { triggerPresetsFor, COMPONENT_CATEGORIES } from '@/lib/gear/presets'

describe('triggerPresetsFor', () => {
  it('chain gets a recurring re-wax and a lifetime replacement', () => {
    const p = triggerPresetsFor('chain')
    expect(p.map(t => [t.label, t.kind, t.metric, t.interval_value])).toEqual([
      ['Re-wax', 'recurring', 'km', 300],
      ['Replace chain', 'lifetime', 'km', 4000],
    ])
  })
  it('wear parts get a single lifetime replacement', () => {
    for (const c of ['cassette', 'tyre', 'brake_pads'] as const) {
      const p = triggerPresetsFor(c)
      expect(p).toHaveLength(1)
      expect(p[0].kind).toBe('lifetime')
    }
  })
  it('categories without presets return none', () => {
    expect(triggerPresetsFor('bar_tape')).toEqual([])
    expect(triggerPresetsFor('other')).toEqual([])
  })
  it('lists every category once with a label', () => {
    const values = COMPONENT_CATEGORIES.map(c => c.value)
    expect(new Set(values).size).toBe(values.length)
    expect(COMPONENT_CATEGORIES.every(c => c.label.length > 0)).toBe(true)
  })
})
