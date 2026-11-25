## What this changes

<!-- What the PR does and why. Link the issue if there is one. -->

## How it was tested

<!-- Tests added or run, and what you checked by hand. For visible changes, add before and after screenshots (light and dark, desktop and phone). -->

## Checklist

- [ ] I have signed (or will sign) the Contributor License Agreement. To get it, open an issue titled "Contributor agreement". A PR can't be merged until the CLA is signed.
- [ ] Backend tests pass: `DJANGO_SETTINGS_MODULE=Comptech.settings_local .venv/bin/python manage.py test`
- [ ] Frontend checks pass: `npm run check` in `frontend/`
- [ ] I have read, understood and tested every line, including any AI-written code
- [ ] No CDNs, no new outbound calls outside `ONLINE_MODE`, no secrets
