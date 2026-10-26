#!/usr/bin/env python3
"""Import the next 14 days of Google Calendar into this project's FlowState API.

Requires Python 3.10+ and the packages in requirements.txt. On the first run,
Google opens a browser for consent and saves token.json for subsequent runs.
Use --dry-run to preview the exact POST bodies without writing to FlowState.

The adapter below matches app/api/schedule/route.ts. That endpoint accepts one
event per POST and authenticates with a FlowState session cookie, not an API key.
This is a create-only importer: running it again can create duplicate events.
"""

import argparse
import json
import logging
import os
from datetime import date, datetime, time, timedelta, timezone
from http.client import HTTPException
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from google.auth.exceptions import GoogleAuthError, RefreshError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from httplib2 import HttpLib2Error
from oauthlib.oauth2 import OAuth2Error

SCOPES = ["https://www.googleapis.com/auth/calendar.events.readonly"]
BASE_DIR = Path(__file__).resolve().parent
LOG = logging.getLogger("calendar-sync")


def authenticate(credentials_file: Path, token_file: Path) -> Credentials:
    """Reuse/refresh Google's OAuth token, or obtain consent for a desktop app."""
    credentials = None
    if token_file.exists():
        try:
            credentials = Credentials.from_authorized_user_file(token_file, SCOPES)
        except ValueError:
            LOG.warning("Invalid Google token file; requesting authorization again.")

    if credentials and not credentials.valid and credentials.refresh_token:
        try:
            credentials.refresh(GoogleAuthRequest())
        except RefreshError:
            LOG.warning("Google refresh token expired or revoked; sign in again.")
            credentials = None

    if not credentials or not credentials.valid:
        if not credentials_file.is_file():
            raise ValueError(f"Missing Google OAuth credentials: {credentials_file}")
        flow = InstalledAppFlow.from_client_secrets_file(credentials_file, SCOPES)
        credentials = flow.run_local_server(port=0, access_type="offline", prompt="consent")

    # Tokens are secrets. A scoped .gitignore excludes this file from Git.
    token_file.write_text(credentials.to_json(), encoding="utf-8")
    token_file.chmod(0o600)
    return credentials


def fetch_events(service) -> tuple[list[dict], str | None]:
    """Fetch every page, expanding recurring events into individual occurrences."""
    now = datetime.now(timezone.utc)
    until = now + timedelta(days=14)
    parameters = {
        "calendarId": "primary",
        "timeMin": now.isoformat(),
        "timeMax": until.isoformat(),
        "singleEvents": True,
        "orderBy": "startTime",
        "showDeleted": False,
        "maxResults": 2500,
    }
    LOG.info("Fetching primary calendar from %s to %s", parameters["timeMin"], parameters["timeMax"])
    # Google filters by overlap, so an event already underway is included.
    events = []
    calendar_timezone = None
    while True:
        page = service.events().list(**parameters).execute()
        calendar_timezone = page.get("timeZone") or calendar_timezone
        events.extend(page.get("items", []))
        next_page = page.get("nextPageToken")
        if not next_page:
            return events, calendar_timezone
        # An empty page can still have a nextPageToken. Keep the bounds fixed.
        parameters["pageToken"] = next_page


def parse_boundary(boundary: dict, calendar_timezone: str | None) -> datetime:
    """Return an aware datetime for a timed event or an all-day date boundary."""
    if boundary.get("dateTime"):
        value = datetime.fromisoformat(boundary["dateTime"].replace("Z", "+00:00"))
        if value.tzinfo is not None:
            return value
        zone_name = boundary.get("timeZone") or calendar_timezone
    elif boundary.get("date"):
        # Google uses local calendar dates and an EXCLUSIVE all-day end date.
        # Convert each midnight separately so DST does not change the dates.
        value = datetime.combine(date.fromisoformat(boundary["date"]), time.min)
        zone_name = calendar_timezone
    else:
        raise ValueError("Missing start/end dateTime or date")

    if not zone_name:
        raise ValueError("Missing timezone for a date or timestamp without an offset")
    return value.replace(tzinfo=ZoneInfo(zone_name))


