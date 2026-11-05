"""Contacts domain logic shared by the API, importers and reminders.

- clean(data): strict validation of API input (raises ValueError with a readable message)
- apply(person, cleaned): write cleaned fields, tags and groups
- plan_import / commit_import: preview counts and the actual import, with dedupe
- duplicates(owner) / merge(keep, other, choices)
- export_vcf / export_csv, sanitize_photo
Every function takes an owner or an owner-scoped object; nothing crosses users.
"""

import copy
import csv
import datetime
import io
import re
import uuid

from django.db import IntegrityError, transaction
from django.db.models import Q

from users.models import ComptechUser

from . import profiles
from . import records as R
from .models import DismissedDuplicate, Interaction, Person, Relationship, Tag
from .vcard import to_vcard

SCALARS = ["prefix", "first_name", "middle_name", "last_name", "suffix", "nickname", "display_name",
           "company", "title", "department"]
LONG_TEXT = ["how_met", "notes"]
LISTS = {"emails": "value", "phones": "phone", "addresses": None, "links": "url", "custom_fields": "key"}
MERGE_FIELDS = SCALARS + LONG_TEXT + ["birthday", "anniversary", "keep_in_touch_days", "user", "avatar"]
MATCH_NETWORKS = ("github", "linkedin", "gitlab")


# ------------------------------------------------------------------ validation (API)

def _birthday(v):
    v = (v or "").strip()
    if not v:
        return None, None, None
    m = re.fullmatch(r"(\d{4}|-)-(\d{2})-(\d{2})", v)
    if not m:
        raise ValueError("Birthday must look like 1990-05-17, or --05-17 without a year")
    y = None if m.group(1) == "-" else int(m.group(1))
    mo, d = int(m.group(2)), int(m.group(3))
    try:
        datetime.date(y or 2000, mo, d)
    except ValueError:
        raise ValueError("That birthday isn't a real date") from None
    return y, mo, d


def clean(data):
    """Validate and normalise PersonIn fields that are present in `data`."""
    out = {}
    for k in SCALARS:
        if k in data:
            out[k] = R.text(data[k], 32 if k in ("prefix", "suffix") else R.TEXT_MAX)
    for k in LONG_TEXT:
        if k in data:
            out[k] = R.text(data[k], R.NOTES_MAX)
    if "emails" in data:
        out["emails"] = []
        for e in data["emails"] or []:
            if not (e.get("value") or "").strip():
                continue
            v = R.clean_email(e["value"])
            if not v:
                raise ValueError(f"“{e['value'][:60]}” isn't a valid email address")
            out["emails"].append({"label": R.label(e.get("label")), "value": v})
    if "phones" in data:
        out["phones"] = []
        for p in data["phones"] or []:
            if not (p.get("value") or "").strip():
                continue
            v = R.clean_phone(p["value"])
            if not v:
                raise ValueError(f"“{p['value'][:60]}” isn't a valid phone number")
            out["phones"].append({"label": R.label(p.get("label")), "value": v})
    if "addresses" in data:
        rec = R.new()
        for a in data["addresses"] or []:
            R.add_address(rec, a.get("label", ""), a.get("street", ""), a.get("city", ""), a.get("region", ""),
                          a.get("postcode", ""), a.get("country", ""))
        out["addresses"] = rec["addresses"]
    if "profiles" in data:
        out["profiles"] = {}
        for net, raw in (data["profiles"] or {}).items():
            if net not in profiles.NETWORKS:
                raise ValueError(f"Unknown profile type: {net[:40]}")
            if (raw or "").strip():
                out["profiles"][net] = profiles.normalize(net, raw)
    if "links" in data:
        out["links"] = []
        for link in data["links"] or []:
            if (link.get("url") or "").strip():
                out["links"].append({"label": R.text(link.get("label"), 40) or "Link", "url": profiles.clean_url(link["url"])})
    if "custom_fields" in data:
        out["custom_fields"] = [{"key": R.text(c.get("key"), 64), "value": R.text(c.get("value"), 1000)}
                                for c in data["custom_fields"] or [] if (c.get("key") or "").strip()]
    for k in ("emails", "phones", "addresses", "links", "custom_fields"):
        if len(out.get(k, ())) > R.LIST_MAX:
            raise ValueError(f"At most {R.LIST_MAX} {k.replace('_', ' ')} per contact")
    if "birthday" in data:
        out["birthday_year"], out["birthday_month"], out["birthday_day"] = _birthday(data["birthday"])
    if "anniversary" in data:
        out["anniversary"] = data["anniversary"]
    for k in ("favorite", "keep_in_touch_days"):
        if k in data:
            out[k] = data[k]
    if "tags" in data:
        out["tags"] = _names(data["tags"])
    if "groups" in data:
        out["groups"] = _names(data["groups"])
    if "username" in data:
        name = (data["username"] or "").strip()
        out["user"] = None
        if name:
            out["user"] = ComptechUser.objects.filter(username=name).first()
            if out["user"] is None:
                raise ValueError("No account with that username")
    return out


