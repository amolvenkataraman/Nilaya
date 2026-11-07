"""A strict, dependency-free vCard 2.1 / 3.0 / 4.0 reader and a vCard 4.0 writer.

Reading: line unfolding (CRLF + space/tab), quoted-printable soft breaks, CHARSET, value
escapes (\\n \\, \\; \\\\), group prefixes with Apple X-ABLabel labels, TYPE params in every
dialect (TYPE=a,b / TYPE=a;TYPE=b / bare 2.1 types / quoted 4.0 lists), embedded base64 photos
(URI photos are ignored: we never fetch anything). Nested 2.1 AGENT cards are skipped.
"""

import base64
import binascii
import quopri
import re

from . import profiles
from . import records as R

PHOTO_MAX = 1_000_000  # bytes of decoded image data we're willing to look at


# ------------------------------------------------------------------ low level

def _split_unquoted(s, sep, maxsplit=-1):
    out, cur, q = [], [], False
    for ch in s:
        if ch == '"':
            q = not q
        if ch == sep and not q and maxsplit != 0:
            out.append("".join(cur))
            cur = []
            maxsplit -= 1
            continue
        cur.append(ch)
    out.append("".join(cur))
    return out


def _split_escaped(s, sep):
    """Split on `sep` not preceded by a backslash (components stay escaped)."""
    out, cur, i = [], [], 0
    while i < len(s):
        ch = s[i]
        if ch == "\\" and i + 1 < len(s):
            cur.append(s[i:i + 2])
            i += 2
            continue
        if ch == sep:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    out.append("".join(cur))
    return out


def _unescape(s):
    return re.sub(r"\\(.)", lambda m: "\n" if m.group(1) in "nN" else m.group(1), s)


def _logical_lines(text):
    """Unfold into logical lines. Each line is gathered as a list of non-empty chunks and joined once, so a
    long folded value (a photo, a big note) costs linear time instead of a copy per continuation line."""
    lines, cur = [], None
    colon = qp = False  # the current line has its ':' yet / its head says QUOTED-PRINTABLE
    for raw in re.split(r"\r\n|\r|\n", text):
        if cur is not None and qp and cur[-1].endswith("="):
            cur[-1] = cur[-1][:-1]  # quoted-printable soft line break
            if not cur[-1] and len(cur) > 1:
                cur.pop()
            piece = raw
        elif cur is not None and raw[:1] in (" ", "\t"):
            piece = raw[1:]
        else:
            if cur is not None:
                lines.append("".join(cur))
            cur, colon, qp, piece = [], False, False, raw
        if piece or not cur:
            if not colon and ":" in piece:
                colon = True
                qp = "QUOTED-PRINTABLE" in ("".join(cur) + piece.split(":", 1)[0]).upper()
            cur.append(piece)
    if cur is not None:
        lines.append("".join(cur))
    return lines


def _parse_line(line):
    parts = _split_unquoted(line, ":", 1)
    if len(parts) != 2:
        return None
    head, value = parts
    bits = _split_unquoted(head, ";")
    name = bits[0].strip()
    group = ""
    if "." in name:
        group, name = name.rsplit(".", 1)
    params = {}
    for b in bits[1:]:
        if "=" in b:
            k, v = b.split("=", 1)
        else:
            k, v = "TYPE", b
        vals = [x.strip().strip('"') for x in _split_unquoted(v, ",")]
        params.setdefault(k.strip().upper(), []).extend(x for x in vals if x)
    return group.lower(), name.upper(), params, value


def _decode(params, value):
    enc = (params.get("ENCODING") or [""])[0].upper()
    if enc == "QUOTED-PRINTABLE":
        data = quopri.decodestring(value.encode("latin-1", "replace"))
        charset = (params.get("CHARSET") or ["utf-8"])[0]
        try:
            return data.decode(charset)
        except (LookupError, UnicodeDecodeError):
            return data.decode("latin-1")
    return value


# ------------------------------------------------------------------ cards -> records

def parse_vcards(text, max_cards=None):
    cards, cur, depth = [], None, 0
    for line in _logical_lines(text):
        if not line.strip():
            continue
        parsed = _parse_line(line)
        if not parsed:
            continue
        group, name, params, value = parsed
        if name == "BEGIN" and value.strip().upper() == "VCARD":
            depth += 1
            if depth == 1:
                cur = []
            continue
        if name == "END" and value.strip().upper() == "VCARD":
            depth = max(0, depth - 1)
            if depth == 0 and cur is not None:
                cards.append(cur)
                cur = None
                if max_cards and len(cards) > max_cards:
                    raise R.ImportFailed(f"That file has more than {max_cards:,} contacts")
            continue
        if depth == 1 and cur is not None and len(cur) < 1000:
            cur.append((group, name, params, value))
    out = []
    for props in cards:
        rec = _card(props)
        if rec:
            out.append(rec)
    return out


