# AVNet Superapp: new interface

A React single-page app served at `/app/...`, built only on the typed V2 JSON API (`/api/v2/`).
The classic Django-template UI stays as it is; each app's launcher has a "Classic view" link.
Stack: React 19, React Router 7, TanStack Query 5, TypeScript, Vite 7 (Leaflet for Places). No UI kit,
no chart library, no CDN at runtime: everything is bundled.

## Layout

```
src/
  main.tsx               routes (basename /app), React Query client
  lib/                   api client (CSRF, 401 -> login), types, query hooks, dates, URL state, layout maths
  components/            AppShell (per-app chrome), command palette, bell, menus/dialogs, task row, charts
  pages/<app>/           one folder per app: dashboard, tasks, calendar, photos, places, habits, notifications, settings
  styles/                base tokens + shared styles; colours come from ../static_files/static/css/theme.css
```

Every app renders `<AppShell app="…" topbar={…} sidebar={…}>`: a compact top bar with the app's own
controls, an optional collapsible sidebar (a slide-over drawer on phones), and the global items
(search / Ctrl-K palette, notifications, theme, app launcher, account).

Theme: per device, `localStorage["theme"]` = `light` | `dark` (absent = system), the same key and script
as the classic UI (`static_files/static/js/theme.js` is copied into the build and runs before first paint).

## Develop

Needs Node 20.19+ (22 recommended) and the Django dev server on http://127.0.0.1:8000.

```
cd frontend
npm ci
npm run dev            # http://127.0.0.1:5173/app/  (VITE_PORT=5174 to change the port)
npm test               # vitest: pure logic (API client, dates, URL state, photo rows, quick-add preview)
npm run typecheck
```

The Vite dev server proxies `/api`, `/accounts`, `/media`, `/private`, `/photo_cdn` and `/static/*`
(except `/static/app/`) to Django (`DJANGO_URL` overrides the target). Cookies pass through, and the
proxy rewrites `Origin`/`Referer` so Django's CSRF check accepts POST/PATCH/DELETE. Sign in through the
proxy at http://127.0.0.1:5173/accounts/login/ and you land on the app.

## Build

```
frontend/build.sh      # nvm use 22 if available, npm ci, tests, typecheck + vite build, then .gz copies
```

Output goes to `static_files/static/app/` (gitignored). It is self-contained under `/static/app/`:
hashed JS/CSS in `assets/`, plus `index.html`, `theme.js` and `favicon.ico`. `Comptech/spa.py` serves
`index.html` for any `/app/...` URL (login required) and returns 503 if the build is missing.
Each JS/CSS/SVG/HTML file also gets a `.gz` copy (gzip -9) for nginx's `gzip_static on`, so nginx sends
the precompressed file instead of compressing on every request (a cold Photos load goes from ~744 KB to ~227 KB).

## Deploy (manual copy, no Node on the server)

The build isn't committed. Build locally, then copy the folder to the same path on the server:

```
frontend/build.sh
rsync -av --delete static_files/static/app/ server:/path/to/Comptech_V1/static_files/static/app/
# on the server, if static files are collected (nginx serves STATIC_ROOT):
python manage.py collectstatic --noinput
```

Hashed asset names mean browsers never mix old and new chunks; an open tab that hits a removed chunk
after a deploy reloads itself once.

## Security notes

- Session-cookie auth; unsafe requests send `X-CSRFToken` from the `csrftoken` cookie. A 401 redirects
  to `/accounts/login/?next=<current path>`.
- All API strings render as React text: no `dangerouslySetInnerHTML`, no `eval`, Leaflet popups are
  built from DOM text nodes. Links from API data (`notification.url`, photo URLs) go through
  `safeHref`, which only allows same-site paths and http(s) URLs.
- Dependencies are pinned by `package-lock.json` and installed with `npm ci`.
