/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal in-memory Supabase stand-in for route tests: real filtering/mutation semantics
// plus an optional constraint hook (used to emulate the bikes partial unique indexes).
type Row = Record<string, any>

export function gearChecks(table: string, rows: Row[]): string | null {
  if (table !== 'bikes') return null
  for (const col of ['is_default', 'is_indoor_default']) {
    const seen = new Set<string>()
    for (const r of rows) {
      if (!r[col]) continue
      if (seen.has(r.user_id)) return `duplicate key value violates unique constraint (${col})`
      seen.add(r.user_id)
    }
  }
  return null
}

export function makeDb(
  seed: Record<string, Row[]> = {},
  opts: { userId?: string | null; check?: (table: string, rows: Row[]) => string | null } = {},
) {
  const userId = opts.userId === undefined ? 'u1' : opts.userId
  const check = opts.check ?? gearChecks
  const tables: Record<string, Row[]> = {}
  for (const k of Object.keys(seed)) tables[k] = seed[k].map(r => ({ ...r }))
  const get = (t: string) => (tables[t] ??= [])
  let n = 0

  function from(table: string) {
    const st: any = { op: 'select', filters: [] as Array<(r: Row) => boolean>, payload: null, returning: false, single: false, maybe: false, head: false, range: null }
    const b: any = {}
    b.select = (_c?: string, o?: { count?: string; head?: boolean }) => {
      if (st.op !== 'select') st.returning = true
      if (o?.head) st.head = true
      return b
    }
    b.insert = (p: any) => { st.op = 'insert'; st.payload = p; return b }
    b.update = (p: any) => { st.op = 'update'; st.payload = p; return b }
    b.delete = () => { st.op = 'delete'; return b }
    b.eq = (c: string, v: any) => { st.filters.push((r: Row) => r[c] === v); return b }
    b.neq = (c: string, v: any) => { st.filters.push((r: Row) => r[c] !== v); return b }
    b.in = (c: string, vs: any[]) => { st.filters.push((r: Row) => vs.includes(r[c])); return b }
    b.is = (c: string, v: any) => { st.filters.push((r: Row) => (r[c] ?? null) === v); return b }
    b.not = (c: string, op: string, v: any) => {
      if (op !== 'is') throw new Error(`fake: unsupported not(${op})`)
      st.filters.push((r: Row) => (r[c] ?? null) !== v); return b
    }
    b.gte = (c: string, v: any) => { st.filters.push((r: Row) => r[c] >= v); return b }
    b.order = () => b
    b.range = (a: number, z: number) => { st.range = [a, z]; return b }
    b.single = () => { st.single = true; return b }
    b.maybeSingle = () => { st.maybe = true; return b }

    function exec() {
      const rows = get(table)
      const match = rows.filter(r => st.filters.every((f: (r: Row) => boolean) => f(r)))
      const snapshot = rows.map(r => ({ ...r }))
      let out: Row[]
      if (st.op === 'insert') {
        const items = Array.isArray(st.payload) ? st.payload : [st.payload]
        out = items.map((i: Row) => ({ id: `id-${++n}`, ...i }))
        rows.push(...out)
      } else if (st.op === 'update') {
        match.forEach(r => Object.assign(r, st.payload)); out = match
      } else if (st.op === 'delete') {
        tables[table] = rows.filter(r => !match.includes(r)); out = match
      } else {
        out = st.range ? match.slice(st.range[0], st.range[1] + 1) : match
      }
      if (st.op !== 'select') {
        const err = check(table, get(table))
        if (err) { tables[table] = snapshot; return { data: null, error: { message: err } } }
      }
      if (st.op === 'select' && st.head) return { data: null, count: match.length, error: null }
      let data: any = st.op === 'select' || st.returning ? out : null
      if (st.single) {
        if (out.length !== 1) return { data: null, error: { message: 'single row expected' } }
        data = data === null ? null : out[0]
      } else if (st.maybe) data = data === null ? null : (out[0] ?? null)
      return { data, error: null }
    }
    b.then = (res: any, rej: any) => Promise.resolve(exec()).then(res, rej)
    return b
  }

  const client: any = {
    from,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
  }
  return { client, tables }
}
