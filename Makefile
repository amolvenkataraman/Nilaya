# Daphne listens only on this machine by default: nginx proxies to 127.0.0.1:8000. To also open
# http://<server>:8000 directly from the LAN, run `make DAPHNE_BIND=0.0.0.0` (or export DAPHNE_BIND).
DAPHNE_BIND ?= 127.0.0.1
DAPHNE_PORT ?= 8000

ct:
	python3 -m daphne -b $(DAPHNE_BIND) -p $(DAPHNE_PORT) Comptech.asgi:application

sh:
	python3 manage.py shell

cs:
	python3 manage.py collectstatic --noinput

mm:
	python3 manage.py makemigrations

mi:
	python3 manage.py migrate

m: mm mi

# The React app's API types: the V2 OpenAPI schema (frontend/src/lib/api-schema.json), then the TypeScript generated
# from it (api-schema.d.ts). Run after changing any API schema; locally: make api-types PYTHON=.venv/bin/python
# with DJANGO_SETTINGS_MODULE=Comptech.settings_local.
PYTHON ?= python3
api-types:
	$(PYTHON) manage.py api_schema
	cd frontend && npm run api:types
