# FlowState assistant and performance handoff

Updated: 2026-10-26 (Asia/Manila). Natural-language creation and management of classes, tasks and events is implemented. Verification results and remaining live setup are recorded below. No live database migration or deployment has been performed.

## User direction

Integrate the assistant and optimize the overall app. Keep FlowState recognizable: existing palette, typography, layout, pixel rewards, and theme preference behavior remain. The user approved restrained design improvements after initially asking to preserve the old look. Final polish is limited to slightly softer cards, clearer focus outlines, touch targets and an accessible mobile drawer.

The assistant uses Groq `openai/gpt-oss-120b`, reads the owner's FlowState schedule and Google Calendar, shows a movable Isagi Yoichi avatar, uses a compact input with nearby dialogue bubbles, and requires explicit Confirm before every assistant domain write, including creation, completion and deletion. Idle, walking, meta vision eyes and white/glowing omni vision are distinct.

## Resume safely if the session or connection ends

1. Work in `/Users/reggielovett/Desktop/projects/project shed` and read `AGENTS.md`.
2. Read the relevant installed Next guides under `node_modules/next/dist/docs/`. Versions here are Next.js 16.3, React 19, Prisma 7 and Auth.js v5 beta.
3. Inspect `git status --short` before editing. Preserve `integrations/google-calendar/` and unrelated user work. The tree was clean at the start of the latest class-management extension.
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

The class/task/event extension requires no new schema migration: version 2 payloads use the existing immutable JSONB columns. Already deployed installations only need the updated application code if the original assistant migration is applied. Existing pending version 1 move proposals remain supported.

The original Google Fonts setup is retained to preserve appearance. A clean build needs font network access (or an existing Next font cache); the initial sandboxed build failed on that network dependency. No runtime Google Fonts requests are added by the assistant. Installed unit tests/lint/type checks work without provider access.

## Implementation map

- `app/api/assistant/route.ts`: authenticated/rate-limited prompt endpoint.
- `app/api/assistant/proposals/[id]/route.ts`: explicit Confirm/Cancel endpoint.
- `lib/assistant/contracts.ts`: browser-safe request response types.
- `lib/assistant/groq.ts`: server-only strict JSON schema Groq fetch, timeout, refusal/error handling.
- `lib/assistant/provider-errors.ts`: bounded private parsing of Groq errors, fixed safe client messages and status/category-only diagnostic logs.
- `lib/assistant/capabilities.ts`: public assistant version/capability marker for identifying stale deployments.
- `lib/assistant/context.ts`: bounded owner-scoped schedule/task context and recurrence/truncation detection.
- `lib/assistant/service.ts`: proposal staging and transactional decision orchestration.
- `lib/assistant/validation.ts`: pure move, conflict, snapshot and decision validation.
- `lib/assistant/operations.ts`: closed class/work-item/event operation schemas, server-derived previews, reference validation, local all-day boundaries and combined timeline validation.
- `lib/assistant/mutation-persistence.ts`: scoped dependency reads, deletion impact snapshots, ordered row locks and atomic operation writes.
- `lib/assistant/primitives.ts`: shared limits, interval types and legacy event snapshots.
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

`GET /api/assistant` returns public build capabilities without account data or provider secrets. The current marker is `version: "flowstate-crud-v2.2"`, with `canCreateClasses`, `canCreateWorkItems`, `canCreateEvents` and `requiresConfirmation` all true. The same version is returned in `X-FlowState-Assistant-Version` on successful prompt responses. This read-only diagnostic uses `Cache-Control: no-store`.

`POST /api/assistant`, same-origin JSON:

```json
{
  "prompt": "9 AM for one hour",
  "timeZone": "Asia/Manila",
  "history": [
    { "role": "user", "content": "Create Biology and add a lesson tomorrow" },
    { "role": "assistant", "content": "When does the lesson start, and how long is it?" }
  ]
}
```

Response shape:

```text
{
  message,
  proposal?: {
    id, expiresAt,
    changes: [{ eventId, title, fromStart, fromEnd, toStart, toEnd, reason }],
    operations?: [{ kind, title, details: [{ label, before, after }], reason, destructive }]
  },
  calendar: { connected, warning? }
}
```

`POST /api/assistant/proposals/[id]`, same-origin JSON:

```json
{ "action": "confirm" }
```

Use `"cancel"` to reject. The endpoint accepts only the saved ID and decision; it refuses replacement plans, history, owner IDs, edited times or other fields. Success is `{ message, status: "APPLIED" | "CANCELLED" }`. Applied decisions invalidate the dashboard layout; the client refreshes server data. Errors are `{ error }` with an HTTP status. Routes explicitly return 401 for signed-out requests, 403 for rejected origins and 415 for non-JSON content. Prompt limit is 8 per 10 minutes; decisions 30 per minute. Body cap is 32 KiB, prompt cap 2000 characters. Optional history permits at most six user/assistant messages, 1600 characters each and 4000 combined; system/tool roles and extra fields are rejected.