def _names(values):
    seen, out = set(), []
    for v in values or []:
        v = R.text(v, 64)
        if v and v.lower() not in seen:
            seen.add(v.lower())
            out.append(v)
    return out[:50]


def apply(person, cleaned, *, source=None):
    tags, groups = cleaned.pop("tags", None), cleaned.pop("groups", None)
    for k, v in cleaned.items():
        setattr(person, k, v)
    if source and source not in person.sources:
        person.sources = [*person.sources, source]
    person.save()
    if tags is not None:
        set_tags(person, Tag.TAG, tags)
    if groups is not None:
        set_tags(person, Tag.GROUP, groups)
    return person


def _tag_objs(owner, kind, names, cache=None):
    cache = cache if cache is not None else {}
    want = {n.lower(): n for n in names}
    missing = [k for k in want if (kind, k) not in cache]
    if missing:
        for t in Tag.objects.filter(owner=owner, kind=kind):
            cache[(kind, t.name.lower())] = t
        for k in missing:
            if (kind, k) not in cache:
                cache[(kind, k)] = Tag.objects.create(owner=owner, kind=kind, name=want[k])
    return [cache[(kind, k)] for k in want]


def set_tags(person, kind, names):
    keep = person.tags.exclude(kind=kind)
    person.tags.set([*keep, *_tag_objs(person.owner, kind, names)])


def tag_names(person):
    tags = list(person.tags.all())
    return ([t.name for t in tags if t.kind == Tag.TAG], [t.name for t in tags if t.kind == Tag.GROUP])


def has_identity(person):
    return any(getattr(person, k) for k in ("first_name", "last_name", "display_name", "nickname", "company")) \
        or person.emails or person.phones


# ------------------------------------------------------------------ matching / merging records

def match_keys(emails, phones, profs):
    keys = {"e:" + e["value"].lower() for e in emails}
    keys |= {"p:" + k for k in (R.phone_key(p["value"]) for p in phones) if k}
    keys |= {f"{n}:{profs[n].lower()}" for n in MATCH_NETWORKS if profs.get(n)}
    return keys


def _union(a, b, key):
    out = [dict(x) for x in a]
    if key is None:
        seen = {tuple(sorted(x.items())) for x in a}
        out += [dict(x) for x in b if tuple(sorted(x.items())) not in seen]
    else:
        if key == "phone":  # same number written differently counts as the same
            seen = {R.phone_key(x["value"]) or x["value"] for x in a}
            out += [dict(x) for x in b if (R.phone_key(x["value"]) or x["value"]) not in seen]
        else:
            seen = {str(x.get(key, "")).lower() for x in a}
            out += [dict(x) for x in b if str(x.get(key, "")).lower() not in seen]
    return out[:R.LIST_MAX]


def merge_record(into, rec):
    """Fold one import record into another (same file)."""
    for k, v in rec.items():
        if k in LISTS:
            into[k] = _union(into.get(k, []), v, LISTS[k])
        elif k == "profiles":
            into[k] = {**v, **into.get(k, {})}
        elif k in ("tags", "groups"):
            into[k] = into.get(k, []) + [x for x in v if x not in into.get(k, [])]
        elif k == "related":
            into[k] = into.get(k, []) + v
        elif not into.get(k):
            into[k] = v


