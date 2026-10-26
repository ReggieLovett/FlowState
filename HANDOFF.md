# FlowState assistant and performance handoff

Updated: 2026-10-26 (Asia/Manila). Implementation is complete. Verification results and remaining live setup are recorded below. No live database migration or deployment has been performed.

## User direction

Integrate the assistant and optimize the overall app. Keep FlowState recognizable: existing palette, typography, layout, pixel rewards, and theme preference behavior remain. The user approved restrained design improvements after initially asking to preserve the old look. Final polish is limited to slightly softer cards, clearer focus outlines, touch targets and an accessible mobile drawer.

The assistant must use Groq `openai/gpt-oss-120b`, read the owner's FlowState schedule and Google Calendar, show a movable Isagi Yoichi avatar, use a compact input with nearby dialogue bubbles, and require explicit Confirm before every assistant schedule edit. Idle, walking, meta vision eyes and white/glowing omni vision must be distinct.

## Resume safely if the session or connection ends

1. Work in `/Users/reggielovett/Desktop/projects/project shed` and read `AGENTS.md`.
2. Read the relevant installed Next guides under `node_modules/next/dist/docs/`. Versions here are Next.js 16.3, React 19, Prisma 7 and Auth.js v5 beta.
3. Inspect `git status --short` before editing. The untracked `integrations/google-calendar/` directory existed before this task and is user work; preserve it.
4. Do not print or commit `.env*` secrets, OAuth tokens, prompts or private calendar details.
5. No live database migration, Google event write, production deployment or Git commit was performed. Do not assume the new proposal table exists yet.
6. The local development server was started with `npm run dev -- --hostname 127.0.0.1`. If it is no longer running, start it again. The avatar-only preview is `/assistant-demo` and needs no account or provider keys.

## Setup and rollout

Server environment variables are documented in `.env.example`:

- Existing `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, optional GitHub credentials.
- `GROQ_API_KEY`: server-only Groq key. Never use a `NEXT_PUBLIC_` prefix.
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`: Google OAuth web client credentials.

Google setup:

1. Enable Google Calendar API in the Google Cloud project.
2. Configure consent/testing users as required by your Google project.
3. Add `{origin}/api/auth/callback/google` as the authorized web redirect URI (including the actual local hostname when testing).
4. Sign into the intended FlowState account, open Settings, and use Connect Google Calendar. Reconnect to renew consent or replace expired authorization. Account linking uses the authenticated session, never unverified email matching.
5. The requested scope is `calendar.events.readonly`. Only the primary Google Calendar is read; Google events are never changed.

Database rollout, against the intended database:

```sh
npm run db:deploy
npx prisma generate
npm run build
npm start
```

Migration: `prisma/migrations/20261026000000_add_assistant_proposals/migration.sql`. It creates the proposal enum/table, ownership and lookup indexes, consistency checks and an immutability trigger. Restart a running development server after generating the client/applying the migration. `npm run build` generates the client but does not apply database migrations.

The original Google Fonts setup is retained to preserve appearance. A clean build needs font network access (or an existing Next font cache); the initial sandboxed build failed on that network dependency. No runtime Google Fonts requests are added by the assistant. Installed unit tests/lint/type checks work without provider access.

## Implementation map

- `app/api/assistant/route.ts`: authenticated/rate-limited prompt endpoint.
- `app/api/assistant/proposals/[id]/route.ts`: explicit Confirm/Cancel endpoint.
- `lib/assistant/contracts.ts`: browser-safe request response types.
- `lib/assistant/groq.ts`: server-only strict JSON schema Groq fetch, timeout, refusal/error handling.
- `lib/assistant/context.ts`: bounded owner-scoped schedule/task context and recurrence/truncation detection.
- `lib/assistant/service.ts`: proposal staging and transactional decision orchestration.
- `lib/assistant/validation.ts`: pure move, conflict, snapshot and decision validation.
- `lib/assistant/http.ts`: body limits, schemas, request policies and safe errors.
- `lib/assistant/google-calendar.ts`: owner-scoped OAuth token refresh/persistence, paginated event reads, all-day timezone normalization and fail-closed partial reads.
- `auth.ts`, `lib/actions/google-calendar.ts`, `components/dashboard/GoogleCalendarConnect.tsx`: OAuth provider, safe reconnect token persistence and connection action/UI.
- `prisma/schema.prisma`: `AssistantProposal` and `AssistantProposalStatus`.
- `components/assistant/AssistantLoader.tsx`: separate lazy dashboard client chunk.
- `components/assistant/FloatingAssistant.tsx`: dialogue, movement, requests, errors, expiry and Confirm/Cancel UI.
- `components/assistant/IsagiAvatar.tsx`, `assistant.module.css`: original vector character and animation states.
- `app/assistant-demo/`, `components/assistant/AssistantShowcase.tsx`, `showcase.module.css`: isolated visual preview, eye close-ups, no private data/API calls.
- `lib/schedule-range.ts`: bounded calendar read windows, offsets and event deduplication.

## API contract

`POST /api/assistant`, same-origin JSON:

```json
{ "prompt": "Resolve tomorrow's conflicts", "timeZone": "Asia/Manila" }
```

Response shape:

```text
{
  message,
  proposal?: {
    id, expiresAt,
    changes: [{ eventId, title, fromStart, fromEnd, toStart, toEnd, reason }]
  },
  calendar: { connected, warning? }
}
```

`POST /api/assistant/proposals/[id]`, same-origin JSON:

```json
{ "action": "confirm" }
```

