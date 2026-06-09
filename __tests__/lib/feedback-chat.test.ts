import { buildFeedbackChatSystemPrompt } from '@/lib/claude/feedback-chat'
import { COACH_PERSONA } from '@/lib/claude/coach-memory'
import { makeWorkout } from '../support/factories'

const workout = makeWorkout({
  date: '2026-05-10',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  status: 'completed',
})

describe('buildFeedbackChatSystemPrompt', () => {
  it('includes the session details, signals, execution and the coach note', () => {
    const prompt = buildFeedbackChatSystemPrompt(
      workout,
      { rpe: 7, feel: 3, completion: 'as_planned', tags: ['poor_sleep'], mood: 2 },
      'Planned steps: Work 20min @ 95%\nActual intervals: Work 20:00 avg 248W',
      'Solid threshold work — you held the back half well.',
    )
    expect(prompt).toContain('2x20min at threshold')
    expect(prompt).toContain('Zone 4 (91-105% FTP)')
    expect(prompt).toContain('RPE 7/10')
    expect(prompt).toContain('poor sleep')
    expect(prompt).toContain('Actual intervals: Work 20:00 avg 248W')
    expect(prompt).toContain('Solid threshold work — you held the back half well.')
  })

  it('instructs the coach to discuss the session and take usefulness feedback', () => {
    const prompt = buildFeedbackChatSystemPrompt(workout, {}, '', 'nice ride')
    expect(prompt.toLowerCase()).toContain('coach')
    // mentions that the athlete may push back on the assessment / its usefulness
    expect(prompt.toLowerCase()).toMatch(/useful|disagree|push back|feedback on/)
  })

  it('omits the coach-note line when there is no note', () => {
    const prompt = buildFeedbackChatSystemPrompt(workout, {}, '', '')
    expect(prompt).not.toContain('Your note to the athlete')
  })

  it('includes memory block when provided', () => {
    const p = buildFeedbackChatSystemPrompt(
      workout,
      { rpe: 7, feel: 3, completion: 'as_planned', tags: [], mood: null },
      '',
      '',
      'RECENT CONVERSATIONS:\n[plan, yesterday] Athlete: tired legs',
    )
    expect(p).toContain('RECENT CONVERSATIONS')
    expect(p).toContain('tired legs')
  })

  it('starts with COACH_PERSONA when memory block provided', () => {
    const p = buildFeedbackChatSystemPrompt(workout, {}, '', '', 'MEM')
    expect(p.startsWith(COACH_PERSONA)).toBe(true)
  })
})
