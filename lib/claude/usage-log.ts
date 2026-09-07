interface UsageLoggable {
  model?: string
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  }
}

// Every call site logs its token usage here so spend is measurable from Vercel logs
// without an Admin API key. A no-op (not a throw) when usage is absent, so passing a
// test mock's bare response object is always safe.
export function logUsage(label: string, response: UsageLoggable): void {
  if (!response?.usage) return
  const u = response.usage
  console.log(JSON.stringify({
    claude_usage: true,
    label,
    model: response.model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  }))
}
