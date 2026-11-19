"""Signed media URLs: the scheme nginx's `secure_link_secret` checks (nginx.conf; Comptech/localfiles.py locally).

A URL is /<prefix>/<md5(tail + SALT)>/<tail>. The tail is the file's path percent-encoded, plus the query
string if there is one, exactly as a client sends it: nginx hashes the raw request URI after the hash
segment, not the decoded $uri. The file is then looked up by the decoded path, without the query.

Encoding every character outside A-Z a-z 0-9 _ . - ~ and / means browsers, OkHttp and ExoPlayer send the
URL byte for byte as given, so a filename with a space, #, ?, % or accents works everywhere. Paths made of
those safe characters only (most camera files) give the same URL and hash as before encoding.
"""

import hashlib
import hmac
from urllib.parse import quote

from django.conf import settings


def _sign(tail):
    return hashlib.md5((tail + settings.SALT).encode()).hexdigest()  # noqa: S324 - nginx's scheme, not a password


def _tail(path, query=""):
    return quote(path, safe="/") + (f"?{query}" if query else "")


def signed_url(prefix, path, query=""):
    tail = _tail(path, query)
    return f"/{prefix}/{_sign(tail)}/{tail}"


def verify(signature, path, query=""):
    """For a request whose (decoded) path and raw query string are given: was this URL signed by us?"""
    return hmac.compare_digest(_sign(_tail(path, query)), signature)


def thumb_url(photo):
    """The thumbnail. `?v=` changes whenever the thumbnail is made again (Photo.thumb_version), so the
    URL can be cached forever; thumbnails made once (almost all) have no query at all."""
    v = photo.thumb_version
    return signed_url("private", f"photo_cache/thumbnail/{photo.id}.webp", f"v={v}" if v else "")


def file_url(photo):
    """The library file as ingested (the bytes `md5_hash` was taken of)."""
    return signed_url("photo_cdn", photo.get_path())
