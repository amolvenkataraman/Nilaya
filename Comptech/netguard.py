"""Guard for outbound requests to user-supplied URLs (notification channels and the like).

LAN destinations stay allowed (self-hosted ntfy, Gotify, Home Assistant are the main use), but
never this machine (Django, Redis, Postgres listen on it), link-local/metadata addresses, or
unspecified, multicast and reserved ranges. Callers must not follow redirects (a redirect would
skip this check)."""

import ipaddress
import socket
from urllib.parse import urlsplit


class Blocked(Exception):
    """The URL is malformed, doesn't resolve, or points somewhere it may not."""


def _is_own_address(ip):
    """True when `ip` is assigned to one of this machine's interfaces (binding to it succeeds)."""
    family = socket.AF_INET6 if ip.version == 6 else socket.AF_INET
    try:
        with socket.socket(family, socket.SOCK_DGRAM) as s:
            s.bind((str(ip), 0))
        return True
    except OSError:
        return False


def is_forbidden(ip):
    ip = getattr(ip, "ipv4_mapped", None) or ip  # ::ffff:127.0.0.1 is 127.0.0.1
    return (ip.is_loopback or ip.is_link_local or ip.is_unspecified or ip.is_multicast or ip.is_reserved
            or (ip.version == 4 and ip.packed[0] == 0) or _is_own_address(ip))


def resolve(url):
    """The addresses an http(s) URL's host resolves to, after refusing forbidden ones. Raises Blocked."""
    try:
        parts = urlsplit(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:  # e.g. a port out of range
        raise Blocked("invalid URL") from exc
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise Blocked("invalid URL")
    try:
        infos = socket.getaddrinfo(parts.hostname, port, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError) as exc:  # gaierror is an OSError
        raise Blocked("unresolvable host") from exc
    addresses = {ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos}
    if not addresses or any(is_forbidden(ip) for ip in addresses):
        raise Blocked("forbidden address")
    return addresses
