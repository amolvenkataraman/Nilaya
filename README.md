# AVNet Superapp (V1)

My very own tech giant: a self-hosted personal and family platform for calendars, tasks, habits, contacts, photos, places and notifications, with a typed API you can build on.

> **Status:** V1 is being cleaned up and kept running until its full rewrite (V2, "Memex") replaces it. It started as a recovered April 2024 backup carrying years of technical debt. Phase 1 (2026) fixed the critical bugs, gave every app one design system with dark mode, and added a V2 API, notifications, Tasks, Habits, Contacts, analytics and a new React interface. Run it only on a server you control.

## Rules

1. **DO NOT** share the code, entirely or in part, with **ANYONE** external or **ANY EXTERNAL WEBSITE/SERVICE** under **ANY CONDITION**. This makes sure the code doesn't leak anywhere.
2. **No CDNs.** Third-party CSS/JS is never committed or loaded from a CDN. Each file is pinned by SHA-256 in `static_files/vendor.lock` and downloaded by `static_files/fetch_vendor.sh`. Reference it with `{% static %}`.
3. Connecting to another company's APIs or servers needs my consent first. Outbound requests are gated by `ONLINE_MODE` in settings.
4. Never commit secrets. They live in untracked files (`Comptech/*.txt`, or a folder set by `COMPTECH_SECRETS_DIR`).

## Apps

| App | URL | What it does |
|---|---|---|
| Home | `/` | Greeting, the next 7 days, open todos, app launcher, DuckDuckGo search |
| Calendar | `/calendar/` | Month/week/day views, shared calendars with invite codes, ICS/Google sync, Insight (time by category, weekday, hour) and Upcoming agenda |
| Tasks | `/tasks/` | Projects, list/board/table/calendar views, kanban columns with WIP limits, labels, repeating tasks, reminders, comments, relations, sharing, natural-language quick add |
| Habits | `/habits/` | Yes/no and measurable habits, daily/weekly/monthly goals, schedules, streaks, year heatmap, reminders |
| Contacts | `/contacts/` | Personal CRM: vCard, Google, Outlook and LinkedIn imports, developer profiles (GitHub, LinkedIn, website and more), interaction log, keep-in-touch and birthday reminders |
| Photos | `/photos/` | Google Photos-style timeline, albums and sharing, search by place, camera or object, stats, storage, superlatives, map, hidden photos |
| Places | `/map/` | Saved places in groups, photos taken nearby with visit history, suggested places from photo GPS, want-to-go and visited lists, GeoJSON/Takeout/KML import and export |
| Notifications | `/notifications/` | Inbox and bell menu; delivery to ntfy, Gotify, email, Discord or any webhook (e.g. Home Assistant); automatic reminders for events, deadlines, todos and a morning agenda |
| API keys and feeds | `/settings/api-keys/` | Per-app API keys, Markdown API guides for developers and AI agents, private ICS feeds for phone calendar apps |
| Usage | `/analytics/` | Staff-only usage dashboard: page views and API calls per person, per app, per day |
| New interface (beta) | `/app/` | React + Vite + TypeScript app on the V2 API, G Suite-style apps with their own toolbars |

Dark mode is chosen per device (system, light or dark) from the user menu.

## V2 API

A typed, documented JSON API for every app at `/api/v2/` (Django Ninja). Interactive docs: `/api/v2/docs`; schema: `/api/v2/openapi.json`.

- **Browser:** the login session plus an `X-CSRFToken` header on unsafe requests.
- **Scripts, phones, other servers:** a personal API key from **Settings → API keys**, sent as `Authorization: Bearer avn_...` or `X-API-Key: avn_...`. Each key gets read or write access per app, can expire, and is shown only once (stored hashed). Keys can't create or manage other keys.
- **Guides for AI agents:** `/api/v2/<app>/guide.md` covers the concepts, every endpoint and the JSON schemas, generated from the live schema. Reading a guide needs the same access as the app.
- JSON in and out, ISO 8601 datetimes with offsets, UUID ids, errors as `{"detail": ...}`, 600 requests per minute per key or user.

```bash
curl -H "Authorization: Bearer $KEY" https://app.example.com/api/v2/tasks/?view=today
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"text": "Pay rent tomorrow 5pm *bills !3 every month"}' https://app.example.com/api/v2/tasks/quick
```

## Running locally

A self-contained copy with SQLite, no Redis, no nginx and Celery tasks running inline, filled with dummy data. Details in [`localdev/README.md`](localdev/README.md).

```bash
localdev/setup.sh [--photos]            # venv, secrets, SQLite DB, dummy users/calendars/todos/places (and photos)
localdev/run.sh                          # http://127.0.0.1:8000  (login: amol / localdev; also alex, sam)
.venv/bin/python localdev/smoke.py       # logs in and checks every page and signed file URL
.venv/bin/python localdev/screens.py /calendar/     # screenshots, light + dark, desktop + phone (--quick, --4k)
DJANGO_SETTINGS_MODULE=Comptech.settings_local .venv/bin/python manage.py test   # test suite
```

New interface: `frontend/build.sh` builds into `static_files/static/app/`. The build output isn't committed: build locally and copy that folder to the server (see `frontend/README.md`).

## Deploying

The server runs from `/opt/Comptech` (venv `CT_env`) via `Comptech.sh`, in a tmux session with Daphne, a Celery worker and Celery beat, behind nginx, with Postgres. Step-by-step upgrade guides, with every changed path and command, are in [`docs/`](docs/).

The usual upgrade: back up the database, `git pull`, `pip install -r requirements.txt`, `static_files/fetch_vendor.sh`, `python manage.py migrate`, `python manage.py collectstatic`, then restart Daphne, the worker and beat. Beat registers its own schedules: reminders and clean-ups.

## Project layout

```
Comptech/        settings (settings.py for the server, settings_local.py for local testing), urls, V2 API assembly, API guides
mainsite/ users/ home, launcher, accounts and profiles
scheduler/       Calendar (events, calendars, sync, insights, agenda)
tasks/           Tasks (projects, buckets, labels, reminders, quick add, automatic reminders job)
habits/ contacts/ Habits and Contacts
photos/ map/     Photos and Places
notifications/   inbox, delivery channels, notify() service, reminder settings
apikeys/ feeds/  API keys + guides UI, ICS feeds
analytics/       privacy-respecting usage analytics
frontend/        new React interface (built into static_files/static/app/)
static_files/    shared theme (css/theme.css), shell JS, vendor.lock + fetch_vendor.sh
localdev/        local testing tools (setup, run, smoke, screenshots)
docs/            upgrade guides and app docs
```

## Security notes

- Every API query is scoped to the signed-in user or the key's owner; cross-user access returns 404.
- CSRF on all browser writes; API keys use headers, not cookies.
- User text is sanitised on write and rendered as text.
- Delivery channels and other outbound calls only reach LAN addresses while `ONLINE_MODE` is off, and channel posts don't follow redirects.
- Uploaded files (imports) have size limits and safe parsers; XML with a DTD is refused.
- Hidden photos are invisible to everyone. Their owner can reveal them only through a session-only mode that switches off after 30 minutes.
- Usage analytics keeps only daily counts per person and app (no URLs, IPs or browser details).
