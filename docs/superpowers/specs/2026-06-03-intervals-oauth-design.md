# intervals.icu OAuth Connection Layer — Design Spec

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Part of:** A two-subsystem effort to add near-real-time activity ingest. This is
**Subsystem A** (the OAuth foundation). **Subsystem B** (webhook receiver) is a
separate later spec that depends on this one.

## Goal

Let a user connect their intervals.icu account to the app via OAuth 2.0, producing a
stored **bearer access token** and the connected **athlete id**. This is the
foundation the webhook receiver needs (app-level webhooks are delivered only for
athletes who have authorized the registered app via OAuth — the per-user API key the
app pastes today does not receive webhooks). It is also a strict upgrade to onboarding.

## Why OAuth (confirmed against intervals.icu docs)

- Authorize URL: `https://intervals.icu/oauth/authorize`
- Token URL: `https://intervals.icu/api/oauth/token`
- Flow: standard **authorization code** (no PKCE documented; no `response_type` required).
- **No refresh tokens** — intervals.icu issues only a long-lived access token. There is
  no refresh cron or expiry bookkeeping. If a token is ever revoked, calls 401 and the
  user reconnects.
- Token response includes the athlete, e.g.:
  ```json
  { "token_type": "Bearer", "access_token": "…", "scope": "ACTIVITY:READ,…",
    "athlete": { "id": "2049151", "name": "David (intervals.icu)" } }
  ```
- Scopes are comma-separated `SCOPE:READ|WRITE`. Available: ACTIVITY, WELLNESS,
  CALENDAR, CHATS, LIBRARY, SETTINGS.

## Non-Goals

- The webhook receiver itself (Subsystem B).
- Refresh-token handling (intervals.icu has none).
- Migrating **all** ~57 references to the API key. Only the hot runtime call sites move
  onto the resolver (listed below); tests/docs/cold paths are out of scope.
- Removing the API-key field. Decision: **keep both, OAuth preferred** (legacy fallback retained).

## Prerequisite (user action — cannot be automated)

intervals.icu app registration is **manual and approval-gated**. The user must email the
intervals.icu admin (app name, description, square logo URL ≥128px, privacy-policy URL,
redirect URI(s), their intervals.icu ID) and receive `client_id` / `client_secret`.
`http://localhost/` is always permitted, so development proceeds against localhost before
the production redirect URI is approved. The implementation must not hard-fail when the
env vars are absent — the "Connect" button is simply disabled / shows "not configured".

New environment variables:
- `INTERVALS_OAUTH_CLIENT_ID`
- `INTERVALS_OAUTH_CLIENT_SECRET`
- `INTERVALS_OAUTH_REDIRECT_URI` — the absolute callback URL
  (e.g. `https://<app>/api/intervals/oauth/callback`, or `http://localhost:3000/api/intervals/oauth/callback` in dev).

---

## Data model

Migration `supabase/migrations/20260603_intervals_oauth.sql` adds four nullable columns
to `user_profile`:

```sql
alter table user_profile add column if not exists intervals_oauth_token text;
alter table user_profile add column if not exists intervals_oauth_athlete_id text;
alter table user_profile add column if not exists intervals_oauth_scope text;
alter table user_profile add column if not exists intervals_connected_at timestamptz;
```

The existing `intervals_icu_api_key` and `intervals_icu_athlete_id` are unchanged and
serve as the legacy fallback. `UserProfile` in `types/index.ts` gains the four optional
fields (`string | null` / timestamptz as string).

A user is "connected via OAuth" when `intervals_oauth_token` is non-null.

---

## Components

### 1. `lib/intervals/oauth.ts` (pure helpers — TDD core)

```ts
export const OAUTH_SCOPES = 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ,CALENDAR:WRITE'
export const AUTHORIZE_URL = 'https://intervals.icu/oauth/authorize'
export const TOKEN_URL = 'https://intervals.icu/api/oauth/token'

export function buildAuthorizeUrl(opts: {
  clientId: string; redirectUri: string; state: string; scopes?: string
}): string
// -> `${AUTHORIZE_URL}?client_id=…&redirect_uri=<enc>&scope=<enc>&state=<enc>`

export interface IntervalsTokenResponse {
  access_token: string
  token_type: string
  scope: string
  athlete: { id: string; name: string }
}

/** Validate + narrow the raw token-endpoint JSON. Throws on malformed shape. */
export function parseTokenResponse(raw: unknown): IntervalsTokenResponse
```

`buildAuthorizeUrl` URL-encodes every param. `parseTokenResponse` checks that
`access_token` is a non-empty string and `athlete.id` is present, throwing a clear error
otherwise (the callback turns that into a redirect with an error message).

