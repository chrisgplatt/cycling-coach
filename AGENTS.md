<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Before committing

Always run `npm run typecheck` before committing. Jest does not surface TypeScript type errors — `tsc --noEmit` is required. The CI pipeline runs typecheck separately and will fail if you skip it. The `npm run test:ci` script runs both in sequence.

# Database migrations

There is no automated migration deploy step — the Supabase project isn't linked via CLI and CI only runs typecheck/tests. Any file added to `supabase/migrations/` must be run manually against the shared production database (Supabase SQL editor, or `supabase db push` if linked locally) **before or as part of** deploying the app version that depends on it. If app code ships first, every user hits a "Could not find the 'X' column ... in the schema cache" error until the migration is run.

- When you add a new migration file, tell the user the exact SQL to run and remind them to run it against the shared Supabase project.
- Prefer `add column if not exists` / other idempotent forms so a migration can be safely re-run if it's unclear whether it was already applied.
- After running SQL manually, force PostgREST to pick up the change immediately with `notify pgrst, 'reload schema';` rather than waiting on its periodic cache refresh.

# Mobile-first UI

This is a PWA used primarily on mobile. Every UI change must be mobile-compatible:
- Design for small screens first (≥320px wide). Use responsive Tailwind classes (`sm:`, `md:`) to enhance on larger screens.
- Modals and sheets: use `items-end sm:items-center` so they slide up from the bottom on mobile. Add `max-h-[92vh] overflow-y-auto` to prevent overflow on short screens.
- Avoid fixed-width grids that don't scale — use `grid-cols-2` only where each column is at least ~130px wide; fall back to single column when content is text-heavy.
- Touch targets must be at least 44px tall (`py-2.5` or larger on interactive elements).
- Never rely on hover interactions for core functionality.
- Test layouts mentally at 375px width before committing.
