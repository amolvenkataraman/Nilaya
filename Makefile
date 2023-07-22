ct:
	python3 -m daphne -b 0.0.0.0 -p 8000 Comptech.asgi:application

sh:
	python3 manage.py shell

cs:
	python3 manage.py collectstatic

mm:
	python3 manage.py makemigrations

mi:
	python3 manage.py migrate

m: mm mi