### 2. `lib/intervals/auth.ts` (resolver — TDD core)

```ts
export type IntervalsAuth =
  | { mode: 'oauth'; athleteId: string; bearerToken: string }
  | { mode: 'apikey'; athleteId: string; apiKey: string }

export interface IntervalsAuthProfile {
  intervals_oauth_token: string | null
  intervals_oauth_athlete_id: string | null
  intervals_icu_api_key: string | null
  intervals_icu_athlete_id: string | null
}

/** Prefer OAuth when a token is present; else API key; else null. */
export function resolveIntervalsAuth(p: IntervalsAuthProfile): IntervalsAuth | null
```

Rules:
- OAuth token present **and** an athlete id available (`intervals_oauth_athlete_id`,
  falling back to `intervals_icu_athlete_id`) → `{ mode: 'oauth', … }`.
- Else API key present and `intervals_icu_athlete_id` present → `{ mode: 'apikey', … }`.
- Else `null`.

### 3. `IntervalsClient` — bearer support (`lib/intervals/client.ts`)

The constructor currently is `constructor(private athleteId: string, apiKey: string)`
and sets `this.authHeader = 'Basic ' + base64('API_KEY:'+apiKey)`. Change it to accept an
auth descriptor while preserving the existing 2-arg signature for the legacy call sites:

```ts
type ClientAuth =
  | { apiKey: string }
  | { bearerToken: string }

// Back-compat: (athleteId, apiKey) still works.
constructor(athleteId: string, auth: string | ClientAuth)
```

- `string` or `{ apiKey }` → `Authorization: Basic base64('API_KEY:'+key)` (unchanged).
- `{ bearerToken }` → `Authorization: Bearer <token>`.

Add a factory:

```ts
import { resolveIntervalsAuth, type IntervalsAuthProfile } from './auth'

static fromProfile(p: IntervalsAuthProfile): IntervalsClient | null {
  const auth = resolveIntervalsAuth(p)
  if (!auth) return null
  return auth.mode === 'oauth'
    ? new IntervalsClient(auth.athleteId, { bearerToken: auth.bearerToken })
    : new IntervalsClient(auth.athleteId, { apiKey: auth.apiKey })
}
```

**Stale-token handling:** when a request returns HTTP 401 **in bearer mode**, the client
throws a typed error `IntervalsAuthError` (a subclass/flagged Error with
`code: 'oauth_unauthorized'`). Call sites already wrap intervals calls in try/catch and
degrade gracefully; the Settings page separately reflects connection state from the
profile, and a 401 path may clear `intervals_oauth_token` so the resolver falls back to
the API key on the next call. (Clearing-on-401 happens only in the interactive sync path,
not in cron, to avoid races — see Runtime migration.)

### 4. Routes under `app/api/intervals/`

**`oauth/start/route.ts` (GET)**
- Require an authenticated Supabase user (else redirect to login).
- If `INTERVALS_OAUTH_CLIENT_ID` / `INTERVALS_OAUTH_REDIRECT_URI` are unset → redirect to
  `/settings?intervals=not_configured`.
- Generate a random `state` nonce; set it in a `__Host`-style httpOnly, secure,
  short-lived cookie (`intervals_oauth_state`).
- `redirect(buildAuthorizeUrl({ clientId, redirectUri, state }))`.

**`oauth/callback/route.ts` (GET)**
- Read `code` and `state` from query; read the `state` cookie. If missing/mismatch →
  redirect `/settings?intervals=state_error`. Clear the cookie.
- Require the authenticated Supabase user (the browser still carries the session).
- `POST` to `TOKEN_URL` with `client_id`, `client_secret`, `code`, `redirect_uri`,
  `grant_type=authorization_code` as `application/x-www-form-urlencoded`. Parse with
  `parseTokenResponse`. (During implementation, confirm against the intervals.icu token
  endpoint whether it expects `client_secret` in the body — assumed here — or via HTTP
  Basic auth; the request builder must be a single tested helper so this is a one-line change.)
- Persist to `user_profile` for the user: `intervals_oauth_token = access_token`,
  `intervals_oauth_athlete_id = athlete.id`, `intervals_oauth_scope = scope`,
  `intervals_connected_at = now()`.
- Redirect `/settings?intervals=connected`.
- Any failure → `/settings?intervals=error` (do not leak token/secret in logs).

**`disconnect/route.ts` (POST)**
- Authenticated user; set the four OAuth columns to null; return `{ ok: true }`.

### 5. Settings UI (`app/settings/page.tsx`)

