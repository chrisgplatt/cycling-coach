<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Mobile-first UI

This is a PWA used primarily on mobile. Every UI change must be mobile-compatible:
- Design for small screens first (≥320px wide). Use responsive Tailwind classes (`sm:`, `md:`) to enhance on larger screens.
- Modals and sheets: use `items-end sm:items-center` so they slide up from the bottom on mobile. Add `max-h-[92vh] overflow-y-auto` to prevent overflow on short screens.
- Avoid fixed-width grids that don't scale — use `grid-cols-2` only where each column is at least ~130px wide; fall back to single column when content is text-heavy.
- Touch targets must be at least 44px tall (`py-2.5` or larger on interactive elements).
- Never rely on hover interactions for core functionality.
- Test layouts mentally at 375px width before committing.
