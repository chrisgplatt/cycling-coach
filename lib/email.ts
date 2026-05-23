import { Resend } from 'resend'
import type { Workout } from '@/types'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.RESEND_FROM ?? 'My Cycling Coach <onboarding@resend.dev>'

export async function sendBriefingEmail(
  to: string,
  coachNote: string,
  todayWorkout: Workout | null,
  date: string,
): Promise<void> {
  const dayLabel = new Date(date).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  const sessionLine = todayWorkout
    ? `<p style="margin:0 0 8px"><strong>Today:</strong> ${todayWorkout.type.charAt(0).toUpperCase() + todayWorkout.type.slice(1)} · ${todayWorkout.duration_minutes} min</p>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
    <div style="background:#1e293b;padding:20px 24px">
      <p style="margin:0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">My Cycling Coach</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#f8fafc">${dayLabel}</p>
    </div>
    <div style="padding:24px">
      ${sessionLine}
      <p style="margin:0;font-size:15px;color:#475569;line-height:1.6">${coachNote}</p>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #f1f5f9;background:#f8fafc">
      <p style="margin:0;font-size:11px;color:#94a3b8">Open <a href="https://cycling-coach-theta.vercel.app/dashboard" style="color:#3b82f6;text-decoration:none">My Cycling Coach</a> to view your full plan.</p>
    </div>
  </div>
</body>
</html>`

  const text = [
    dayLabel,
    todayWorkout ? `Today: ${todayWorkout.type} · ${todayWorkout.duration_minutes} min` : '',
    '',
    coachNote,
  ].filter(l => l !== undefined).join('\n')

  await resend.emails.send({
    from: FROM,
    to,
    subject: `Morning briefing · ${dayLabel}`,
    html,
    text,
  })
}
