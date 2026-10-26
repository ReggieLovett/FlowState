# Google Calendar → FlowState

`calendar_to_flowstate.py` imports events overlapping the next 14 days from your
primary Google Calendar. It follows all result pages, expands recurring events,
and sends one JSON POST per event. Python 3.10 or newer is required.

This integration targets **the FlowState app in this repository**, using the
existing `POST /api/schedule` handler in `app/api/schedule/route.ts`. If you mean a
different Flowstate service, provide its endpoint, JSON schema and authorization
format before using this importer against it.

## Install and authorize Google

From the repository root:

```bash
python3 -m venv integrations/google-calendar/.venv
source integrations/google-calendar/.venv/bin/activate
python -m pip install -r integrations/google-calendar/requirements.txt
```

Packages: `google-auth`, `google-auth-oauthlib`, `google-auth-httplib2`,
`google-api-python-client`, `requests`, and `tzdata` (IANA timezone data).

Enable the Google Calendar API in Google Cloud, configure the OAuth consent
screen (add your account as a test user if needed), and create an OAuth client
of type **Desktop app**. Download its JSON file as
`integrations/google-calendar/credentials.json`.

The first run opens a browser to authorize read-only event access. Later runs
reuse or refresh `token.json` in this integration directory. Both files are
excluded by the local `.gitignore`. If you change OAuth scopes, delete this
token file and authorize again.

Preview the mapped JSON before importing:

```bash
python integrations/google-calendar/calendar_to_flowstate.py --dry-run
```

For credentials saved elsewhere, use `--credentials /path/to/credentials.json`.
You can also select a token location with `--token /path/to/token.json`.

## Authenticate with FlowState and import

Start FlowState or use your deployed instance, then sign in. This app supports
Auth.js session-cookie authentication; its schedule route does **not** implement
API-key or bearer-token authentication.

Copy the full **Cookie request header** from an authenticated `/api/schedule`
request in your browser's Network developer tools into `FLOWSTATE_COOKIE`.
Include all cookie chunks if Auth.js split the session across multiple cookies.
Treat this value as a secret and update it when the session expires.

```bash
export FLOWSTATE_API_URL='http://localhost:3000/api/schedule'
export FLOWSTATE_COOKIE='your-complete-cookie-header'
python integrations/google-calendar/calendar_to_flowstate.py
```

For a deployed app, set `FLOWSTATE_API_URL` to its HTTPS `/api/schedule` URL and
use cookies from that same app. The script does not read `.env` automatically.

## Exact payload

Each POST has `Content-Type: application/json` and a body matching the existing
route's schema:

```json
{
  "title": "Team meeting",
  "category": "OTHER",
  "startsAt": "2026-10-09T09:00:00+08:00",
  "endsAt": "2026-10-09T10:00:00+08:00",
  "isAllDay": false,
  "notes": "Discuss the release plan."
}
```

Google `summary` becomes `title`, and `description` becomes `notes`. Missing
titles use `(Untitled event)` with a warning; absent descriptions use an empty
string. Missing/invalid event times and fields exceeding FlowState's title
(200) or notes (2000) limits are logged and skipped. Optional subject, location
and recurrence fields are omitted; expanded occurrences are individual rows.

Timed events retain their ISO 8601 offsets. All-day start/end dates become local
midnight timestamps in Google's calendar timezone, preserving Google's
**exclusive end date**, including across daylight-saving transitions. Keep the
Google calendar and FlowState display timezone aligned for matching all-day
dates. FlowState stores instants, not the source timezone. Its current planner
only treats the first day of a multi-day all-day event as unavailable.

## Behavior and limitations

- An ongoing event is included because Google's time bounds select overlapping
  events. The upper bound is exclusive and is 14 × 24 hours after the run starts.
- This is a **create-only import**. Running it again can create duplicates; it
  does not update or delete previous imports. The current route has no upsert
  contract or Google event ID field. Confirm that behavior before recurring use.
- Requests have connection/read timeouts. POSTs are not automatically retried:
  a timeout might happen after an event was created. A delivery failure stops
  subsequent POSTs, prints the HTTP status (and rate-limit wait if supplied),
  and returns exit code 1. Check FlowState before rerunning a partial import.
- Dry-run prints event titles/descriptions to your terminal; ordinary logs
  include titles and dates. No live API requests were made during development.

References: [Google Python OAuth quickstart](https://developers.google.com/workspace/calendar/api/quickstart/python),
[Google event-list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[Google event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).
