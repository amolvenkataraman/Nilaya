"""Serve /private/ and /photo_cdn/ from Django for local testing (no nginx).

Mirrors nginx's `secure_link_secret`: the URL is /<prefix>/<md5(path + SALT)>/<path>,
so the exact same signed URLs the templates generate work locally. Only mounted
when settings.SERVE_FILES_WITH_DJANGO is true (Comptech/settings_local.py).
"""

import hashlib
import hmac

from django.conf import settings
from django.http import Http404
from django.views.static import serve


def _signed(document_root):
    def view(request, signature, path):
        expected = hashlib.md5((path + settings.SALT).encode()).hexdigest()  # noqa: S324 - nginx's scheme
        if not hmac.compare_digest(expected, signature):
            raise Http404("bad signature")
        return serve(request, path, document_root=document_root)  # safe-joins, no traversal

    return view


def private(request, signature, path):
    return _signed(settings.PRIVATE_ROOT)(request, signature, path)


def photo_cdn(request, signature, path):
    return _signed(settings.PHOTOS_ROOT)(request, signature, path)
