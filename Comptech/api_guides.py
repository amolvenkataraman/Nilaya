"""Per-app API guides in Markdown, for people and AI agents building on the V2 API.

GET /api/v2/<app>/guide.md (needs a session or an API key with <app>:read). Generated from
the live OpenAPI schema, so it never drifts from the code, plus hand-written domain notes.
"""

import json

from django.http import HttpResponse

INTRO = {
    "me": """The signed-in user (or the key's owner): profile fields and time zone.
Use the time zone for anything you show as local dates; the API itself always returns
ISO 8601 datetimes with offsets (UTC).""",
    "calendar": """Calendars the user owns or subscribes to, and their events.

- **Event kinds:** `event` (start + end), `all_day`, `deadline` (an assignment: start only, `end` null).
- **Roles:** `owner`/`admin` can edit a calendar's events; `subscriber` is read-only (writes return 403).
- `GET events` needs a `start`/`end` range (max 400 days) and returns events overlapping it.
- `GET agenda?days=14` merges upcoming events, deadlines and due todos, sorted. It's the simplest feed for widgets.
- `GET insights?period=week|month&date=YYYY-MM-DD` reports where time went: hours by category, calendar,
  weekday and hour (a 7×24 `heat` matrix, Monday first), busiest day, typical start and end, todos
  completed, and photos taken, each compared with the previous period.
- Synced calendars (ICS, Google, etc.) are refreshed by the server; edits to them may be overwritten.""",
    "tasks": """A Vikunja-class task manager built around projects.

- **Projects** nest via `parent_id`. Every user has exactly one **Inbox** (`is_inbox`), where tasks without
  a project go. Projects can be shared with members (role 0 view, 1 edit, 2 admin).
- **Buckets** are kanban columns. Exactly one per project may be `is_done`: moving a task into it completes the
  task, and completing a task moves it there. `limit` is a WIP limit; a move into a full column returns 400.
- **Priority** is 0–20: 0 None, 5 Low, 10 Medium (the default), 15 High, 20 Urgent. `priority_label` gives the name.
- **Importing from another app:** `POST /` also takes `done` + `done_at` (create it already completed, at that time), `created_at`, `end` and `ref` (the original id, e.g. `vikunja:#12`); `PATCH` takes `done_at`, `created_at`, `end` and `ref` to backfill. Dates must be in the past.
- **Repeating** (`repeat_mode`): 0 none, 1 every `repeat_every` seconds after the due date, 2 monthly,
  3 every `repeat_every` seconds after completion. Completing a repeating task moves its dates forward and
  keeps it open (`POST {id}/done` returns `repeated: true`).
- **Reminders:** absolute (`at`) or relative (`relative_to: due|start`, `offset` in seconds, negative = before).
  They're delivered through the user's notification channels.
- **Quick add** (`POST quick {text}`) parses natural language:
  `Pay rent tomorrow 5pm *bills +Home !3 every month` gives labels `*word` or `*"two words"`,
  project `+Name`, priority `!1`–`!4`, dates (today, tomorrow, fri, next week, Nov 20, 2026-12-01, in 3 days,
  5pm, 17:30) and repeats (daily, weekly, every 2 days, every month).
- **List filters** combine: `view` (today, upcoming, overdue, nodate, favorites, assigned, done), `project`,
  `label=1,2` (all must match), `priority_min`, `q`, `due_before`/`due_after`, `parent`, `top_level`, `bucket`
  (a board column; needs `project`), `sort`. Saved views (`/views`) store these parameters as JSON.
- **Paging:** `GET /` returns `{items, total, next}`, 100 tasks by default (`limit` up to 500). Pass the returned
  `next` as `cursor` for the following page until it's null; cursors are keyset (stable while tasks change) and
  belong to their `sort`. `count=false` skips `total` (null) on later pages. `offset` still works without a cursor.
- **Board:** `GET projects/{id}/board?per=50` returns every column with `total`/`open` counts and its first `per`
  top-level tasks plus a `next` cursor (page on with `GET /?project=…&bucket=…&top_level=true&sort=position&cursor=…`);
  `items=false` returns counts only. Projects carry `open_count` and `done_count`.
- **Ordering:** `POST projects/{id}/place {ids, after|before}` puts tasks right after (or before) another task;
  `POST {id}/move` takes `after`/`before` too. The server picks positions between the neighbours, renumbering the
  project only when they're too close (`renumbered: true`). `reorder {ids}` still sets positions 0..n.
- **Bulk:** `POST bulk {ids (≤500) | filter, action}` with `action` done, reopen, update (`priority`, `favorite`,
  `due`, `due_day` keeping each task's time, `clear_due`, `add_label`, `remove_label`), move (`project_id`) or
  delete. `filter` takes the list filters and covers up to 5000 matching tasks (`more: true` when there are more).
  Tasks you can't edit are skipped and counted in `failed`; with `ids` the changed tasks come back in `tasks`.
- Relations are stored in both directions (blocks ↔ blocked_by, precedes ↔ follows, duplicate_of ↔ duplicated_by).""",
    "photos": """Read-only access to the photo library the user can see.

- Media URLs (`thumb_url`, `url`) are signed paths on this server. Prefix them with the server origin
  (e.g. `https://app.example.com`). They need no cookie or key, so treat them as secret links.
- `timeline` pages newest first: pass the returned `next_before` as `before` to get the next page,
  until it's null. Filters: `video`, `country`, `city`.
- `aspect` is width/height of the thumbnail; use it to lay out justified rows without loading images.
- `on-this-day` groups photos from today's date in earlier years. `summary` gives counts, size, date range
  and top places. `libraries` are camera folders; `albums` are shared albums.""",
    "places": """Saved places in groups (your own groups plus public ones, which are read-only).

- Coordinates are WGS84 decimal degrees (6 decimal places stored).
- `GET /` filters: `group`, `category`, `q` (name, address, notes), and a map box
  (`south`, `west`, `north`, `east`; a box crossing the antimeridian works).
- `GET categories` lists the allowed `category` keys. `rating` is 1–5; send 0 to clear it.""",
    "notifications": """The user's notification inbox, push delivery channels and automatic reminders.

- **Priority:** 0 Low, 10 Normal, 15 High, 20 Urgent. Each channel delivers only at or above its `min_priority`.
- **Channel kinds:** ntfy, gotify, email, discord, webhook. `GET channel-types` lists each kind's config fields.
  Secret fields are masked in responses; when patching, send blank secrets to keep the stored value.
- While the server's online mode is off, channels may only point at LAN or loopback addresses.
- `POST send` notifies yourself, which is handy for scripts ("backup finished").
- `GET|PATCH reminders` holds the automatic reminder settings: minutes before events, deadlines and todos
  (0 = off), a morning agenda, and copying calendar deadlines into Tasks.""",
}

