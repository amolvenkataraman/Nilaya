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
