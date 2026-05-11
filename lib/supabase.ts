import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Server-only singleton — never import this in client components
export const supabase = createClient(url, key)
