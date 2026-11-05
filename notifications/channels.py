"""Deliver a notification to an outside service (ntfy, Gotify, email, Discord, webhook).

Every sender raises DeliveryError. Destinations are checked before every request
(Comptech/netguard.py): never this server, loopback, link-local, multicast or reserved
addresses; LAN addresses are fine (self-hosted ntfy, Gotify or Home Assistant). When
ONLINE_MODE is off, only LAN destinations are allowed. Redirects are never followed.
Network failures get one generic message, so "Send test" can't be used to probe which
hosts and ports answer; the detail goes to the server log.
"""

import logging
from urllib.parse import urlsplit, urlunsplit

import requests
from django.conf import settings
from django.core.mail import send_mail

from Comptech import netguard

from .models import NotificationChannel, Priority

log = logging.getLogger("comptech.notifications")
TIMEOUT = 10
UNREACHABLE = "Couldn't deliver: check the URL (and token) and that the service is reachable from the server"
Kind = NotificationChannel.Kind

# Config fields per kind: (key, label, required, secret)
FIELDS = {
    Kind.NTFY: [("url", "Topic URL, e.g. https://ntfy.sh/my-topic", True, False),
                ("token", "Access token (optional)", False, True)],
    Kind.GOTIFY: [("url", "Server URL, e.g. http://gotify.lan", True, False),
                  ("token", "Application token", True, True)],
    Kind.EMAIL: [("address", "Email address", True, False)],
    Kind.DISCORD: [("url", "Discord webhook URL", True, True)],
    Kind.WEBHOOK: [("url", "URL to POST JSON to", True, False),
                   ("secret", "Shared secret, sent as X-Webhook-Secret (optional)", False, True)],
}


class DeliveryError(Exception):
    pass


def validate_config(kind, config):
    """Return a cleaned config dict for `kind`, or raise ValueError."""
    if kind not in FIELDS:
        raise ValueError(f"Unknown channel type {kind!r}")
    clean = {}
    for key, label, required, _secret in FIELDS[kind]:
        value = str(config.get(key) or "").strip()
        if required and not value:
            raise ValueError(f"{label.split(',')[0]} is required")
        if value and key == "url" and urlsplit(value).scheme not in ("http", "https"):
            raise ValueError("URL must start with http:// or https://")
        if value:
            clean[key] = value
    if kind == Kind.EMAIL and "@" not in clean.get("address", ""):
        raise ValueError("Enter a valid email address")
    return clean


def public_config(channel):
    """Config safe to send to the browser: secrets are masked."""
    secrets = {key for key, _l, _r, secret in FIELDS.get(channel.kind, []) if secret}
    return {k: ("••••" + v[-4:] if k in secrets and len(v) > 8 else ("••••" if k in secrets else v))
            for k, v in channel.config.items()}


def _check_destination(url):
    try:
        addresses = netguard.resolve(url)
    except netguard.Blocked as exc:
        log.info("Channel destination %s refused: %s", urlsplit(url).hostname, exc)
        raise DeliveryError(UNREACHABLE) from exc
    if not getattr(settings, "ONLINE_MODE", True) and not all(ip.is_private for ip in addresses):
        raise DeliveryError("Online mode is off: only LAN destinations are allowed")


def _post(url, **kwargs):
    _check_destination(url)
    try:
        response = requests.post(url, timeout=TIMEOUT, allow_redirects=False, **kwargs)  # a redirect would skip the check
    except requests.RequestException as exc:
        log.info("Channel delivery to %s failed: %s", urlsplit(url).hostname, type(exc).__name__)
        raise DeliveryError(UNREACHABLE) from exc
    if response.status_code >= 300:
        log.info("Channel delivery to %s answered HTTP %s", urlsplit(url).hostname, response.status_code)
        raise DeliveryError(UNREACHABLE)
    return response


def _link(notification):
    url = notification.url or ""
    if url.lower().startswith(("http://", "https://")):
        return url
    base = getattr(settings, "SITE_URL", "").rstrip("/")
    return f"{base}{url}" if url and base else ""


def _ntfy(channel, n):
    parts = urlsplit(channel.config["url"])
    topic = parts.path.strip("/")
    if not topic:
        raise DeliveryError("The ntfy URL needs a topic, e.g. https://ntfy.sh/my-topic")
    base = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    level = {Priority.LOW: 2, Priority.NORMAL: 3, Priority.HIGH: 4, Priority.URGENT: 5}
    payload = {"topic": topic, "title": n.title, "message": n.description or n.title,
               "priority": level.get(min(level, key=lambda p: abs(p - n.priority)), 3),
               "tags": [n.source.lower()]}
    if _link(n):
        payload["click"] = _link(n)
    headers = {"Authorization": f"Bearer {channel.config['token']}"} if channel.config.get("token") else {}
    _post(base + "/", json=payload, headers=headers)


def _gotify(channel, n):
    url = channel.config["url"].rstrip("/") + "/message"
    message = (n.description or "") + (f"\n\n{_link(n)}" if _link(n) else "")
    _post(url, params={"token": channel.config["token"]},
          json={"title": n.title, "message": message or n.title, "priority": max(0, min(10, n.priority // 2))})


def _email(channel, n):
    if not getattr(settings, "EMAIL_HOST", "") and settings.EMAIL_BACKEND.endswith("smtp.EmailBackend"):
        raise DeliveryError("Email isn't configured on the server (EMAIL_HOST is empty)")
    body = (n.description or "") + (f"\n\n{_link(n)}" if _link(n) else "")
    try:
        send_mail(f"[{n.source}] {n.title}", body or n.title, None, [channel.config["address"]])
    except Exception as exc:  # SMTP errors come in many types
        raise DeliveryError(f"Email failed: {type(exc).__name__}") from exc


def _discord(channel, n):
    text = f"**{n.title}**" + (f"\n{n.description}" if n.description else "") + (f"\n{_link(n)}" if _link(n) else "")
    _post(channel.config["url"], json={"content": text[:2000], "allowed_mentions": {"parse": []}})


def _webhook(channel, n):
    headers = {"X-Webhook-Secret": channel.config["secret"]} if channel.config.get("secret") else {}
    _post(channel.config["url"], headers=headers, json={
        "id": str(n.id), "title": n.title, "body": n.description or "", "source": n.source,
        "priority": n.priority, "url": _link(n) or n.url, "created_on": n.created_on.isoformat(),
        "user": n.user.username,
    })


SENDERS = {Kind.NTFY: _ntfy, Kind.GOTIFY: _gotify, Kind.EMAIL: _email, Kind.DISCORD: _discord, Kind.WEBHOOK: _webhook}


def send(channel, notification):
    SENDERS[channel.kind](channel, notification)