History stays in browser memory, records Confirm/Cancel outcomes, and is sent only with the next prompt. It is untrusted conversational context, never approval. It clears when the component unmounts. Missing essential event dates, start times or duration trigger clarification; ambiguous record names should also trigger clarification.

## Confirmation guarantee

Prompt processing writes only an immutable pending proposal, never a class, work item or schedule event. The model can select only a closed operation vocabulary: subject create/update/archive/restore/delete, item create/update/complete/reopen/delete, event create/update/status/delete, and existing event moves. Real persistent IDs and user ownership always come from the server. Temporary `new:` references link a new class, work item and lesson inside one proposal.

Confirm locks the owner's proposal, checks expiry/status, acquires affected parent/child locks in deterministic order, rereads exact source and cascade snapshots, revalidates names and relationships, and checks the resulting timeline against fresh FlowState and Google busy intervals when times change. Updates and APPLIED status commit together in a serializable transaction, with bounded serialization retries. Repeat decisions are idempotent; an applied/cancelled decision cannot be reversed. Cancellation changes proposal status only, including after expiry. Metadata-only confirmations do not require a successful Google read.

Deletion follows the app's existing behavior and shows server-derived affected counts: deleting a class permanently removes its work items and detaches retained calendar events; deleting a work item removes unfinished linked blocks and detaches retained completed blocks. Changing affected children after review invalidates confirmation. Operations affecting more than 500 related records require the manual editor. This is hard deletion, not a trash flow.

Move operations preserve duration/title and target scheduled timed nonrecurring future events. Event updates can resize future scheduled nonrecurring blocks. All-day events use the user's local midnight and an exclusive end date, including 23/25-hour DST days. Date-only class exam dates and item due dates remain calendar dates.

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

- New/changed calendar times are limited to the next 14 days, with at most 12 total moves/operations and 10-minute proposal expiry. Class metadata and date-only task deadlines can extend beyond the event window.
- Model context caps: 200 local events, 60 work items (TODO first), 120 classes (active first), 500 Google busy intervals at orchestration. Authoritative mutation/deletion reads separately check owned dependencies and all class names, bounded at 500 records. Calendar reader itself can traverse four pages of 250, and rejects incomplete/malformed results. Truncated event context blocks time changes; omitted work/classes cannot be guessed by the model.
- An unconnected Google account permits FlowState-only advice/plans and the UI says so. A linked but unavailable/unauthorized/incomplete calendar blocks new/changed times. Class/task metadata, status and deletion can still be reviewed.
- Local RRULE occurrence expansion is not implemented by the original app. Any relevant scheduled recurring series conservatively blocks assistant time changes; Google recurrences are expanded by Google. New repeat requests expand into explicitly dated occurrences only within the 14-day window and action cap; no permanent recurring series is created.
- Google can change after its pretransaction read. An external calendar cannot be locked atomically with PostgreSQL. No Google writes occur.
- Real OAuth consent/reconnect, live Groq inference, database migration/trigger enforcement and actual PostgreSQL concurrency still need verification with configured credentials and a scratch database. Tests use mocked HTTP and a transactional store, not a live Postgres server.
- Full lifetime progress history remains necessary for XP, streaks and achievements. It was not truncated or cached across users.

## Verification

Completed so far:

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: all 94 tests passed, including HTTP/domain/persistence coverage, 24 provider-adapter tests and seven provider-error tests. Coverage includes linked class/task/event creation, all CRUD branches, rollback, stale snapshots, tenant isolation, duplicate names, cascade effects, JSONB key reordering, unavailable Calendar metadata changes, Manila all-day times, DST and mixed-plan conflicts. Provider tests cover move-only refusal, empty calendars, stale history, safe format fallback, malformed/injected payload rejection, bounded correction, shared timeout, legitimate restrictions and private error classification.
- `npx prisma validate`: passed; `prisma generate` passed. No migration applied.
- Local HTTP checks: signed-out prompt/confirm 401, cross-origin prompt 403, text/plain body 415.
- Browser: original floating prompt/response/confirmation layout tested with isolated mock data; cancel and interrupted-request prompt retention verified. Latest extension verified missing-time follow-up, history carryover, three linked creation previews, no mock confirm before approval, cancellation, successful confirmation with input restoration, and destructive warning/cascade count review. Temporary routes/tabs were deleted. Actual avatar-only showcase tested for normal/meta/omni selection and eye close-ups.
- `npm run build`: passed with original fonts; production routes include both assistant APIs and `/assistant-demo`.
- Native mobile drawer checked in an isolated temporary route: initial close-button focus, Escape dismissal and trigger focus restoration passed. Temporary route and tab were removed.
- `git diff --check`: passed.