def fill_from_record(person, rec, tagset=frozenset()):
    """Fill blanks and union multi-values from an import record. Returns (changed, tags_to_add, groups_to_add)."""
    changed = False
    for k in SCALARS + LONG_TEXT:
        v = rec.get(k)
        if not v:
            continue
        cur = getattr(person, k)
        if not cur:
            setattr(person, k, v[:R.TEXT_MAX] if k in SCALARS else v)
            changed = True
        elif k in LONG_TEXT and v not in cur:
            setattr(person, k, f"{cur}\n\n{v}"[:R.NOTES_MAX])
            changed = True
    for k, key in LISTS.items():
        merged = _union(getattr(person, k), rec.get(k, []), key)
        if len(merged) != len(getattr(person, k)):
            setattr(person, k, merged)
            changed = True
    profs = {**rec.get("profiles", {}), **person.profiles}
    if profs != person.profiles:
        person.profiles = profs
        changed = True
    b = rec.get("birthday")
    if b and not person.birthday_month:
        person.birthday_year, person.birthday_month, person.birthday_day = _birthday(b)
        changed = True
    if rec.get("anniversary") and not person.anniversary:
        person.anniversary = datetime.date.fromisoformat(rec["anniversary"])
        changed = True
    if rec.get("favorite") and not person.favorite:
        person.favorite = changed = True
    if rec.get("keep_in_touch_days") and not person.keep_in_touch_days:
        person.keep_in_touch_days = rec["keep_in_touch_days"]
        changed = True
    if rec.get("photo") and not person.avatar:
        photo = sanitize_photo(rec["photo"])
        if photo:
            person.avatar = photo
            changed = True
    tags = [t for t in rec.get("tags", []) if (Tag.TAG, t.lower()) not in tagset]
    groups = [g for g in rec.get("groups", []) if (Tag.GROUP, g.lower()) not in tagset]
    return changed or bool(tags or groups), tags, groups


def _record_name(rec):
    full = " ".join(x for x in (rec.get("first_name"), rec.get("last_name")) if x)
    return rec.get("display_name") or full or rec.get("nickname") or rec.get("company") or \
        (rec["emails"][0]["value"] if rec.get("emails") else "") or "Unnamed"


def _record_detail(rec):
    bits = [rec.get("title"), rec.get("company")]
    detail = " · ".join(x for x in bits if x)
    return detail or (rec["emails"][0]["value"] if rec.get("emails") else "") or \
        (rec["phones"][0]["value"] if rec.get("phones") else "")


# ------------------------------------------------------------------ import

def plan_import(owner, parsed, mode="merge"):
    """Group the file's records into entries and decide new / update / duplicate for each, without writing."""
    people = {p.id: p for p in Person.objects.filter(owner=owner).defer("avatar", "search")}
    index = {}
    for p in people.values():
        for k in match_keys(p.emails, p.phones, p.profiles):
            index.setdefault(k, p.id)
    tagsets = {}
    for pid, kind, name in Person.tags.through.objects.filter(person__owner=owner).values_list(
            "person_id", "tag__kind", "tag__name"):
        tagsets.setdefault(pid, set()).add((kind, name.lower()))

    entries, file_index, in_file = [], {}, []
    for rec in parsed.records:
        keys = match_keys(rec["emails"], rec["phones"], rec["profiles"])
        j = next((file_index[k] for k in keys if k in file_index), None)
        if j is not None:
            merge_record(entries[j]["rec"], rec)
            for k in keys:
                file_index.setdefault(k, j)
            in_file.append(rec)
            continue
        pid = next((index[k] for k in keys if k in index), None)
        entries.append({"rec": rec, "pid": pid})
        for k in keys:
            file_index[k] = len(entries) - 1

    counts = {"new": 0, "updated": 0, "duplicates": len(in_file)}
    for e in entries:
        if e["pid"] is None:
            e["status"] = "new"
        elif mode == "skip":
            e["status"] = "duplicate"
        else:
            p = copy.copy(people[e["pid"]])
            for k in list(LISTS) + ["profiles"]:
                setattr(p, k, copy.deepcopy(getattr(p, k)))
            changed, _, _ = fill_from_record(p, {k: v for k, v in e["rec"].items() if k != "photo"},
                                             tagsets.get(e["pid"], set()))
            e["status"] = "update" if changed else "duplicate"
        counts[{"new": "new", "update": "updated", "duplicate": "duplicates"}[e["status"]]] += 1
    sample = [{"name": _record_name(e["rec"]), "detail": _record_detail(e["rec"]), "status": e["status"],
               "match": people[e["pid"]].name if e["pid"] else ""} for e in entries[:200]]
    sample += [{"name": _record_name(r), "detail": _record_detail(r), "status": "duplicate", "match": "earlier in this file"}
               for r in in_file[:max(0, 200 - len(sample))]]
    return {"entries": entries, "people": people, "tagsets": tagsets, "total": len(parsed.records),
            "sample": sample, **counts}


