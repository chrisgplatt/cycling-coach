import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { target_event_name, target_event_date } = await req.json()

  const { data: plan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('status', 'active')
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 404 })

  const { error } = await supabase
    .from('training_plans')
    .update({
      target_event_name: target_event_name ?? '',
      target_event_date: target_event_date ?? '',
    })
    .eq('id', plan.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
