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
- Page shortcuts use `useHotkey` and bail out while `layerOpen()` is true. Never query the DOM for `.dialog`/`.menu`.
- Loading, error and empty states go through `<QueryView>`. Data on screen wins over an error, so a failed refresh never blanks a
  page.
- Requests go through `lib/api.ts` (it handles CSRF, 401 → sign-in, and clearing a signed-out user's cache). No `fetch()` in pages.
- Query keys start with the app (`['tasks', …]`). When a query is used in more than one place, export a `queryOptions()`
  factory from the app's `api.ts` and use it everywhere: hooks, `qc.fetchQuery`, loaders.
- Pass `signal` to `get()` in query functions, so React Query can cancel requests.

## Files

- One component per concern. A file over ~400 lines, or one holding several unrelated components, should be split.
- Name files after what they hold: `PascalCase.tsx` for components, `camelCase.ts` for logic. No `util`, `extras` or `common`
  grab-bags. File names must differ by more than case.
- Start each file with a comment saying what it is and why it's shaped that way.

## Checks

```
npm run check     # typecheck, Biome lint + format check, tests
npm run format    # Biome format
```
- Tests cover pure logic only, and only cases nothing else covers.
- For visual changes, compare screenshots before and after (`localdev/screens.py`, light/dark × desktop/phone).
- Watch the bundle: libraries go to `vendor-*` chunks (vite.config.ts), and a new dependency needs a reason.