In the intervals.icu configuration section:
- **Primary:** a "Connect intervals.icu" button linking to `/api/intervals/oauth/start`.
  When connected, show "Connected as {athlete name or id} ✓" + a "Disconnect" button
  (POST `disconnect`, then refresh). Surface `?intervals=` query outcomes
  (connected / error / state_error / not_configured) as a small status line.
- **Secondary/legacy:** the existing API-key + athlete-id fields remain beneath, under a
  muted "Advanced: connect with an API key instead" heading.
- The connected athlete name: the callback stores `intervals_oauth_athlete_id`; the page
  can display the id, or (nice-to-have, not required) the profile may also store the
  athlete name. Decision: **store id only**; display "Connected ✓ (athlete {id})".
- Mobile-first per AGENTS.md (≥320px, 44px touch targets).

### 6. Runtime migration (hot call sites only)

Replace `new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)`
with `IntervalsClient.fromProfile(profile)` (and a null check) in these handlers, updating
each `profile` select to also fetch the OAuth columns:

- `app/api/sync/route.ts`
- `app/api/briefing/today/route.ts`
- `app/api/cron/daily-briefing/route.ts`
- `app/api/events/sync/route.ts`
- `app/api/plan/review/route.ts` (intervals event push, if it constructs a client)
- `app/api/hrv/route.ts`

Each site: if `fromProfile` returns null, keep the existing "not configured" error/branch.
Behaviour is otherwise unchanged — the resolver simply prefers the OAuth token when present.
Other references (tests, docs, `repush-planned`, `import-rides`, ride-streams, etc.) are
left on the existing path for this subsystem; they continue to work because the API-key
columns are untouched. (A follow-up can migrate the long tail once OAuth is proven.)

---

## Data flow (connect)

```
Settings "Connect" ─▶ GET /api/intervals/oauth/start
  (set state cookie) ─▶ 302 intervals.icu/oauth/authorize
       user consents ─▶ 302 back to /api/intervals/oauth/callback?code&state
  validate state + session ─▶ POST intervals.icu/api/oauth/token (code + secret)
       parseTokenResponse ─▶ store token + athlete_id on user_profile
                          ─▶ 302 /settings?intervals=connected
```

## Data flow (runtime call, e.g. sync)

```
handler reads user_profile (incl. oauth cols)
  ─▶ IntervalsClient.fromProfile(profile)
       token present? Bearer : Basic(API key)
  ─▶ intervals.icu API call
       401 in bearer mode ─▶ IntervalsAuthError ─▶ (interactive) clear token, surface "reconnect"
```

---

## Error handling

- Missing env config → "Connect" disabled / `not_configured` status; never throws.
- `state` mismatch/absent → `state_error`, no token exchange.
- Token-endpoint non-200 or malformed body → `parseTokenResponse` throws → `error` status;
  token/secret never logged.
- Runtime 401 in bearer mode → typed `IntervalsAuthError`; interactive sync clears the
  stale token (fallback to API key next call); cron logs and skips without clearing.
- All existing per-call try/catch degradation is preserved.

---

## Testing strategy

Pure-logic unit tests (the real correctness gate):
- `buildAuthorizeUrl` — correct base, all params present and URL-encoded, scopes default.
- `parseTokenResponse` — valid shape returns typed object; missing `access_token` or
  `athlete.id` throws; non-object throws.
- `resolveIntervalsAuth` — OAuth preferred when token present; API-key fallback; athlete-id
  fallback (`oauth_athlete_id` missing but `icu_athlete_id` present); null when neither.
- `IntervalsClient` — bearer vs basic `Authorization` header selection;
  `fromProfile` returns null when unconfigured; 401 in bearer mode raises `IntervalsAuthError`
  (mock fetch).

Route handlers stay thin; covered by the pure helpers + typecheck. A Settings UI test
asserts the Connect button / connected state render from profile flags.

`npm run typecheck` is the type gate (Jest uses SWC, skips types).

---

## Migration checklist (operational)

- Apply `supabase/migrations/20260603_intervals_oauth.sql` to the live DB.
- Register the intervals.icu app (manual email to admin) and set
  `INTERVALS_OAUTH_CLIENT_ID`, `INTERVALS_OAUTH_CLIENT_SECRET`, `INTERVALS_OAUTH_REDIRECT_URI`
  in the environment (Vercel + `.env.local`). Until set, "Connect" shows `not_configured`
  and the app continues on the API key.

## Hand-off to Subsystem B (webhooks)

This subsystem leaves in place exactly what the webhook receiver needs: a stored bearer
token per user and the `intervals_oauth_athlete_id ↔ user_id` mapping, plus an
`IntervalsClient` that can authenticate from a profile with that token. Subsystem B will
add the app webhook registration, the public callback route (secret-verified), the
`athlete_id → user` lookup, and the sync/briefing trigger.
