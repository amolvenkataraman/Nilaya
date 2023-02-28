# Comptech/celery.py

import os
from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Comptech.settings")
app = Celery("Comptech")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()