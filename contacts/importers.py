"""Parse an uploaded contacts file into import records (see contacts.records).

Formats are detected from the content: vCard (2.1/3.0/4.0), Google Contacts CSV (current and
legacy layouts), Outlook CSV, LinkedIn Connections.csv (with its notes preamble), and any other
CSV through a column mapping (guessed from the headers, overridable). Files are untrusted: size
and row limits, text only, no formulas evaluated, nothing fetched.
"""

import codecs
import csv
import io
import re
from dataclasses import dataclass, field

from . import profiles
from . import records as R
from .records import ImportFailed  # noqa: F401  (re-exported for callers)
from .vcard import parse_vcards

MAX_BYTES = 5 * 1024 * 1024
MAX_CONTACTS = 5000

FORMATS = {"vcard": "vCard", "google": "Google Contacts CSV", "outlook": "Outlook CSV",
           "linkedin": "LinkedIn connections", "csv": "CSV"}

# Generic CSV targets (column -> field). Network keys are allowed too.
FIELDS = {
    "": "Don't import", "full_name": "Full name", "first_name": "First name", "middle_name": "Middle name",
    "last_name": "Last name", "nickname": "Nickname", "company": "Company", "title": "Title / role",
    "department": "Department", "email": "Email", "phone": "Phone", "street": "Street", "city": "City",
    "region": "State / region", "postcode": "Postal code", "country": "Country", "birthday": "Birthday",
    "anniversary": "Anniversary", "notes": "Notes", "how_met": "How we met", "tags": "Tags", "groups": "Groups",
    **{k: n.label for k, n in profiles.NETWORKS.items()},
}
SYNONYMS = {
    "full_name": ["name", "fullname", "contact", "contactname", "displayname", "person", "contactperson"],
    "first_name": ["firstname", "givenname", "first", "forename"],
    "middle_name": ["middlename", "additionalname", "middle"],
    "last_name": ["lastname", "surname", "familyname", "last"],
    "nickname": ["nickname", "nick"],
    "company": ["company", "companyname", "organization", "organisation", "org", "employer", "organizationname"],
    "title": ["title", "jobtitle", "position", "role"],
    "department": ["department", "dept"],
    "email": ["email", "emailaddress", "mail", "workemail", "homeemail", "personalemail"],
    "phone": ["phone", "phonenumber", "mobile", "cell", "telephone", "tel", "mobilephone", "workphone", "homephone"],
    "street": ["address", "street", "streetaddress"],
    "city": ["city", "town"], "region": ["state", "region", "province"],
    "postcode": ["zip", "zipcode", "postcode", "postalcode"], "country": ["country"],
    "birthday": ["birthday", "dob", "dateofbirth", "bday", "birthdate"],
    "anniversary": ["anniversary"], "notes": ["notes", "note", "comments", "comment", "description"],
    "how_met": ["howwemet", "howmet", "met"], "tags": ["tags", "tag", "labels", "categories"],
    "groups": ["groups", "group", "lists", "list"], "website": ["website", "url", "homepage", "web", "site"],
}


@dataclass
class Parsed:
    format: str
    records: list
    columns: list = field(default_factory=list)
    mapping: dict = field(default_factory=dict)


def decode(data):
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            raise ImportFailed("That file isn't readable text") from None
    if b"\x00" in data:
        raise ImportFailed("That doesn't look like a contacts file (it's binary)")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def parse(name, data, fmt=None, mapping=None):
    if len(data) > MAX_BYTES:
        raise ImportFailed("Files can be up to 5 MB")
    text = decode(data)
    if fmt in (None, "", "auto"):
        fmt = "vcard" if re.search(r"^BEGIN:VCARD\s*$", text[:200000], re.I | re.M) else None
    if fmt == "vcard":
        recs = parse_vcards(text, max_cards=MAX_CONTACTS)
        result = Parsed("vcard", recs)
    else:
        result = _parse_csv(text, fmt, mapping)
    if len(result.records) > MAX_CONTACTS:
        raise ImportFailed(f"That file has more than {MAX_CONTACTS:,} contacts")
    if not result.records and result.format != "csv":
        raise ImportFailed("No contacts found in that file")
    return result


# ------------------------------------------------------------------ CSV

def _rows(text):
    first = text.split("\n", 1)[0]
    delim = max([",", ";", "\t"], key=first.count)
    try:
        rows = []
        for row in csv.reader(io.StringIO(text), delimiter=delim):
            if any(c.strip() for c in row):
                rows.append(row)
            if len(rows) > MAX_CONTACTS + 1:
                raise ImportFailed(f"That file has more than {MAX_CONTACTS:,} contacts")
        return rows
    except csv.Error as e:
        raise ImportFailed(f"Couldn't read that CSV file ({e})") from None