def _new_person(owner, rec, source):
    p = Person(owner=owner, sources=[source])
    for k in SCALARS + LONG_TEXT:
        if rec.get(k):
            setattr(p, k, rec[k])
    for k in list(LISTS) + ["profiles"]:
        setattr(p, k, rec.get(k) or ({} if k == "profiles" else []))
    if rec.get("birthday"):
        p.birthday_year, p.birthday_month, p.birthday_day = _birthday(rec["birthday"])
    if rec.get("anniversary"):
        p.anniversary = datetime.date.fromisoformat(rec["anniversary"])
    p.favorite = bool(rec.get("favorite"))
    p.keep_in_touch_days = rec.get("keep_in_touch_days")
    if rec.get("photo"):
        p.avatar = sanitize_photo(rec["photo"])
    p.refresh_derived()
    return p


@transaction.atomic
def commit_import(owner, parsed, mode="merge"):
    plan = plan_import(owner, parsed, mode)
    source = parsed.format
    cache, through = {}, Person.tags.through
    links, uid_map, created, updated = [], {}, [], 0
    for e in plan["entries"]:
        rec = e["rec"]
        if e["status"] == "new":
            p = _new_person(owner, rec, source)
            created.append(p)
            tags, groups = rec.get("tags", []), rec.get("groups", [])
        elif e["status"] == "update":
            p = plan["people"][e["pid"]]
            _, tags, groups = fill_from_record(p, rec, plan["tagsets"].get(p.id, set()))
            if source not in p.sources:
                p.sources = [*p.sources, source]
            p.save()
            updated += 1
        else:
            p = plan["people"][e["pid"]]
            tags = groups = []
        if rec.get("uid"):
            uid_map[rec["uid"].lower()] = p.id
        for t in _tag_objs(owner, Tag.TAG, tags, cache) + _tag_objs(owner, Tag.GROUP, groups, cache):
            links.append(through(person_id=p.id, tag_id=t.id))
        for kind, ref in rec.get("related", []):
            e.setdefault("rel", []).append((kind, ref))
        e["person_id"] = p.id
    Person.objects.bulk_create(created, batch_size=500)
    through.objects.bulk_create(links, batch_size=1000, ignore_conflicts=True)
    _link_related(owner, plan["entries"], uid_map)
    return {"format": source, "total": plan["total"], "created": len(created), "updated": updated,
            "duplicates": plan["duplicates"]}


def _link_related(owner, entries, uid_map):
    """vCard RELATED;TYPE=kind:urn:uuid:<id> -> relationships, resolved within the file or the owner's contacts."""
    for e in entries:
        for kind, ref in e.get("rel", []):
            if kind not in Relationship.INVERSE:
                continue
            ref = ref.lower()
            other = uid_map.get(ref)
            if other is None:
                m = re.fullmatch(r"urn:uuid:([0-9a-f-]{36})", ref)
                if m and Person.objects.filter(owner=owner, id=m.group(1)).exists():
                    other = uuid.UUID(m.group(1))
            if other and other != e["person_id"]:
                relate(Person(id=e["person_id"]), Person(id=other), kind)


# ------------------------------------------------------------------ relationships