Use `"cancel"` to reject. The endpoint accepts only the saved ID and decision; it refuses edited event IDs, times or other fields. Success is `{ message, status: "APPLIED" | "CANCELLED" }`. Errors are `{ error }` with an HTTP status. Routes explicitly return 401 for signed-out requests, 403 for rejected origins and 415 for non-JSON content. Prompt limit is 8 per 10 minutes; decisions 30 per minute. Body cap is 8 KiB, prompt cap 2000 characters.

## Confirmation guarantee

Prompt processing writes only an immutable pending proposal, never a schedule event. Only existing owned, future, scheduled, timed, nonrecurring FlowState events can move. Durations and titles are preserved. No create/delete/complete operation is exposed to the model.

Confirm re-reads Google busy intervals, locks the owner's proposal row, checks expiry/status and exact source snapshots, validates the whole resulting local timeline, and guards each write by owner/source timestamps. Event moves and APPLIED status commit together in a serializable transaction, with bounded serialization retries. Repeat decisions are idempotent; an applied/cancelled decision cannot be reversed. Cancellation changes proposal status only, including after expiry.

## Avatar behavior and references

- Normal idle: navy hair, blue #11 kit, blue eyes, gentle breathing and an occasional blink.
- Walking: articulated opposing arms/legs and a small body bob. Drag/keyboard movement triggers the stride; Move cycles corners with travel. Travel stops when input/dialogue receives focus.
- Meta vision: navy hair/blue kit retained, green concentric puzzle-pattern eyes and scanning motion.
- Omni vision: distinct icy-white hair/kit, bright cyan/white starburst pupils, orbit and stronger white glow.
- Thinking starts in meta vision; sustained requests evolve to omni after 3.5 seconds. This is an animation timing choice, not a server progress feed. A response briefly retains omni before returning to normal.
- Pointer drag, arrow keys (32 px), Shift+arrows (8 px), Home/reset and a single-click corner control are supported. Bounds follow visual viewport/safe areas. Reduced motion softens movement and disables loops/travel.

Visual references: [official Isagi design](https://tv.bluelock-pr.com/tv1st/character/) and [documented meta vision puzzle motif](https://bluelock.fandom.com/wiki/Metavision). The separate omni state is the user's requested white/glowing interpretation; no claim of an official separate canon form. Artwork is original inline SVG, with no hotlinked images or downloaded animation dependencies.

## Performance and restrained design changes

- Request-local `getSession` deduplicates layout/page/data guard authentication.
- Dashboard total derives from grouped counts; its deadline preview fetches six minimal rows instead of all item histories.
- Schedule subject reads omit unused columns and lifetime count queries. Planner item reads omit unrelated finished/archived work and histories while retaining open work effort, completed exam dates and visible deadlines.
- Browsing an old week reads that week plus the future 28-day planner window in parallel instead of the intervening years. Offsets clamp to ±520 weeks / ±3640 days; results deduplicate spanning events. Current/future planner context is unchanged; ranking while browsing historical years may differ because irrelevant intervening history is no longer supplied.
- TimeGrid memoizes event geometry/deadline buckets, skips unchanged snapped previews, and removes gesture listeners on cancel/blur/unmount/replacement. Existing drag/snap/server-save behavior remains.
- The large schedule planner downloads on demand and preloads on hover/focus.
- Root no longer mounts unused Bootstrap JavaScript. Bootstrap CSS/icons and the original fonts/theme/reward artwork remain. Current dialogs/tooltips/navigation use React/native browser controls.
- Native mobile navigation keeps the existing drawer appearance and adds focus trapping, Escape/backdrop dismissal, trigger focus restoration and desktop-resize closure.
- Existing colors, page organization and reward hero remain. Changes to visual styling are small, use existing tokens, and avoid a redesign.

## Known limits and remaining live verification

- The assistant plans only the next 14 days, at most 12 moves, with 10-minute proposal expiry.
- Context caps: 200 local events, 60 unfinished tasks, 500 Google busy intervals at orchestration. Calendar reader itself can traverse four pages of 250, and rejects incomplete/malformed results. Caps block schedule actions; no partial availability is treated as complete.
- An unconnected Google account permits FlowState-only advice/plans and the UI says so. A linked but unavailable/unauthorized/incomplete calendar blocks actions.
- Local RRULE occurrence expansion is not implemented by the original app. Any relevant scheduled recurring series conservatively blocks assistant moves; Google recurrences are expanded by Google.
- Google can change after its pretransaction read. An external calendar cannot be locked atomically with PostgreSQL. No Google writes occur.
- Real OAuth consent/reconnect, live Groq inference, database migration/trigger enforcement and actual PostgreSQL concurrency still need verification with configured credentials and a scratch database. Tests use mocked HTTP and a transactional store, not a live Postgres server.
- Full lifetime progress history remains necessary for XP, streaks and achievements. It was not truncated or cached across users.

## Verification

Completed so far:

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: all 32 tests passed (27 assistant/calendar/lifecycle tests and five schedule-range regression tests).
- `npx prisma validate`: passed; `prisma generate` passed. No migration applied.
- Local HTTP checks: signed-out prompt/confirm 401, cross-origin prompt 403, text/plain body 415.
- Browser: original floating prompt/response/confirmation layout tested with isolated mock data; cancel and interrupted-request prompt retention verified. Temporary mock route was deleted. Actual avatar-only showcase tested for normal/meta/omni selection and eye close-ups.
- `npm run build`: passed with original fonts; production routes include both assistant APIs and `/assistant-demo`.
- Native mobile drawer checked in an isolated temporary route: initial close-button focus, Escape dismissal and trigger focus restoration passed. Temporary route and tab were removed.
- `git diff --check`: passed.

Preview artifact: `docs/screenshots/isagi-states.png` (real browser capture). Open `http://127.0.0.1:3000/assistant-demo` while the dev server is running to see movement and select eye close-ups. This preview route is intentionally isolated from account and scheduling data.