def _types(params):
    return ",".join(params.get("TYPE", []))


def _card(props):
    rec = R.new()
    ab_labels = {g: _unescape(_decode(p, v)) for g, n, p, v in props if n == "X-ABLABEL" and g}
    fn = ""
    notes = []
    for group, name, params, raw in props:
        lbl = ab_labels.get(group) or _types(params)
        if name in ("KIND", "X-ADDRESSBOOKSERVER-KIND") and raw.strip().lower() == "group":
            return None
        if name == "PHOTO":
            photo = _photo(params, raw)
            if photo:
                rec["photo"] = photo
            continue
        value = _decode(params, raw)
        if name == "FN":
            fn = R.text(_unescape(value))
        elif name == "N":
            c = [R.text(_unescape(x), 128) for x in _split_escaped(value, ";")] + [""] * 5
            rec.update(last_name=c[0], first_name=c[1], middle_name=c[2], prefix=c[3][:32], suffix=c[4][:32])
        elif name == "NICKNAME":
            rec["nickname"] = R.text(_unescape(_split_escaped(value, ",")[0]), 128)
        elif name == "ORG":
            c = [R.text(_unescape(x)) for x in _split_escaped(value, ";")]
            rec["company"] = c[0]
            if len(c) > 1:
                rec["department"] = R.text(" / ".join(x for x in c[1:] if x))
        elif name == "TITLE":
            rec["title"] = R.text(_unescape(value))
        elif name == "ROLE":
            rec.setdefault("title", R.text(_unescape(value)))
        elif name == "EMAIL":
            R.add_email(rec, _unescape(value), lbl)
        elif name == "TEL":
            R.add_phone(rec, _unescape(value), lbl)
        elif name == "ADR":
            c = [_unescape(x) for x in _split_escaped(value, ";")] + [""] * 7
            street = ", ".join(x for x in (c[0], c[1], c[2]) if x.strip())
            R.add_address(rec, lbl, street, c[3], c[4], c[5], c[6])
        elif name == "BDAY":
            rec["birthday"] = R.fmt_date(R.parse_date(value))
        elif name in ("ANNIVERSARY", "X-ANNIVERSARY", "X-MS-ANNIVERSARY", "X-EVOLUTION-ANNIVERSARY") or (
                name == "X-ABDATE" and "anniversary" in lbl.lower()):
            d = R.parse_date(value)
            if d and d[0]:
                rec["anniversary"] = R.fmt_date(d)
        elif name == "NOTE":
            notes.append(_unescape(value))
        elif name == "CATEGORIES":
            R.add_tags(rec, [_unescape(x) for x in _split_escaped(value, ",")])
        elif name == "X-NILAYA-GROUPS":
            R.add_tags(rec, [_unescape(x) for x in _split_escaped(value, ",")], "groups")
        elif name == "URL":
            R.add_url(rec, _unescape(value), lbl if group in ab_labels else (params.get("TYPE") or [""])[0])
        elif name == "X-SOCIALPROFILE":
            net = profiles.network_key((params.get("TYPE") or [""])[0])
            user = (params.get("X-USER") or [""])[0]
            v = _unescape(value)
            if not (net and (R.add_profile(rec, net, v) or (user and R.add_profile(rec, net, user)))):
                R.add_url(rec, v, (params.get("TYPE") or [""])[0])
        elif name == "IMPP":
            v = _unescape(value)
            service = (params.get("X-SERVICE-TYPE") or [""])[0] or v.split(":", 1)[0]
            net = profiles.network_key(service)
            handle = v.split(":", 1)[1] if ":" in v else v
            if not (net and R.add_profile(rec, net, handle)):
                R.add_custom(rec, service.title() or "IM", handle)
        elif name == "X-NILAYA-FIELD":
            c = [_unescape(x) for x in _split_escaped(value, ";")] + [""]
            R.add_custom(rec, c[0], c[1])
        elif name == "X-NILAYA-KEEP-IN-TOUCH" and value.strip().isdigit():
            rec["keep_in_touch_days"] = min(int(value), 3650) or None
        elif name == "X-NILAYA-FAVORITE":
            rec["favorite"] = value.strip() == "1"
        elif name == "X-NILAYA-HOW-MET":
            rec["how_met"] = R.text(_unescape(value), R.NOTES_MAX)
        elif name == "UID":
            rec["uid"] = R.text(value, 100)
        elif name == "RELATED":
            kind = (params.get("TYPE") or ["other"])[0].lower()
            rec.setdefault("related", []).append((kind, R.text(value, 100)))
        elif name.startswith("X-") and profiles.network_key(name[2:]):
            R.add_profile(rec, profiles.network_key(name[2:]), _unescape(value))
    if notes:
        rec["notes"] = R.text("\n\n".join(notes), R.NOTES_MAX)
    if fn:
        composed = {" ".join(x for x in (rec.get("first_name"), rec.get("middle_name"), rec.get("last_name")) if x),
                    " ".join(x for x in (rec.get("prefix"), rec.get("first_name"), rec.get("middle_name"),
                                         rec.get("last_name"), rec.get("suffix")) if x)}
        if not any(rec.get(k) for k in ("first_name", "last_name")):
            if fn != rec.get("company"):
                R.split_name(rec, fn)
        elif fn not in composed:
            rec["display_name"] = fn
    return R.finish(rec)