def relate(person, other, kind):
    inverse = Relationship.INVERSE[kind]
    try:
        with transaction.atomic():
            fwd, _ = Relationship.objects.get_or_create(person_id=person.id, other_id=other.id, kind=kind)
            Relationship.objects.get_or_create(person_id=other.id, other_id=person.id, kind=inverse)
    except IntegrityError:
        fwd = Relationship.objects.get(person_id=person.id, other_id=other.id, kind=kind)
    return fwd


def unrelate(rel):
    Relationship.objects.filter(
        Q(id=rel.id) | Q(person_id=rel.other_id, other_id=rel.person_id, kind=Relationship.INVERSE.get(rel.kind, rel.kind))
    ).delete()


# ------------------------------------------------------------------ duplicates & merge

REASONS = {"e": "Same email", "p": "Same phone", "github": "Same GitHub", "linkedin": "Same LinkedIn",
           "gitlab": "Same GitLab", "n": "Same name"}


def duplicates(owner, limit=100):
    groups = {}
    people = {}
    for p in Person.objects.filter(owner=owner).only("id", "first_name", "last_name", "display_name", "emails", "phones",
                                                     "profiles"):
        people[p.id] = p
        keys = match_keys(p.emails, p.phones, p.profiles)
        if p.first_name and p.last_name:
            keys.add(f"n:{p.first_name.lower()} {p.last_name.lower()}")
        for k in keys:
            groups.setdefault(k, []).append(p.id)
    dismissed = set(DismissedDuplicate.objects.filter(owner=owner).values_list("a_id", "b_id"))
    pairs = {}
    for k, ids in groups.items():
        if len(ids) < 2 or len(ids) > 10:
            continue
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                pair = tuple(sorted((a, b), key=str))
                if pair in dismissed:
                    continue
                reason = REASONS[k.split(":", 1)[0]]
                pairs.setdefault(pair, [])
                if reason not in pairs[pair]:
                    pairs[pair].append(reason)
    ranked = sorted(pairs.items(), key=lambda x: (-len(x[1]), people[x[0][0]].name.lower()))[:limit]
    return [(a, b, reasons) for (a, b), reasons in ranked]


def dismiss(owner, a, b):
    a, b = sorted((a, b), key=lambda p: str(p.id))
    DismissedDuplicate.objects.get_or_create(owner=owner, a=a, b=b)


@transaction.atomic
def merge(keep, other, choices):
    """Merge `other` into `keep`. choices maps a field (see MERGE_FIELDS, or 'profile:<network>') to 'keep'|'other';
    unlisted scalars keep `keep`'s value unless it's empty. Multi-values, tags and history are combined."""
    for f in MERGE_FIELDS:
        pick_other = choices.get(f) == "other"
        if f == "birthday":
            if pick_other or not keep.birthday_month:
                if other.birthday_month or pick_other:
                    keep.birthday_year, keep.birthday_month, keep.birthday_day = \
                        other.birthday_year, other.birthday_month, other.birthday_day
            continue
        mine, theirs = getattr(keep, f), getattr(other, f)
        if (pick_other or not mine) and (theirs or pick_other):
            setattr(keep, f, theirs)
    for k, key in LISTS.items():
        setattr(keep, k, _union(getattr(keep, k), getattr(other, k), key))
    profs = {**other.profiles, **keep.profiles}
    for net, h in other.profiles.items():
        if choices.get(f"profile:{net}") == "other":
            profs[net] = h
    keep.profiles = profs
    keep.favorite = keep.favorite or other.favorite
    keep.sources = keep.sources + [s for s in other.sources if s not in keep.sources]
    keep.save()
    keep.tags.add(*other.tags.all())
    Interaction.objects.filter(person=other).update(person=keep)
    for r in Relationship.objects.filter(person=other).exclude(other=keep):
        relate(keep, r.other, r.kind)
    other.delete()
    keep.refresh_last_contacted()
    return keep


# ------------------------------------------------------------------ export

def _people_for_export(owner, ids=None):
    qs = Person.objects.filter(owner=owner).prefetch_related("tags")
    if ids:
        qs = qs.filter(id__in=ids)
    return list(qs)


def export_vcf(owner, ids=None):
    people = _people_for_export(owner, ids)
    rels = {}
    for pid, oid, kind in Relationship.objects.filter(person__in=people).values_list("person_id", "other_id", "kind"):
        rels.setdefault(pid, []).append((kind, oid))
    out = []
    for p in people:
        tags, groups = tag_names(p)
        out.append(to_vcard(p, tags, groups, rels.get(p.id, [])))
    return "".join(out)


