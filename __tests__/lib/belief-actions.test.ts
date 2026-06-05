import { beliefActionPatch } from '@/lib/athlete-model/actions'

const NOW = '2026-06-05T10:00:00Z'

describe('beliefActionPatch', () => {
  it('confirm pins the athlete-stated belief at high confidence and clears contradiction', () => {
    expect(beliefActionPatch('confirm', undefined, NOW)).toEqual({
      status: 'confirmed', source: 'athlete', confidence: 'high',
      last_confirmed: NOW, last_updated: NOW, contradiction: null,
    })
  })

  it('correct stores the athlete wording as the value', () => {
    expect(beliefActionPatch('correct', '  I recover fast.  ', NOW)).toEqual({
      status: 'corrected', source: 'athlete', confidence: 'high', value_text: 'I recover fast.',
      last_confirmed: NOW, last_updated: NOW, contradiction: null,
    })
  })

  it('correct rejects empty text', () => {
    expect(beliefActionPatch('correct', '   ', NOW)).toBeNull()
    expect(beliefActionPatch('correct', undefined, NOW)).toBeNull()
  })

  it('dismiss flips status only', () => {
    expect(beliefActionPatch('dismiss', undefined, NOW)).toEqual({ status: 'dismissed', last_updated: NOW })
  })

  it('returns null for an unknown action', () => {
    expect(beliefActionPatch('explode' as never, undefined, NOW)).toBeNull()
  })
})
