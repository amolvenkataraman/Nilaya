"""Serves the new React UI (frontend/, built into static_files/static/app/) at /app/..."""

from pathlib import Path

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse

INDEX = Path(settings.BASE_DIR) / "static_files" / "static" / "app" / "index.html"


@login_required
def index(request):
    if not INDEX.exists():
        return HttpResponse("The new interface isn't built on this server yet: run frontend/build.sh.",
                            status=503, content_type="text/plain")
    return HttpResponse(INDEX.read_text(), content_type="text/html")
