# Working on the web app

Rules for people and coding agents changing `frontend/`. [README.md](README.md) covers running, building and deploying.

## Where things live

| Path | What |
|---|---|
| `src/main.tsx` | Routes, the React Query client, boot (theme, stale-build reload) |
| `src/styles/theme.css` | **The design tokens** (`--app-*` colours, radii, fonts, light + dark). The phone apps generate theirs from this file (`mobile/tools/gen_tokens.py`): keep its three token blocks and their selectors |
| `src/styles/tailwind.css` | Tailwind wired to those tokens. Only the design system's values exist (see below) |
| `src/styles/base.css` | Shadow/scrim/easing tokens, element resets (in `@layer base`) and the shared keyframes. No component CSS |
| `src/lib/map/` | Everything Leaflet: `useLeafletMap`, heat layer, viewport box, clustering, geocoding, `geo.ts`, `map.css` (only what Leaflet renders) |
| `src/components/ui/` | Shared primitives: `button`, `dialog` (Dialog, Confirm, Drawer), `menu` (Menu, MenuItem, Popover), `controls` (Segmented, ColourPicker, SearchBox), `form` (Field, Input, Select, Textarea with `size`/`width`/`variant`), `settings` (page rows: SettingsSection, SettingRow; drawer/dialog rows: PanelSection, PanelRow), `chip` (Chip/chipClass, Kbd, Dot), `card` (Card, CardHead, TitledCard), `page` (PageHead, pageClass), `feedback` (SkeletonRows, ErrorBox, EmptyState), `query-view`. Overlays are Base UI underneath |
| `src/components/AppShell.tsx` | The app chrome, SideItem/SideSection, and `sideItemClass` for pages that build their own sidebar rows |
| `src/components/ui.tsx` | Re-exports the above plus hotkeys, Avatar, Switch, small hooks. Pages import from `components/ui` |
| `src/components/layers.ts` | Which overlays are open. Page shortcuts check `layerOpen()`; custom overlays register with `useLayer()` |
| `src/lib/api.ts` | The only way to call the server: `get`, `post`, `patch`, `del`, `upload`, `getText`, `apiUrl` |
| `src/lib/api-schema.json`, `api-schema.d.ts` | **Generated**: the server's OpenAPI schema and the TypeScript made from it. Never edit by hand (see API types) |
| `src/lib/types.ts` | The shared API types by the app's names, mostly aliases of the generated schemas |
| `src/lib/cn.ts` | `cn()` for conditional class names |
| `src/pages/<app>/` | One folder per app. `api.ts` holds its types, queries and mutations |

## Styling

- Use Tailwind utilities. Colours, sizes, radii and shadows come from the tokens: `bg-surface`, `text-muted`, `border-border`,
  `text-sm` (13px), `text-base` (14px), `rounded-sm`/`rounded-md`, `shadow-pop`. Tailwind's default palette and type scale are
  switched off on purpose, so `text-gray-500` or `text-[15px]` mean you're off the design system.
- `md:` is the phone/desktop split (761px). Write phone styles with `max-md:`.
- No inline `style={{}}` except for values computed at runtime (a colour from data, a position).
- There is no per-app CSS and no preflight. A `<button>`, `<input>` or `<select>` keeps the browser's border and background
  unless its classes reset them (`border-0`, `bg-transparent`); the shared components already do.
- `cn()` doesn't resolve conflicting utilities: with `h-4` and `h-5` (or `bg-surface` and `bg-transparent`, or two
  `[--c:…]`) both present, the stylesheet decides, not the argument order. Put one class per state in a ternary.
  Components expose variants as props (`size`, `variant`, `tone`); a caller's `className` should only add properties
  the component doesn't set. Avoid `!` overrides; add a variant instead.
- `kbd`, `sk`, `sk-line` and `spinner` are `@utility` classes in `tailwind.css`. A class name kept only as a hook other
  code queries (`topbar`, `app-sidebar`, `task-row`, `side-item`, `notif`, `toasts`) gets a comment saying so.
- Keep the information density: never drop a field or detail the current UI shows.

## Components and behaviour

- Dialogs, menus, popovers and drawers come from `components/ui`. Never hand-roll a portal, scrim, outside-click or Escape handler.
- Icon names are typed (`IconName`), so a misspelt icon fails the typecheck. A name that comes from data (a calendar's
  icon, a place category) goes through `asIcon(name, fallback)`. Add new shapes to `components/Icon.tsx`.
- Page shortcuts use `useHotkey` and bail out while `layerOpen()` is true. Never query the DOM for `.dialog`/`.menu`.
- Loading, error and empty states go through `<QueryView>`. Data on screen wins over an error, so a failed refresh never blanks a
  page.
- Requests go through `lib/api.ts` (it handles CSRF, 401 → sign-in, and clearing a signed-out user's cache). No `fetch()` in pages.
- Query keys start with the app (`['tasks', …]`). When a query is used in more than one place, export a `queryOptions()`
  factory from the app's `api.ts` and use it everywhere: hooks, `qc.fetchQuery`, loaders.
- Pass `signal` to `get()` in query functions, so React Query can cancel requests.

## API types

- Types for what the server sends or accepts come from its schema: `Schemas['TaskOut']` (from `lib/types`). Shared ones get
  a short name in `lib/types.ts`, an app's own in its `api.ts` (`export type Group = Schemas['MapGroupOut']`). Don't
  hand-write an interface for a typed endpoint.
- Hand-write only what the server leaves untyped (an endpoint returning a plain `dict`: say so in a comment) and client-only
  state. To narrow a loose server field, override just that field: `Omit<Schemas['ViewOut'], 'filters'> & { filters: … }`.
  Better still, tighten the server's schema (`status: Literal[...]` instead of `str`) and regenerate.
- Response fields with a default are required (the server always sends them). A class that requests use too has two
  shapes: `Address` (input, defaults optional) and `Address-Output` (what responses carry). Same-named classes from two
  apps get the app as a prefix (`TasksUserBrief`, `ContactsUserBrief`).
- After changing an API schema, regenerate from the repo root and commit both files:

  ```
  DJANGO_SETTINGS_MODULE=Comptech.settings_local make api-types PYTHON=.venv/bin/python
  ```
  That runs `manage.py api_schema` (writes `api-schema.json`, no server needed) then `npm run api:types`.
  `npm run check` fails when the `.d.ts` doesn't match the JSON, and `manage.py test mainsite` when the JSON doesn't match
  the API.

## Files

- One component per concern. A file over ~400 lines, or one holding several unrelated components, should be split.
- Name files after what they hold: `PascalCase.tsx` for components, `camelCase.ts` for logic. No `util`, `extras` or `common`
  grab-bags. File names must differ by more than case.
- Start each file with a comment saying what it is and why it's shaped that way.

## Checks

```
npm run check     # generated API types up to date, typecheck, Biome lint + format check, tests
npm run format    # Biome format
npm run api:types # regenerate src/lib/api-schema.d.ts from api-schema.json (see API types)
```
- Tests cover pure logic only, and only cases nothing else covers.
- For visual changes, compare screenshots before and after (`localdev/screens.py`, light/dark × desktop/phone).
- Watch the bundle: libraries go to `vendor-*` chunks (vite.config.ts), and a new dependency needs a reason.
