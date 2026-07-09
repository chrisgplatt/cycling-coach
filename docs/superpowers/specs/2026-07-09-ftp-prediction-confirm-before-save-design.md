# FTP Prediction: Confirm Before Save — Design Spec

**Goal:** Stop silently persisting every FTP prediction to `ftp_predictions` the moment "Predict FTP" is clicked. A prediction should only be written to the database once the athlete explicitly says they want it kept — and separately, applying a saved prediction to the live profile FTP (`user_profile.current_ftp`) should be its own explicit decision.

**Architecture:** `app/api/ftp/route.ts`'s POST handler currently runs the full analysis (activities, power curve, CP model, dossier, recent feedback, the Claude call in `lib/claude/ftp.ts`) and unconditionally inserts the result into `ftp_predictions` with `confirmed: false` before returning it. The insert is removed from this handler entirely — it becomes a pure compute-and-return endpoint. Two new endpoints own persistence: `POST /api/ftp/confirm` inserts a client-supplied prediction payload (the "save" decision), and `PATCH /api/ftp/[id]/apply` marks a saved prediction `confirmed: true` and writes its `predicted_ftp` to `user_profile.current_ftp` (the "apply" decision, only ever available for a prediction that has already been saved). The existing `confirmed` column is reused as-is — it already meant "applied to profile," it just had nothing setting it before.

On the client (`app/fitness/page.tsx`), a freshly-computed prediction is held as an unsaved draft in component state, rendered with Save/Discard actions, and never touches the `predictions` (history) array until the user clicks Save. Discarding a draft is a pure client-side no-op — nothing was ever sent to the confirm endpoint, so there is nothing to clean up. The recency-cooldown logic (`nextPredictionDate` / the "prediction run recently" warning) stays keyed off the saved `predictions` history, so a discarded draft doesn't count against the athlete's next attempt.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (existing RLS: `user_id = auth.uid()` on `ftp_predictions` and `user_profile` already scopes ownership — no new authorization logic needed), Claude (Anthropic SDK). No new dependencies, no schema migration (the `confirmed` column already exists).

---

## API changes

### `app/api/ftp/route.ts` — POST (modified)

All existing computation is unchanged: fetch activities + power curve, compute the CP model and algorithmic estimate, fetch the dossier and recent threshold/intervals feedback, call `predictFTP(...)`. The only change is at the end — remove the `supabase.from('ftp_predictions').insert(...)` call and its `.select().single()`, and instead return the raw result directly:

```ts
return NextResponse.json({
  predicted_ftp: result.predicted_ftp,
  reasoning: result.reasoning,
  confidence: result.confidence,
  activity_ids: activities.map(a => a.id),
})
```

This response has no `id`, `created_at`, `user_id`, or `confirmed` — it isn't a database row, it's a draft. GET (history list, `order('created_at', ...).limit(20)`) is unchanged.

### `app/api/ftp/confirm/route.ts` — POST (new)

Auth-checked the same way as the existing route. Request body is the draft shape above (`predicted_ftp`, `reasoning`, `confidence`, `activity_ids`). Validates the shape minimally (numeric `predicted_ftp`, non-empty `reasoning` string, `confidence` in `('high','medium','low')`, `activity_ids` an array of strings) and rejects with 400 on mismatch — this endpoint trusts an authenticated client but not an arbitrary payload shape, since a malformed body would otherwise produce a confusing DB error. Inserts into `ftp_predictions` with `confirmed: false`, `user_id: user.id`, and returns the saved row (`.select().single()`), matching what the old inline insert returned.

### `app/api/ftp/[id]/apply/route.ts` — PATCH (new)

Auth-checked. Takes no request body — the `id` in the URL is the only input. The update itself is scoped by both `id` and RLS (`user_id = auth.uid()`), so an id belonging to another user simply matches zero rows and updates nothing. Two writes, sequential (no cross-table transaction primitive available via the Supabase JS client, and unnecessary here — this is a single-user-at-a-time hobby app with no concurrent-write risk on these tables):

1. `update ftp_predictions set confirmed = true where id = :id`, returning the updated row; if no row was updated (bad id / not owned), respond 404 and stop — do not proceed to step 2.
2. `update user_profile set current_ftp = :predicted_ftp` using the `predicted_ftp` value read back from the row updated in step 1 (not a client-supplied value — the server is the source of truth for what "this prediction's value" means).

Returns the updated prediction row.

---

## Client changes (`app/fitness/page.tsx`)

**New state:** `draftPrediction: PredictionDraft | null` (a new lightweight type — same fields as `FTPPrediction` minus `id`/`created_at`/`user_id`/`confirmed`). Replaces the current behavior where `runPrediction()` prepends straight into `predictions`.