Preview artifacts: `docs/screenshots/isagi-states.png` (avatar states) and `docs/screenshots/isagi-class-proposal.png` (class/task/lesson review with mock data), both real browser captures. Open `http://127.0.0.1:3000/assistant-demo` while the dev server is running to see movement and select eye close-ups. This preview route is intentionally isolated from account and scheduling data.


## Latest extension: usage examples

- “Create a Biology class.” This creates the class container; a dated lesson needs a separate event operation.
- “Create Biology, add a lab report assignment due Friday, and schedule a lesson tomorrow at 9 AM for one hour.” The class, assignment and lesson can be proposed and saved together.
- “Mark my Biology lab report complete.” Ambiguous matching records require clarification.
- “Move tomorrow's Biology lesson to 11 AM.” Fresh local/Google conflict checks apply.
- “Archive Biology” or “Delete Biology.” Both require Confirm; deletion discloses affected records and is permanent.

No Google writes, account/security administration, or unrestricted database tool is exposed. Live Groq output, OAuth and PostgreSQL concurrency still require configured credentials/scratch database checks as described above; the local Groq key was not configured during this extension's verification.

## Vercel creation-refusal fix

The user reported the Vercel assistant saying it cannot create events because there are no existing events to move. The preceding move-only backend explicitly prohibited creation; the committed CRUD code supported creation but still contained the ambiguous instruction “You have NO write tools.” The user identified `https://flowstate-bay-zeta.vercel.app` as production. A public GET to its `/api/assistant` returned HTTP 405 with no capability marker, confirming this latest fix/version endpoint is not serving there. That response alone cannot distinguish the earlier CRUD revision from the older move-only revision.

- Replaced that ambiguity with an explicit proposal/execution contract: the model emits operations; the server executes only after Confirm.
- Explicitly permit creating the first class or event in an empty account and standalone events without class links. An earlier assistant refusal in history does not override current capabilities.
- Retry once only for a narrow incorrect creation denial in an empty plan, within the original 25-second total timeout. A second such denial returns an actionable 502 and retains the user's input. Provider refusals, calendar blockers, Google-write denials and ordinary clarification do not trigger correction. Both attempts still pass the existing operation/ownership/conflict validation before proposal staging.
- Added the public version endpoint above. Local GET returned `flowstate-crud-v2.1` with creation enabled. No live Groq/Google inference or database write was performed during verification.

The v2.1 fix was subsequently committed by the user as `d1ae9f1` (working editor assistant). Production later returned `flowstate-crud-v2.1`, confirming that deployment reached the site.

## Groq provider-rejection follow-up

The next reported error was “The AI provider could not generate a plan. Try again shortly.” That exact old branch means an upstream non-2xx other than 401/403/429; it does not disclose whether the provider returned 400, 413, 422 or 5xx. The upstream status/body was not available to this session and the actual cause remains unconfirmed. Production's public endpoint returned v2.1 with creation enabled. Local Groq credentials are still absent, so verification uses mocked provider HTTP rather than live inference.

- Checked [Groq structured-output documentation](https://console.groq.com/docs/structured-outputs) and [error documentation](https://console.groq.com/docs/errors). GPT-OSS 120B, strict mode, unions and the requested token limit are documented capabilities. The generated schema has no known documented violation.
- Flattened redundant primitive unions created by constraint stripping, including nested duplicate string alternatives on relation IDs.
- Added one JSON Object fallback only when a 400/422 explicitly identifies a response-format/schema/generation rejection. The fallback includes the exact full response schema in system instructions. No fallback occurs for unknown 400, credentials/access, model configuration, rate limits, context size, billing or provider outages.
- Both formats pass the same closed Zod operation schemas, ownership checks, snapshot checks and timeline validation; the JSON fallback requires an explicit operations array. No mutation occurs before Confirm.
- At most three provider requests combine one format fallback and one capability correction, all within the existing shared 25-second deadline. No unbounded retries or automatic model changes.
- Upstream failures now produce actionable fixed messages with HTTP status/category. Logs include only model, HTTP status, known category and format; raw provider messages, failed generations, prompts and credentials are never returned or logged. Error bodies are bounded while parsing.

Roll out the latest source revision through the existing Git/Vercel workflow, then check `{productionOrigin}/api/assistant` for `flowstate-crud-v2.2`. If a provider failure remains, its new HTTP/category message and the matching Vercel log (`model: openai/gpt-oss-120b`, `status`, `kind`, `format`) identify the next investigation without sharing secrets. No additional migration, API key change, production write, commit, push or deployment was performed by this agent.
