"""Serve /private/ and /photo_cdn/ from Django for local testing (no nginx).

Mirrors nginx's `secure_link_secret`: the URL is /<prefix>/<md5(tail + SALT)>/<tail>, where the tail is
the percent-encoded path plus any query string, as sent (photos/signed.py). Django hands the view the
decoded path, which encodes back to the same tail. Files are served with the same long-lived
Cache-Control as nginx.conf: a file's URL changes whenever its content does (thumbnails carry ?v=).
Only mounted when settings.SERVE_FILES_WITH_DJANGO is true (Comptech/settings_local.py).
"""

from django.conf import settings
from django.http import Http404
from django.views.static import serve

from photos.signed import verify


def _signed(document_root):
    def view(request, signature, path):
        if not verify(signature, path, request.META.get("QUERY_STRING", "")):
            raise Http404("bad signature")
        response = serve(request, path, document_root=document_root)  # safe-joins, no traversal
        response["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

    return view


def private(request, signature, path):
    return _signed(settings.PRIVATE_ROOT)(request, signature, path)


def photo_cdn(request, signature, path):
    return _signed(settings.PHOTOS_ROOT)(request, signature, path)