COMMON = """## Authentication

Send a personal API key with every request, in either header:

    Authorization: Bearer avn_xxxxxxxx_...
    X-API-Key: avn_xxxxxxxx_...

Create keys in **Settings → API keys**. A key has per-app scopes: `{{app}}:read` allows GET, and
`{{app}}:write` allows every method (write includes read). A missing or invalid key returns **401**;
a key without the needed scope returns **403**. Keys can't create or manage keys.
(Browser pages use the login session plus an `X-CSRFToken` header instead.)

## Conventions

- Base URL: `{base}` (prefix every path below with the server origin).
- JSON request and response bodies; send `Content-Type: application/json`.
- Datetimes are ISO 8601 with an offset, e.g. `2026-11-05T17:00:00-05:00`; responses use UTC (`Z`).
- IDs are UUIDs, except a few integer IDs (calendars, buckets, labels, place groups).
- Errors look like `{{"detail": "..."}}`; validation errors (422) list each field in `detail`.
- PATCH is partial: send only the fields you're changing.
- Rate limit: 600 requests per minute per key (429 when exceeded).
- Full machine-readable schema: `{base}openapi.json` (signed-in browser session).
"""


def _api_module(app):
    """Newer apps keep their guide intro next to their router, as <app>/api.py GUIDE_INTRO."""
    import importlib
    try:
        return importlib.import_module(f"{app}.api")
    except ImportError:
        return None


def _ref_name(ref):
    return ref.rsplit("/", 1)[-1]


def _collect(schema, components, seen):
    if isinstance(schema, dict):
        if "$ref" in schema:
            name = _ref_name(schema["$ref"])
            if name not in seen:
                seen.add(name)
                _collect(components.get(name, {}), components, seen)
        for v in schema.values():
            _collect(v, components, seen)
    elif isinstance(schema, list):
        for v in schema:
            _collect(v, components, seen)


def _type(schema):
    if not schema:
        return ""
    if "$ref" in schema:
        return _ref_name(schema["$ref"])
    if "anyOf" in schema:
        return " | ".join(_type(s) for s in schema["anyOf"])
    if schema.get("type") == "array":
        return f"{_type(schema.get('items', {}))}[]"
    t = schema.get("type", "")
    if "enum" in schema:
        t += " (" + ", ".join(map(str, schema["enum"])) + ")"
    if schema.get("format"):
        t += f" ({schema['format']})"
    return t


def render(api, app, request):
    spec = api.get_openapi_schema()
    components = spec.get("components", {}).get("schemas", {})
    prefix = f"/api/v2/{app}"
    base = request.build_absolute_uri("/api/v2/")
    intro = INTRO.get(app) or getattr(_api_module(app), "GUIDE_INTRO", "")
    out = [f"# AVNet Superapp API: {app}", "", intro.strip(), "", COMMON.format(base=base), "## Endpoints", ""]
    used = set()
    for path, ops in spec["paths"].items():
        if not (path == prefix or path.startswith(prefix + "/")) or path.endswith("/guide.md"):
            continue
        for method, op in ops.items():
            out.append(f"### {method.upper()} {path}")
            if op.get("summary"):
                out.append(op["summary"])
            out.append("")
            params = op.get("parameters", [])
            if params:
                out.append("| Parameter | In | Type | Required |")
                out.append("|---|---|---|---|")
                for p in params:
                    out.append(f"| `{p['name']}` | {p['in']} | {_type(p.get('schema', {}))} | {'yes' if p.get('required') else 'no'} |")
                out.append("")
            body = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
            if body:
                out.append(f"Body: `{_type(body)}`")
                _collect(body, components, used)
            for code, resp in op.get("responses", {}).items():
                schema = resp.get("content", {}).get("application/json", {}).get("schema")
                out.append(f"Returns **{code}**" + (f": `{_type(schema)}`" if schema else ""))
                if schema:
                    _collect(schema, components, used)
            out.append("")
    if used:
        out += ["## Schemas", "", "JSON Schema of every type used above.", ""]
        for name in sorted(used):
            out += [f"### {name}", "```json", json.dumps(components.get(name, {}), indent=1), "```", ""]
    return "\n".join(out)


def _view(api, app):
    def guide(request):
        return HttpResponse(render(api, app, request), content_type="text/markdown; charset=utf-8")
    return guide


def register(api, apps):
    for app in apps:
        guide = _view(api, app)
        api.get(f"/{app}/guide.md", summary=f"Markdown guide to the {app} API (for people and AI agents)",
                tags=["guides"], operation_id=f"guide_{app}")(guide)
