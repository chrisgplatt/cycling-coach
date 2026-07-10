import type { SupabaseClient } from '@supabase/supabase-js'

export interface FtpAnchor {
  createdAt: string
  predictedFtp: number
}

export function resolveFallbackFtp(
  date: string,
  confirmedPredictions: FtpAnchor[],
  planBaselineFtp: number | null,
): number | null {
  const applicable = confirmedPredictions
    .filter(p => p.createdAt.slice(0, 10) <= date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (applicable.length > 0) return applicable[0].predictedFtp
  return planBaselineFtp
}

export async function resolveFallbackFtpForWorkout(
  supabase: SupabaseClient,
  date: string,
  planId: string | null,
): Promise<number | null> {
  const { data: predictions } = await supabase
    .from('ftp_predictions')
    .select('created_at, predicted_ftp')
    .eq('confirmed', true)
  const anchors: FtpAnchor[] = (predictions ?? []).map((p: { created_at: string; predicted_ftp: number }) => ({
    createdAt: p.created_at,
    predictedFtp: p.predicted_ftp,
  }))

  let planBaselineFtp: number | null = null
  if (planId) {
    const { data: plan } = await supabase.from('training_plans').select('baseline_ftp').eq('id', planId).maybeSingle()
    planBaselineFtp = plan?.baseline_ftp ?? null
  }

  return resolveFallbackFtp(date, anchors, planBaselineFtp)
}
