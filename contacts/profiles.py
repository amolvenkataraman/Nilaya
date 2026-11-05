"""Developer and social profiles: one handle (or URL for website/blog) per network.

normalize(network, raw) accepts what people paste (a handle, @handle or a profile URL) and
returns the canonical handle, or raises ValueError. link(network, handle) builds the profile
URL from the handle ourselves, so a stored value can never smuggle in another site or scheme.
Nothing here touches the network.
"""

import re
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit

HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$")
CTRL_RE = re.compile(r"[\x00-\x20\x7f]")
MAX_LEN = 500


class Net:
    def __init__(self, label, template=None, hosts=(), pattern=r"[A-Za-z0-9_.-]{1,64}", path=0, query=None,
                 kind="handle", prefix="", group="dev"):
        self.label, self.template, self.hosts, self.kind, self.group = label, template, hosts, kind, group
        self.pattern = re.compile(pattern)
        self.path, self.query, self.prefix = path, query, prefix  # where the handle sits in a profile URL


# Order is display order.
NETWORKS = {
    "website": Net("Website", kind="url", group="web"),
    "blog": Net("Blog", kind="url", group="web"),
    "github": Net("GitHub", "https://github.com/{h}", ("github.com",), r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"),
    "gitlab": Net("GitLab", "https://gitlab.com/{h}", ("gitlab.com",), r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}"),
    "linkedin": Net("LinkedIn", "https://www.linkedin.com/{h}", ("linkedin.com",),
                    r"(?:in|company|school|pub)/[A-Za-z0-9_%-]{2,100}", path="linkedin"),
    "stackoverflow": Net("Stack Overflow", "https://stackoverflow.com/users/{h}", ("stackoverflow.com",),
                         r"\d{1,10}(?:/[A-Za-z0-9-]{1,80})?", path="stackoverflow"),
    "hackernews": Net("Hacker News", "https://news.ycombinator.com/user?id={h}", ("news.ycombinator.com",),
                      r"[A-Za-z0-9_-]{2,15}", query="id"),
    "twitter": Net("X / Twitter", "https://x.com/{h}", ("twitter.com", "x.com"), r"[A-Za-z0-9_]{1,15}", group="social"),
    "mastodon": Net("Mastodon", None, (), r"[A-Za-z0-9_]{1,64}@[a-z0-9.-]+\.[a-z]{2,}", path="mastodon", group="social"),
    "bluesky": Net("Bluesky", "https://bsky.app/profile/{h}", ("bsky.app",),
                   r"(?:[a-z0-9-]+\.)+[a-z]{2,}|did:plc:[a-z0-9]{24}", path=1, group="social"),
    "devto": Net("dev.to", "https://dev.to/{h}", ("dev.to",), r"[A-Za-z0-9_]{1,60}"),
    "codeberg": Net("Codeberg", "https://codeberg.org/{h}", ("codeberg.org",), r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,39}"),
    "sourcehut": Net("SourceHut", "https://sr.ht/{h}", ("sr.ht", "git.sr.ht"), r"~[a-z0-9_-]{1,64}", path="sourcehut"),
    "huggingface": Net("Hugging Face", "https://huggingface.co/{h}", ("huggingface.co",), r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}"),
    "kaggle": Net("Kaggle", "https://www.kaggle.com/{h}", ("kaggle.com",), r"[A-Za-z0-9_-]{1,60}"),
    "leetcode": Net("LeetCode", "https://leetcode.com/u/{h}/", ("leetcode.com",), r"[A-Za-z0-9_-]{1,60}", path="leetcode"),
    "npm": Net("npm", "https://www.npmjs.com/~{h}", ("npmjs.com",), r"[a-z0-9][a-z0-9._-]{0,213}", path="tilde"),
    "pypi": Net("PyPI", "https://pypi.org/user/{h}/", ("pypi.org",), r"[A-Za-z0-9_.-]{1,64}", path=1),
    "orcid": Net("ORCID", "https://orcid.org/{h}", ("orcid.org",), r"\d{4}-\d{4}-\d{4}-\d{3}[\dX]", group="research"),
    "scholar": Net("Google Scholar", "https://scholar.google.com/citations?user={h}", ("scholar.google",),
                   r"[A-Za-z0-9_-]{12}", query="user", group="research"),
    "keybase": Net("Keybase", "https://keybase.io/{h}", ("keybase.io",), r"[A-Za-z0-9_]{2,16}"),
    "medium": Net("Medium", "https://medium.com/@{h}", ("medium.com",), r"[A-Za-z0-9_.]{1,64}", path="at", group="social"),
    "youtube": Net("YouTube", "https://www.youtube.com/@{h}", ("youtube.com",), r"[A-Za-z0-9_.-]{3,30}", path="at", group="social"),
    "instagram": Net("Instagram", "https://www.instagram.com/{h}", ("instagram.com",), r"[A-Za-z0-9_.]{1,30}", group="social"),
    "reddit": Net("Reddit", "https://www.reddit.com/user/{h}", ("reddit.com",), r"[A-Za-z0-9_-]{3,20}", path=1, group="social"),
    "discord": Net("Discord", None, ("discord.com",), r"[a-z0-9_.]{2,32}|.{2,32}#\d{4}|\d{17,20}", path=1, group="chat"),
    "telegram": Net("Telegram", "https://t.me/{h}", ("t.me", "telegram.me"), r"[A-Za-z0-9_]{5,32}", group="chat"),
    "signal": Net("Signal", None, (), r"\+\d{7,15}|[A-Za-z0-9_]{3,32}\.\d{2,10}", group="chat"),
    "matrix": Net("Matrix", "https://matrix.to/#/{h}", ("matrix.to",),
                  r"@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]+\.[a-z]{2,}(?::\d{1,5})?", path="matrix", group="chat"),
}
ALIASES = {"x": "twitter", "twitter/x": "twitter", "x / twitter": "twitter", "stack overflow": "stackoverflow",
           "hacker news": "hackernews", "hn": "hackernews", "dev.to": "devto", "google scholar": "scholar",
           "homepage": "website", "home page": "website", "personal": "website", "web": "website", "site": "website",
           "personal website": "website", "web page": "website", "hugging face": "huggingface", "sourcehut": "sourcehut"}


def network_key(label):
    """'GitHub' / 'github' / 'X' -> 'github' / 'twitter'; '' if it isn't a known network."""
    k = (label or "").strip().lower()
    if k in NETWORKS:
        return k
    if k in ALIASES:
        return ALIASES[k]
    for key, net in NETWORKS.items():
        if net.label.lower() == k:
            return key
    return ""


def clean_url(raw):
    """An http(s) URL with a real host and no credentials; adds https:// to bare domains."""
    raw = (raw or "").strip()
    if not raw or len(raw) > MAX_LEN or CTRL_RE.search(raw):
        raise ValueError("Enter a valid web address")
    if "://" not in raw:
        if ":" in raw.split("/", 1)[0] and not re.match(r"^[a-z0-9.-]+:\d+(/|$)", raw, re.I):
            raise ValueError("Only http and https links are allowed")
        raw = "https://" + raw
    try:
        u = urlsplit(raw)
        port = u.port
    except ValueError:
        raise ValueError("Enter a valid web address") from None
    if u.scheme.lower() not in ("http", "https"):
        raise ValueError("Only http and https links are allowed")
    if u.username is not None or u.password is not None:
        raise ValueError("Links can't contain a username or password")
    host = (u.hostname or "").rstrip(".")
    try:
        host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise ValueError("Enter a valid web address") from None
    if not (HOST_RE.match(host) or host == "localhost" or re.match(r"^\d{1,3}(\.\d{1,3}){3}$", host)):
        raise ValueError("Enter a valid web address")
    netloc = host + (f":{port}" if port else "")
    return urlunsplit((u.scheme.lower(), netloc, u.path or "", u.query, u.fragment))


def _host_ok(net, host):
    for h in net.hosts:
        if host == h or host.endswith("." + h) or (h.endswith(".google") and host.startswith(h + ".")) \
                or (h == "scholar.google" and host.startswith("scholar.google.")):
            return True
    return False


def _from_url(key, net, raw):
    url = clean_url(raw)
    u = urlsplit(url)
    host = u.hostname or ""
    segs = [s for s in u.path.split("/") if s]
    if key == "mastodon":
        if len(segs) == 1 and segs[0].startswith("@"):
            return f"{segs[0][1:]}@{host}"
        raise ValueError("Use a Mastodon address like user@instance.social or https://instance.social/@user")
    if not _host_ok(net, host):
        raise ValueError(f"That isn't a {net.label} link")
    if key == "matrix":
        return u.fragment.lstrip("/")
    if net.query:
        return (parse_qs(u.query).get(net.query) or [""])[0]
    p = net.path
    if p == "linkedin":
        return "/".join(segs[:2]) if len(segs) >= 2 else ""
    if p == "stackoverflow":
        return "/".join(segs[1:3]) if len(segs) >= 2 and segs[0] == "users" else ""
    if p == "leetcode":
        return segs[1] if len(segs) >= 2 and segs[0] == "u" else (segs[0] if segs else "")
    if p in ("at", "tilde"):
        return segs[0][1:] if segs and segs[0][:1] in "@~" else ""
    if p == "sourcehut":
        return segs[0] if segs else ""
    if isinstance(p, int):
        return segs[p] if len(segs) > p else ""
    return segs[0] if segs else ""


def _looks_like_url(raw, net):
    low = raw.lower()
    if "://" in low or (not net.hosts and "/" in low):
        return True
    first = low.split("/", 1)[0]
    if first.startswith("www."):
        return True
    return "/" in low and any(first == h or first.endswith("." + h) or first.startswith(h + ".") for h in net.hosts)


def normalize(key, raw):
    net = NETWORKS.get(key)
    if net is None:
        raise ValueError(f"Unknown profile type: {key}")
    raw = (raw or "").strip()
    if not raw or len(raw) > MAX_LEN:
        raise ValueError(f"Enter a {net.label} handle or link")
    if net.kind == "url":
        return clean_url(raw)
    if _looks_like_url(raw, net):
        h = _from_url(key, net, raw)
    else:
        h = raw
        if key == "mastodon":
            h = h.lstrip("@")
            if "@" in h:
                user, _, inst = h.rpartition("@")
                h = f"{user}@{inst.lower()}"
        elif key == "matrix":
            h = ("@" + h.lstrip("@")).lower() if ":" in h else h
        elif key == "linkedin":
            h = h.strip("/")
            if "/" not in h:
                h = "in/" + h
        elif key == "sourcehut":
            h = "~" + h.lstrip("~")
        elif key == "bluesky":
            h = h.lstrip("@").lower()
            if "." not in h and not h.startswith("did:"):
                h += ".bsky.social"
        elif key == "signal" and h.startswith("+"):
            h = "+" + re.sub(r"[\s().-]", "", h[1:])
        elif key not in ("discord",):
            h = h.lstrip("@~")
    if key == "linkedin":
        h = h.rstrip("/")
    if not net.pattern.fullmatch(h):
        raise ValueError(f"That doesn't look like a {net.label} handle")
    if key == "orcid" and not _orcid_ok(h):
        raise ValueError("That ORCID iD's check digit is wrong")
    return h


def _orcid_ok(h):
    digits = h.replace("-", "")
    total = 0
    for ch in digits[:-1]:
        total = (total + int(ch)) * 2
    check = (12 - total % 11) % 11
    return digits[-1] == ("X" if check == 10 else str(check))


def link(key, handle):
    """Canonical profile URL for a normalised handle (None if the network has no public profile URL)."""
    net = NETWORKS.get(key)
    if net is None or not handle:
        return None
    if net.kind == "url":
        return handle
    if key == "mastodon":
        user, _, inst = handle.rpartition("@")
        return f"https://{inst}/@{quote(user)}"
    if key == "discord":
        return f"https://discord.com/users/{handle}" if handle.isdigit() else None
    if key == "signal":
        return f"https://signal.me/#p/{handle}" if handle.startswith("+") else None
    return net.template.format(h=quote(handle, safe="/@:~+=."))


def links(profiles):
    out = []
    for key, net in NETWORKS.items():
        h = (profiles or {}).get(key)
        if h:
            out.append({"network": key, "label": net.label, "handle": h, "url": link(key, h)})
    return out


def classify_url(url, label=""):
    """Imported URL -> (network, handle), trying the label first; ("", clean_url) if it's just a link."""
    hint = network_key(label)
    if hint:
        try:
            return hint, normalize(hint, url)
        except ValueError:
            pass
    clean = clean_url(url)
    host = urlsplit(clean).hostname or ""
    for key, net in NETWORKS.items():
        if net.hosts and _host_ok(net, host):
            try:
                return key, normalize(key, clean)
            except ValueError:
                break
    else:
        try:
            return "mastodon", normalize("mastodon", clean)
        except ValueError:
            pass
    return "", clean