def _detect(cols):
    s = set(cols)
    if {"Connected On", "URL"} <= s or {"Connected On", "First Name"} <= s:
        return "linkedin"
    if any(re.match(r"^(E-mail|Phone|Website|Address|Organization) \d+ - ", c) for c in cols) or \
            {"Given Name", "Family Name"} <= s or "Group Membership" in s:
        return "google"
    if "E-mail Address" in s or {"Business Phone", "Job Title"} & s:
        return "outlook"
    return "csv"


def _parse_csv(text, fmt, mapping):
    m = re.search(r"^﻿?First Name,Last Name,.*Connected On.*$", text, re.M | re.I)
    if m and m.start() > 0 and fmt in (None, "linkedin"):
        text = text[m.start():]  # LinkedIn puts a "Notes:" preamble above the header
    rows = _rows(text)
    if len(rows) < 2:
        raise ImportFailed("No contacts found in that file")
    cols = [R.text(c, 100).lstrip("﻿") for c in rows[0]]
    fmt = fmt or _detect(cols)
    if fmt not in FORMATS or fmt == "vcard":
        raise ImportFailed("Unknown format")
    dicts = [dict(zip(cols, r)) for r in rows[1:]]
    if fmt == "csv":
        mapping = _mapping(cols, mapping)
        recs = [_generic(d, mapping) for d in dicts]
        return Parsed("csv", [r for r in recs if r], cols, mapping)
    fn = {"google": _google, "outlook": _outlook, "linkedin": _linkedin}[fmt]
    return Parsed(fmt, [r for r in map(fn, dicts) if r], cols)


def _key(col):
    return re.sub(r"\d+$", "", re.sub(r"[^a-z0-9]", "", col.lower()))


def guess_field(col):
    k = _key(col)
    for f, words in SYNONYMS.items():
        if k in words:
            return f
    net = profiles.network_key(col)
    return net if net and net != "website" else ("website" if net else "")


def _mapping(cols, given):
    out = {c: guess_field(c) for c in cols}
    for c, f in (given or {}).items():
        if c in out and f in FIELDS:
            out[c] = f
    return out


def _generic(d, mapping):
    rec = R.new()
    addr = {}
    for col, f in mapping.items():
        v = R.text(d.get(col, ""), R.NOTES_MAX)
        if not f or not v:
            continue
        if f == "full_name":
            full = v
            R.split_name(rec, full)
        elif f == "email":
            for part in re.split(r"[;,\s]+", v):
                R.add_email(rec, part, "")
        elif f == "phone":
            for part in re.split(r"\s*(?:;|:::)\s*", v):
                R.add_phone(rec, part, "")
        elif f in ("street", "city", "region", "postcode", "country"):
            addr[f] = v
        elif f in ("birthday", "anniversary"):
            d8 = R.parse_date(v)
            if d8 and (f == "birthday" or d8[0]):
                rec[f] = R.fmt_date(d8)
        elif f in ("tags", "groups"):
            R.add_tags(rec, re.split(r"\s*(?:[;,|]|:::)\s*", v), f)
        elif f in ("notes", "how_met"):
            rec[f] = v
        elif f in profiles.NETWORKS:
            if not R.add_profile(rec, f, v) and profiles.NETWORKS[f].kind == "url":
                R.add_url(rec, v, FIELDS[f])
        else:
            rec[f] = v[:R.TEXT_MAX]
    if addr:
        R.add_address(rec, "", **addr)
    return R.finish(rec)


def _first(d, *names):
    for n in names:
        v = R.text(d.get(n, ""))
        if v:
            return v
    return ""