def to_flowstate(event: dict, calendar_timezone: str | None) -> dict:
    """Map Google fields to the exact single-event JSON schema in this project."""
    start_data = event.get("start") or {}
    end_data = event.get("end") or {}
    all_day = bool(start_data.get("date") and not start_data.get("dateTime"))
    if all_day != bool(end_data.get("date") and not end_data.get("dateTime")):
        raise ValueError("Start/end must both be timed or both be all-day")

    start = parse_boundary(start_data, calendar_timezone)
    end = parse_boundary(end_data, calendar_timezone)
    # Compare absolute instants; a local DST transition can change the offset.
    if end.astimezone(timezone.utc) <= start.astimezone(timezone.utc):
        raise ValueError("End time must be after start time")

    title = (event.get("summary") or "").strip()
    if not title:
        LOG.warning("Event %s has no title; using '(Untitled event)'", event.get("id", "unknown"))
        title = "(Untitled event)"
    notes = (event.get("description") or "").strip()
    # Zod/JavaScript measures string limits in UTF-16 code units, including emoji.
    # Reject oversized data explicitly rather than silently losing its contents.
    if len(title.encode("utf-16-le")) // 2 > 200:
        raise ValueError("Title exceeds FlowState's 200-character limit")
    if len(notes.encode("utf-16-le")) // 2 > 2000:
        raise ValueError("Description exceeds FlowState's 2000-character notes limit")

    return {
        "title": title,
        "category": "OTHER",
        "startsAt": start.isoformat(),
        "endsAt": end.isoformat(),
        "isAllDay": all_day,
        "notes": notes,
    }


def post_event(session: requests.Session, api_url: str, payload: dict) -> bool:
    """Send JSON with bounded waits; do not retry potentially committed POSTs."""
    try:
        response = session.post(
            api_url,
            json=payload,
            timeout=(10, 30),  # Connection timeout and read timeout, in seconds.
            allow_redirects=False,
        )
    except requests.RequestException as error:
        # A timeout may happen AFTER the server creates the event.
        LOG.error("POST failed for %r (%s); delivery may be uncertain", payload["title"], type(error).__name__)
        return False

    if not 200 <= response.status_code < 300:
        LOG.error("POST failed for %r: HTTP %s", payload["title"], response.status_code)
        if response.status_code == 401:
            LOG.error("Sign into FlowState again and update FLOWSTATE_COOKIE.")
        elif response.status_code == 429:
            LOG.error("FlowState rate limit reached; Retry-After=%s", response.headers.get("Retry-After", "unknown"))
        return False

    LOG.info("Created %r (%s to %s): HTTP %s", payload["title"], payload["startsAt"], payload["endsAt"], response.status_code)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print JSON; do not POST to FlowState")
    parser.add_argument("--credentials", type=Path, default=BASE_DIR / "credentials.json")
    parser.add_argument("--token", type=Path, default=BASE_DIR / "token.json")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    api_url = os.environ.get("FLOWSTATE_API_URL", "http://localhost:3000/api/schedule").strip()
    cookie = os.environ.get("FLOWSTATE_COOKIE", "").strip()
    try:
        parsed_url = urlsplit(api_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
            raise ValueError("FLOWSTATE_API_URL must be a full HTTP(S) URL")
        if not args.dry_run and not cookie:
            raise ValueError("Set FLOWSTATE_COOKIE to your signed-in FlowState session cookie header")

        credentials = authenticate(args.credentials, args.token)
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
        try:
            events, calendar_timezone = fetch_events(service)
        finally:
            service.close()

        succeeded = failed = 0
        with requests.Session() as session:
            session.headers.update({"Accept": "application/json"})
            if not args.dry_run:
                session.headers["Cookie"] = cookie
            for event in events:
                if event.get("status") == "cancelled":
                    continue
                try:
                    payload = to_flowstate(event, calendar_timezone)
                except (ValueError, TypeError, AttributeError, ZoneInfoNotFoundError) as error:
                    LOG.error("Skipping event %s: %s", event.get("id", "unknown"), error)
                    failed += 1
                    continue
                if args.dry_run:
                    print(json.dumps(payload, ensure_ascii=False, indent=2))
                    succeeded += 1
                elif post_event(session, api_url, payload):
                    succeeded += 1
                else:
                    # Stop after a failure so expired auth/rate limits do not
                    # generate a failed request for every remaining event.
                    failed += 1
                    LOG.error("Stopping delivery; remaining events were not sent.")
                    break

        LOG.info("%s: %s succeeded, %s failed", "Preview" if args.dry_run else "Import", succeeded, failed)
        return 1 if failed else 0
    except HttpError as error:
        LOG.error("Google Calendar API request failed: HTTP %s", error.resp.status)
    except GoogleAuthError as error:
        LOG.error("Google authentication failed (%s)", type(error).__name__)
    except OAuth2Error as error:
        LOG.error("Google OAuth authorization failed (%s)", type(error).__name__)
    except (HttpLib2Error, HTTPException) as error:
        LOG.error("Google Calendar network request failed (%s)", type(error).__name__)
    except requests.RequestException as error:
        LOG.error("Google authentication network request failed (%s)", type(error).__name__)
    except (OSError, ValueError) as error:
        LOG.error("Configuration or file error: %s", error)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
