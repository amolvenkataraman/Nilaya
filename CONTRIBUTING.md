# Contributing to Nilaya

Outside contributions are welcome, and a PR can be quite literally anything: a bug fix, a mobile app, a new photo ingest method, or a whole new app. What matters is that it follows the [build philosophy](https://amolven.com/build-philosophy) and the rules of this repo, below.

## Contributor License Agreement (CLA)

**You must sign the Contributor License Agreement before your pull request can be merged.** You can open a PR before you sign, but it won't be merged until the CLA is signed.

Nilaya is dual-licensed: it's available under the [GNU AGPL-3.0](LICENSE), and a commercial licence can be bought by those who want to use it outside the AGPL's terms (see [Licence](README.md#licence)). The CLA is what makes this possible: it lets contributions be included in both the AGPL and the commercial versions.

To get the CLA, contact the owner: open an issue titled "Contributor agreement" in the [GitHub repository](https://github.com/amolvenkataraman/Nilaya/issues).

<!-- TODO(owner): add a preferred contact method for getting and signing the CLA (GitHub Discussions is off for this repo). -->

## Issues

- **Bugs:** open an issue with what you did, what you expected and what happened instead. Include the app (Calendar, Photos, …), your browser or device, and any error from the browser console or the server log.
- **Ideas and anything big:** open an issue first so we can agree on the approach before you write the code. Read [Is it for you?](README.md#is-it-for-you-read-this-first) and the [limitations](README.md#limitations) first; some things are left out on purpose.
- **Security problems:** don't put the details in a public issue. Open an issue asking for a private way to report it, without the details.

## Pull requests

1. Fork the repo and make a branch from `master`.
2. Set up a local copy (SQLite, no Redis, no nginx, dummy data) as described in [localdev/README.md](localdev/README.md):

   ```bash
   localdev/setup.sh [--photos]
   frontend/build.sh
   localdev/run.sh                   # http://127.0.0.1:8000  (login: amol / localdev)
   ```

3. Make your change. For the React app, follow [frontend/AGENTS.md](frontend/AGENTS.md) (styling, shared components, file layout) and [frontend/README.md](frontend/README.md) (hot-reloading dev server).
4. Run the checks below, and fix anything they report.
5. Open the PR. Say what it changes and why, how you tested it, and include before and after screenshots for visible changes (`localdev/screens.py` takes light, dark, desktop and phone shots).

Keep a PR to one change. Several small PRs are easier to review than one large one.

### Checks

Backend tests, from the repo root:

```bash
DJANGO_SETTINGS_MODULE=Comptech.settings_local .venv/bin/python manage.py test
```

Frontend, in `frontend/` (typecheck, Biome lint and format check, tests):

```bash
npm ci
npm run check
```

If you change the V2 API's schema, regenerate the frontend's API types with `make api-types PYTHON=.venv/bin/python` (with `DJANGO_SETTINGS_MODULE=Comptech.settings_local`); `npm run check` fails while they're out of date.

`.venv/bin/python localdev/smoke.py` signs in and checks every route against a running local copy, which is a quick way to catch a broken page.

### Tests

Add tests for what your change does, and keep them small: cover the cases nothing else covers, and don't duplicate an existing test. Frontend tests cover pure logic only.

## Ground rules

- **No CDNs.** The app bundles its dependencies from npm, pinned in `frontend/package-lock.json`.
- **No new outbound network calls** without a switch behind `ONLINE_MODE`. With it off, the server only talks to the LAN.
- **Never commit secrets** or site-specific values. They live in untracked files (`Comptech/site.json`, `Comptech/*.txt`).
- **Speed matters.** Keep requests few and queries indexed; the photo library in production has hundreds of thousands of photos.
- **Don't drop information.** A redesigned page keeps every field and detail the current one shows.
- **The visible name is Nilaya;** the code name stays Comptech. Don't rename packages, models or the database.
- **AI-written code is fine** as long as a human has read, understood and tested every line before opening the PR. That's the same standard this repo holds itself to (see [Credits](README.md#credits)).

## Licence

Contributions are accepted under the terms of the CLA above. Nilaya is available under the [GNU AGPL-3.0](LICENSE) or a commercial licence; see [Licence](README.md#licence) in the README.