def _safe_cell(v):
    v = "" if v is None else str(v)
    if v[:1] in ("=", "@", "\t", "\r") or (v[:1] in ("+", "-") and not re.fullmatch(r"[+-][\d\s().-]*", v)):
        return "'" + v
    return v


def export_csv(owner, ids=None):
    """Google Contacts CSV layout (so Google, Outlook and this importer read it back), plus a Tags column."""
    people = _people_for_export(owner, ids)
    rows = []
    n = {"E-mail": 1, "Phone": 1, "Address": 0, "Website": 0, "Custom Field": 0}
    for p in people:
        tags, groups = tag_names(p)
        sites, custom = [], [(c["key"], c["value"]) for c in p.custom_fields]
        for link in p.profile_links():
            if link["url"]:
                sites.append((link["label"], link["url"]))
            else:
                custom.append((link["label"], link["handle"]))
        sites += [(x["label"], x["url"]) for x in p.links]
        if p.how_met:
            custom.append(("How we met", p.how_met))
        labels = ["* myContacts"] + (["* starred"] if p.favorite else []) + groups
        rows.append((p, tags, labels, sites, custom))
        n["E-mail"] = max(n["E-mail"], len(p.emails))
        n["Phone"] = max(n["Phone"], len(p.phones))
        n["Address"] = max(n["Address"], len(p.addresses))
        n["Website"] = max(n["Website"], len(sites))
        n["Custom Field"] = max(n["Custom Field"], len(custom))
    head = ["First Name", "Middle Name", "Last Name", "Name Prefix", "Name Suffix", "Nickname", "File As", "Birthday",
            "Notes", "Labels", "Tags", "Organization Name", "Organization Title", "Organization Department",
            "Event 1 - Label", "Event 1 - Value"]
    for kind in ("E-mail", "Phone", "Website", "Custom Field"):
        for i in range(1, n[kind] + 1):
            head += [f"{kind} {i} - Label", f"{kind} {i} - Value"]
    for i in range(1, n["Address"] + 1):
        head += [f"Address {i} - {x}" for x in ("Label", "Street", "City", "Region", "Postal Code", "Country")]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(head)
    for p, tags, labels, sites, custom in rows:
        row = [p.first_name, p.middle_name, p.last_name, p.prefix, p.suffix, p.nickname,
               p.display_name, p.birthday, p.notes, " ::: ".join(labels), " ::: ".join(tags), p.company, p.title,
               p.department, "Anniversary" if p.anniversary else "", p.anniversary.isoformat() if p.anniversary else ""]
        for kind, items in (("E-mail", [(e["label"].title(), e["value"]) for e in p.emails]),
                            ("Phone", [(x["label"].title(), x["value"]) for x in p.phones]),
                            ("Website", sites), ("Custom Field", custom)):
            items = items + [("", "")] * (n[kind] - len(items))
            for lb, v in items:
                row += [lb, v]
        addrs = p.addresses + [{}] * (n["Address"] - len(p.addresses))
        for a in addrs:
            row += [a.get("label", "").title(), a.get("street", ""), a.get("city", ""), a.get("region", ""),
                    a.get("postcode", ""), a.get("country", "")]
        w.writerow([_safe_cell(c) for c in row])
    return buf.getvalue()


# ------------------------------------------------------------------ photos

def sanitize_photo(data):
    """Re-encode an uploaded/imported image as a 256px square JPEG (drops metadata and anything odd)."""
    if not data or len(data) > 2_000_000:
        return None
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(data), formats=["JPEG", "PNG", "GIF", "WEBP"]) as im:
            if im.width * im.height > 40_000_000:
                return None
            im.draft("RGB", (512, 512))
            im = ImageOps.exif_transpose(im).convert("RGB")
            im = ImageOps.fit(im, (256, 256))
            out = io.BytesIO()
            im.save(out, "JPEG", quality=85, optimize=True)
            return out.getvalue()
    except Exception:  # any decoder error: just no photo
        return None