**`runPrediction()`:** unchanged up through the `POST /api/ftp` call. On success, `setDraftPrediction(json)` instead of `setPredictions(prev => [json, ...prev])`. No longer sets `pendingFTPUpdate` here — that now happens after Save, not after Predict.

**Draft rendering:** when `draftPrediction` is set, it renders in the same visual slot as today's "Latest" prediction card (predicted value, confidence badge, full bulleted reasoning) with a clear "not saved yet" marker, and two actions:
- **Discard** → `setDraftPrediction(null)`. Nothing else happens; no network call.
- **Save** → `POST /api/ftp/confirm` with the draft body. On success: prepend the returned saved row to `predictions`, `setActivePrediction(0)`, clear the draft. If the saved row's `predicted_ftp !== currentFTP`, immediately open the "Update profile FTP?" modal.

**"Update profile FTP?" modal:** `pendingFTPUpdate` (currently `number | null`, just the predicted value) becomes `{ id: string; predictedFtp: number } | null`, since the modal's confirm action now needs the saved prediction's id, not just its value. Its confirm button (currently `updateProfileFTP`) is replaced by an `applyPrediction(pendingFTPUpdate)` function that calls `PATCH /api/ftp/${pendingFTPUpdate.id}/apply` (no request body — see below), then on success `setCurrentFTP(pendingFTPUpdate.predictedFtp)` and patches the matching entry in local `predictions` state to `confirmed: true` (so the badge updates immediately, no refetch needed). Declining the modal just clears `pendingFTPUpdate` — the prediction stays saved with `confirmed: false` and, per the agreed scope, is not revisited later from history; a future "Predict FTP" run is the way to reconsider.

**Recency warning:** `daysSinceLast` / `nextPredictionDate` computation is unchanged — it already derives from `predictions[0]`, which now only ever contains saved (not draft) predictions, so this is correct by construction with no code change needed.

**Copy:** the "✓ confirmed" badge (`app/fitness/page.tsx:1004`) becomes "✓ applied to profile" to disambiguate "saved" from "applied" now that they're different states.

---

## Types (`types/index.ts`)

Add a `PredictionDraft` type (or equivalent name) for the unsaved shape:

```ts
export interface PredictionDraft {
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  activity_ids: string[]
}
```

`FTPPrediction` (the existing saved-row type) is unchanged.

---

## Error handling

- `POST /api/ftp/confirm` failure (network or server error): the draft stays on screen with an error banner. The athlete doesn't lose the already-generated (and Claude-API-costed) analysis and can retry Save without re-running the prediction.
- `PATCH /api/ftp/[id]/apply` failure: the modal stays open with an error banner so the athlete can retry; the prediction remains saved with `confirmed: false` either way — no partial/inconsistent state is possible since the two writes inside that handler are ordered (profile is only updated after the prediction row update succeeds).
- An unsaved draft lives only in React state. Navigating away or refreshing the page loses it silently — equivalent to an unsubmitted form, and consistent with "nothing is saved without explicit confirmation." No local storage or draft-recovery mechanism is in scope.

---

## Testing

No existing test coverage exists for this flow (`app/api/ftp/route.ts` and the predict/confirm UI in `FitnessPage` are both currently untested), so this is net-new coverage, not a modification of existing tests:

- **`app/api/ftp/route.ts`:** POST returns the draft shape and performs no `ftp_predictions` insert (mock the Supabase client and assert `.insert` is never called on that table).
- **`app/api/ftp/confirm/route.ts`:** successful insert with `confirmed: false`; 401 when unauthenticated; 400 on malformed body (missing/wrong-typed fields).
- **`app/api/ftp/[id]/apply/route.ts`:** sets `confirmed: true` and updates `user_profile.current_ftp`; 401 when unauthenticated; 404 for an id that doesn't exist or isn't owned by the authenticated user (RLS-scoped update affecting zero rows).
- **`FitnessPage` component:**
  - Running a prediction shows a draft with Save/Discard, and does not appear in the saved history/tab list.
  - Discard clears the draft and makes no network call to the confirm endpoint.
  - Save calls the confirm endpoint and moves the result into saved history as "Latest."
  - Save with a changed value opens the apply modal; confirming it calls the apply endpoint, updates the displayed current FTP, and flips the badge to "applied to profile."
  - Declining the apply modal leaves the prediction saved but unconfirmed, with no further prompt.
  - The recency-warning cooldown is unaffected by a discarded draft (only counts saved predictions).

---

## Out of scope

- No automated/cron FTP prediction generation exists anywhere in the codebase today (confirmed via search — only the manual "Predict FTP" button calls `predictFTP`), so there is no automation path that needs a confirmation workaround.
- Applying a saved-but-unconfirmed prediction from FTP History later (after the initial save moment) is explicitly out of scope per product decision — only immediately after saving is the apply option offered.
- No schema migration — `confirmed` already exists and is repurposed with its original intended meaning.