def _photo(params, raw):
    enc = (params.get("ENCODING") or [""])[0].lower()
    data = raw.strip()
    if data.startswith("data:"):
        head, _, data = data.partition(",")
        if ";base64" not in head:
            return None
    elif enc not in ("b", "base64"):
        return None  # a URI: never fetched
    if len(data) > PHOTO_MAX * 4 // 3 + 4:
        return None
    try:
        return base64.b64decode(re.sub(r"\s+", "", data), validate=True)
    except (binascii.Error, ValueError):
        return None


# ------------------------------------------------------------------ person -> vCard 4.0

def _esc(v):
    return str(v).replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def _fold(line):
    """Fold at 75 octets without splitting a UTF-8 sequence."""
    out, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > 75:
            out.append(cur)
            cur, size = " ", 1
        cur += ch
        size += n
    out.append(cur)
    return "\r\n".join(out)


def _param(v):
    v = re.sub(r'[\x00-\x1f";:,]', "", str(v))
    return v


def to_vcard(p, tags=(), groups=(), related=()):
    L = ["BEGIN:VCARD", "VERSION:4.0", f"UID:urn:uuid:{p.id}", f"FN:{_esc(p.name)}",
         "N:" + ";".join(_esc(x) for x in (p.last_name, p.first_name, p.middle_name, p.prefix, p.suffix))]
    if p.nickname:
        L.append(f"NICKNAME:{_esc(p.nickname)}")
    if p.company or p.department:
        L.append(f"ORG:{_esc(p.company)}" + (f";{_esc(p.department)}" if p.department else ""))
    if p.title:
        L.append(f"TITLE:{_esc(p.title)}")
    for e in p.emails:
        L.append("EMAIL" + (f";TYPE={_param(e['label'])}" if e.get("label") else "") + f":{_esc(e['value'])}")
    for t in p.phones:
        L.append("TEL" + (f";TYPE={_param('cell' if t.get('label') == 'mobile' else t['label'])}" if t.get("label") else "")
                 + f":{_esc(t['value'])}")
    for a in p.addresses:
        L.append("ADR" + (f";TYPE={_param(a['label'])}" if a.get("label") else "") + ":;;" + ";".join(
            _esc(a.get(k, "")) for k in ("street", "city", "region", "postcode", "country")))
    if p.birthday:
        L.append("BDAY:" + (p.birthday.replace("-", "") if p.birthday_year else "--" + p.birthday[2:].replace("-", "")))
    if p.anniversary:
        L.append(f"ANNIVERSARY:{p.anniversary:%Y%m%d}")
    if p.notes:
        L.append(f"NOTE:{_esc(p.notes)}")
    if tags:
        L.append("CATEGORIES:" + ",".join(_esc(t) for t in tags))
    if groups:
        L.append("X-NILAYA-GROUPS:" + ",".join(_esc(g) for g in groups))
    for key, h in p.profiles.items():
        if key in ("website", "blog"):
            L.append(f"URL;TYPE={key}:{h}")
        else:
            L.append(f"X-SOCIALPROFILE;TYPE={key}:{_esc(profiles.link(key, h) or h)}")
    for link in p.links:
        L.append(f"URL;TYPE={_param(link.get('label') or 'other')}:{link['url']}")
    for c in p.custom_fields:
        L.append(f"X-NILAYA-FIELD:{_esc(c['key'])};{_esc(c['value'])}")
    if p.keep_in_touch_days:
        L.append(f"X-NILAYA-KEEP-IN-TOUCH:{p.keep_in_touch_days}")
    if p.favorite:
        L.append("X-NILAYA-FAVORITE:1")
    if p.how_met:
        L.append(f"X-NILAYA-HOW-MET:{_esc(p.how_met)}")
    for kind, other_id in related:
        L.append(f"RELATED;TYPE={_param(kind)}:urn:uuid:{other_id}")
    if p.avatar:
        L.append("PHOTO:data:image/jpeg;base64," + base64.b64encode(bytes(p.avatar)).decode())
    L.append("END:VCARD")
    return "\r\n".join(_fold(x) for x in L) + "\r\n"
