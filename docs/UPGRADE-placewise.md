# Upgrade: place names and search from placewise

Nilaya's place names (a photo's city, state and country), the Places search box and the server's map maths
now come from [placewise](https://pypi.org/project/placewise/). placewise works offline from data packs on
the server and runs as its own local service, started with the rest of the platform. It replaces the
`reverse_geocode` package and the OpenStreetMap (Nominatim) search, so the server no longer makes outbound
place lookups.

## What changed for deployment

| What | Change |
|---|---|
| Python package | `placewise==0.1.0a2` replaces `reverse_geocode` (`requirements.txt`) |
| Data packs | about 650 MB in `~/.placewise/` of the user that runs `Comptech.sh`, installed once (below) |
| Service | `Comptech.sh` opens tmux window 4: `placewise --offline serve` on `127.0.0.1:8770` (loopback, no keys), so other programs on the server can use it too. Set `PLACEWISE_URL` if it runs elsewhere |
| Memory | about 2 GB for the service with these packs, once for the whole server |
| Database | `photos.0034` adds `location_admin1` (state or province); `maintenance.0001` adds the job history |
| Admin | Settings › Maintenance (staff) runs maintenance jobs, including renaming every photo's place |

## Step by step

1. **Get the code and the package** (in `/opt/Comptech`, venv active):
   ```bash
   git pull
   pip install -r requirements.txt
   pip uninstall -y reverse_geocode   # optional: no longer used
   ```
2. **Install the data packs** as the same user that runs `Comptech.sh` (downloads about 250 MB):
   ```bash
   placewise data install world usa can ind usa-parks can-parks world-notable world-parks world-postal world-towns world-water
   placewise data status
   ```
   The service runs with `--offline`, so it never downloads anything itself. `placewise data update` fetches
   newer packs when you choose to; restart window 4 afterwards.
3. **Migrate:** `python manage.py migrate`.
4. **Start the service.** On a fresh start, `Comptech.sh` does it. In a running session, open a window and
   run the same command:
   ```bash
   tmux new-window -t Comptech:4 -n placewise
   tmux send-keys -t Comptech:4 "cd /opt/Comptech && /opt/Comptech/CT_env/bin/placewise --offline serve --host 127.0.0.1 --port 8770" C-m
   curl -s http://127.0.0.1:8770/v1/health    # {"status": "ok", "data_version": "world-2026.11.1+usa-..."}
   ```
   The first lookups after a start take a few seconds while indexes load.
5. **Restart Daphne and the Celery worker** (window 0 and window 2) so they load the new code.
6. **Rename the library's places:** Settings › Maintenance › Name photo places. Run it with "Preview only"
   first to see what changes, then again without it. Photos keep their old names until then; new photos are
   named on ingest.

## Rolling back

Check out the previous commit, `pip install reverse_geocode`, and restart. `location_admin1` stays in the
database unused; the photos keep the place names placewise gave them until the rename runs again.