def _google(d):
    rec = R.new()
    rec.update(first_name=_first(d, "First Name", "Given Name"), middle_name=_first(d, "Middle Name", "Additional Name"),
               last_name=_first(d, "Last Name", "Family Name"), prefix=_first(d, "Name Prefix")[:32],
               suffix=_first(d, "Name Suffix")[:32], nickname=_first(d, "Nickname"),
               company=_first(d, "Organization Name", "Organization 1 - Name"),
               title=_first(d, "Organization Title", "Organization 1 - Title"),
               department=_first(d, "Organization Department", "Organization 1 - Department"),
               notes=R.text(d.get("Notes", ""), R.NOTES_MAX))
    if not (rec["first_name"] or rec["last_name"]):
        R.split_name(rec, _first(d, "Name"))
    file_as = _first(d, "File As")
    if file_as and file_as != " ".join(x for x in (rec["first_name"], rec["middle_name"], rec["last_name"]) if x):
        rec["display_name"] = file_as
    R.add_tags(rec, re.split(r"\s*:::\s*", d.get("Tags", "") or ""))
    rec["birthday"] = R.fmt_date(R.parse_date(d.get("Birthday", "")))
    for lab in re.split(r"\s*:::\s*", d.get("Labels", "") or d.get("Group Membership", "")):
        lab = lab.strip()
        if lab == "* starred":
            rec["favorite"] = True
        elif lab:
            R.add_tags(rec, [lab], "groups")
    numbered = {}
    for col, v in d.items():
        m = re.match(r"^(E-mail|Phone|Address|Website|Relation|Event|Custom Field|IM) (\d+) - (.+)$", col or "")
        if m and v and v.strip():
            numbered.setdefault((m.group(1), int(m.group(2))), {})[m.group(3)] = v
    for (kind, _), f in sorted(numbered.items(), key=lambda x: (x[0][0], x[0][1])):
        lbl = f.get("Label") or f.get("Type") or ""
        val = f.get("Value", "")
        if kind == "E-mail":
            R.add_email(rec, val, lbl)
        elif kind == "Phone":
            R.add_phone(rec, val, lbl)
        elif kind == "Website":
            for url in re.split(r"\s*:::\s*", val):
                R.add_url(rec, url, lbl)
        elif kind == "Address":
            street = f.get("Street") or ("" if f.get("City") else f.get("Formatted", ""))
            R.add_address(rec, lbl, ", ".join(x for x in (f.get("PO Box", ""), street, f.get("Extended Address", "")) if x),
                          f.get("City", ""), f.get("Region", ""), f.get("Postal Code", ""), f.get("Country", ""))
        elif kind == "Event" and "anniversary" in lbl.lower():
            d8 = R.parse_date(val)
            if d8 and d8[0]:
                rec["anniversary"] = R.fmt_date(d8)
        elif kind == "Custom Field" and lbl.lower() == "how we met":
            rec["how_met"] = R.text(val, R.NOTES_MAX)
        elif kind in ("Custom Field", "IM"):
            net = profiles.network_key(f.get("Service") or f.get("Protocol") or lbl)
            if not (net and R.add_profile(rec, net, val)):
                R.add_custom(rec, lbl or kind, val)
        elif kind == "Relation":
            R.add_custom(rec, (lbl or "Relation").title(), val)
    return R.finish(rec)


def _outlook(d):
    rec = R.new()
    rec.update(first_name=_first(d, "First Name"), middle_name=_first(d, "Middle Name"), last_name=_first(d, "Last Name"),
               prefix=_first(d, "Title")[:32], suffix=_first(d, "Suffix")[:32], nickname=_first(d, "Nickname"),
               company=_first(d, "Company"), department=_first(d, "Department"), title=_first(d, "Job Title"),
               notes=R.text(d.get("Notes", ""), R.NOTES_MAX))
    rec["birthday"] = R.fmt_date(R.parse_date(d.get("Birthday", "")))
    ann = R.parse_date(d.get("Anniversary", ""))
    if ann and ann[0]:
        rec["anniversary"] = R.fmt_date(ann)
    for col in ("E-mail Address", "E-mail 2 Address", "E-mail 3 Address"):
        R.add_email(rec, d.get(col, ""))
    for col, v in d.items():
        if col and v and re.search(r"(Phone( \d)?|Fax|Pager)$", col):
            first = col.split()[0].lower()
            lbl = "fax" if "Fax" in col else {"business": "work", "company": "main", "primary": "main"}.get(first, first)
            R.add_phone(rec, v, lbl)
    for kind, lbl in (("Business", "work"), ("Home", "home"), ("Other", "other")):
        street = ", ".join(x for x in (d.get(f"{kind} Street", ""), d.get(f"{kind} Street 2", ""),
                                       d.get(f"{kind} Street 3", "")) if x and x.strip())
        R.add_address(rec, lbl, street, d.get(f"{kind} City", ""), d.get(f"{kind} State", ""),
                      d.get(f"{kind} Postal Code", ""), d.get(f"{kind} Country/Region", "") or d.get(f"{kind} Country", ""))
    for col in ("Web Page", "Personal Web Page", "Business Web Page"):
        if d.get(col):
            R.add_url(rec, d[col], "")
    R.add_tags(rec, re.split(r"\s*[;,]\s*", d.get("Categories", "") or ""))
    return R.finish(rec)


def _linkedin(d):
    rec = R.new()
    rec.update(first_name=_first(d, "First Name"), last_name=_first(d, "Last Name"), company=_first(d, "Company"),
               title=_first(d, "Position"))
    R.add_email(rec, d.get("Email Address", ""))
    if d.get("URL"):
        R.add_profile(rec, "linkedin", d["URL"])
    when = R.parse_date(d.get("Connected On", ""))
    if when:
        rec["how_met"] = f"Connected on LinkedIn {R.fmt_date(when)}"
    return R.finish(rec)
