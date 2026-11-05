"""/api/v2/contacts/: a private personal CRM (people, interactions, relationships, import/export, merge)."""

import datetime
import json
import uuid
from typing import Literal, Optional

from django.db.models import BooleanField, Count, ExpressionWrapper, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, File, Form, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from . import importers, profiles
from . import service as svc
from .models import ContactSettings, Interaction, Person, Relationship, Tag

router = Router(tags=["contacts"])

GUIDE_INTRO = """A private personal CRM: each user's contacts are visible only to them.

- **Person** (a contact, separate from site accounts; `username` optionally links one). Names, company/title,
  labelled multi-values (`emails`, `phones`, `addresses`), `links`, `custom_fields` (key/value), `tags`
  and `groups` (both plain name lists), `favorite`, `how_met`, `notes` (plain text).
- **Birthday** is `YYYY-MM-DD`, or `--MM-DD` when the year is unknown. `anniversary` is a full date.
- **Profiles** are `{network: handle}`. Send a handle, `@handle` or a profile URL; it's stored as the canonical
  handle and `profile_links` gives the URL we build ourselves (website/blog store a full http(s) URL).
  `GET meta` lists the networks: GitHub, GitLab, LinkedIn (`in/slug`), Stack Overflow, Hacker News, X,
  Mastodon (`user@instance`), Bluesky, dev.to, Kaggle, LeetCode, ORCID, Google Scholar, Discord, Telegram,
  Signal, Matrix (`@user:server`) and more. Invalid values return 400.
- **Interactions** (call, meeting, message, email, note) have a date and summary; the latest date is the
  person's `last_contacted`.
- **Keep in touch:** set `keep_in_touch_days`; `next_due` = last contact (or the day it was turned on) + N days,
  and `overdue` is true once that date arrives. Daily reminders cover overdue people and birthdays.
- **Relationships** are stored in both directions: `POST {id}/relationships {other_id, kind: "manager"}` means
  *other is this person's manager*, and the other person gets the inverse (`report`).
- **Import** (multipart `file`, max 5 MB / 5,000 contacts): vCard 2.1/3.0/4.0, Google Contacts CSV, Outlook CSV,
  LinkedIn `Connections.csv`, or any CSV with a `mapping` (JSON `{column: field}`). The format is detected.
  `import/preview` returns new/updated/duplicate counts without writing; `import/commit` imports the same file.
  Matches on email, phone, GitHub, GitLab or LinkedIn: `mode=merge` fills in blanks, `mode=skip` leaves them.
- **Export:** `export?format=vcf` (vCard 4.0) or `format=csv` (Google Contacts layout), all or `ids=a,b`.
- **Duplicates:** `GET duplicates` suggests pairs; `POST merge {keep_id, other_id, fields}` where `fields` maps a
  field name (or `profile:<network>`) to `keep` or `other`. Lists, tags, interactions and relationships combine."""


def _bad(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HttpError(400, str(e)) from None


# ================================================================ schemas

class LabeledValue(Schema):
    label: str = Field("", max_length=40)
    value: str = Field(..., max_length=254)


class Address(Schema):
    label: str = Field("", max_length=40)
    street: str = Field("", max_length=300)
    city: str = Field("", max_length=200)
    region: str = Field("", max_length=200)
    postcode: str = Field("", max_length=32)
    country: str = Field("", max_length=200)


class Link(Schema):
    label: str = Field("", max_length=40)
    url: str = Field(..., max_length=500)


class CustomField(Schema):
    key: str = Field(..., max_length=64)
    value: str = Field("", max_length=1000)


class ProfileLink(Schema):
    network: str
    label: str
    handle: str
    url: Optional[str]


class UserBrief(Schema):
    username: str
    name: str

    @staticmethod
    def resolve_name(o):
        return o.get_full_name() or o.username


class PersonBrief(Schema):
    id: uuid.UUID
    name: str
    first_name: str
    last_name: str
    company: str
    title: str
    favorite: bool
    email: str
    phone: str
    has_avatar: bool
    profile_links: list[ProfileLink]
    tags: list[str]
    groups: list[str]
    birthday: str
    last_contacted: Optional[datetime.date]
    keep_in_touch_days: Optional[int]
    next_due: Optional[datetime.date]
    overdue: bool
    created_on: datetime.datetime

    @staticmethod
    def resolve_email(o): return o.emails[0]["value"] if o.emails else ""
    @staticmethod
    def resolve_phone(o): return o.phones[0]["value"] if o.phones else ""
    @staticmethod
    def resolve_has_avatar(o): return bool(o.__dict__["has_avatar"] if "has_avatar" in o.__dict__ else o.avatar)
    @staticmethod
    def resolve_profile_links(o): return o.profile_links()
    @staticmethod
    def resolve_tags(o): return [t.name for t in o.tags.all() if t.kind == Tag.TAG]
    @staticmethod
    def resolve_groups(o): return [t.name for t in o.tags.all() if t.kind == Tag.GROUP]
    @staticmethod
    def resolve_overdue(o): return bool(o.next_due and o.next_due <= timezone.localdate())


class PersonOut(PersonBrief):
    prefix: str
    middle_name: str
    suffix: str
    nickname: str
    display_name: str
    department: str
    emails: list[LabeledValue]
    phones: list[LabeledValue]
    addresses: list[Address]
    profiles: dict[str, str]
    links: list[Link]
    custom_fields: list[CustomField]
    anniversary: Optional[datetime.date]
    how_met: str
    notes: str
    sources: list[str]
    linked_user: Optional[UserBrief]
    updated_on: datetime.datetime

    @staticmethod
    def resolve_linked_user(o): return o.user


class InteractionOut(Schema):
    id: uuid.UUID
    person_id: uuid.UUID
    kind: str
    date: datetime.date
    summary: str
    notes: str
    created_on: datetime.datetime


class RelationshipOut(Schema):
    id: int
    kind: str
    other_id: uuid.UUID
    other_name: str

    @staticmethod
    def resolve_other_name(o): return o.other.name


class PersonDetail(PersonOut):
    interactions: list[InteractionOut]
    relationships: list[RelationshipOut]

    @staticmethod
    def resolve_interactions(o): return list(o.interactions.all()[:200])
    @staticmethod
    def resolve_relationships(o): return list(o.relationships.select_related("other"))


class PersonIn(Schema):
    prefix: str = Field("", max_length=32)
    first_name: str = Field("", max_length=128)
    middle_name: str = Field("", max_length=128)
    last_name: str = Field("", max_length=128)
    suffix: str = Field("", max_length=32)
    nickname: str = Field("", max_length=128)
    display_name: str = Field("", max_length=200)
    company: str = Field("", max_length=200)
    title: str = Field("", max_length=200)
    department: str = Field("", max_length=200)
    emails: list[LabeledValue] = []
    phones: list[LabeledValue] = []
    addresses: list[Address] = []
    profiles: dict[str, str] = {}
    links: list[Link] = []
    custom_fields: list[CustomField] = []
    birthday: str = Field("", max_length=10, description="YYYY-MM-DD, or --MM-DD without a year")
    anniversary: Optional[datetime.date] = None
    how_met: str = Field("", max_length=20000)
    notes: str = Field("", max_length=20000)
    tags: list[str] = []
    groups: list[str] = []
    favorite: bool = False
    keep_in_touch_days: Optional[int] = Field(None, ge=1, le=3650)
    username: str = Field("", max_length=150, description="Link to this site account (blank to unlink)")


class PersonPage(Schema):
    items: list[PersonBrief]
    total: int


class InteractionIn(Schema):
    kind: Literal["call", "meeting", "message", "email", "note"] = "note"
    date: Optional[datetime.date] = None  # default: today
    summary: str = Field(..., min_length=1, max_length=500)
    notes: str = Field("", max_length=20000)


class InteractionPatch(Schema):
    kind: Optional[Literal["call", "meeting", "message", "email", "note"]] = None
    date: Optional[datetime.date] = None
    summary: Optional[str] = Field(None, min_length=1, max_length=500)
    notes: Optional[str] = Field(None, max_length=20000)


class RelationshipIn(Schema):
    other_id: uuid.UUID
    kind: str = Field(..., max_length=16)


class TagOut(Schema):
    id: int
    kind: str
    name: str
    count: int = 0


class TagPatch(Schema):
    name: str = Field(..., min_length=1, max_length=64)


class PreviewRow(Schema):
    name: str
    detail: str
    status: Literal["new", "update", "duplicate"]
    match: str


class PreviewOut(Schema):
    format: str
    format_label: str
    total: int
    new: int
    updated: int
    duplicates: int
    columns: list[str]
    mapping: dict[str, str]
    fields: dict[str, str]
    sample: list[PreviewRow]


class CommitOut(Schema):
    format: str
    total: int
    created: int
    updated: int
    duplicates: int


class DuplicateOut(Schema):
    a: PersonOut
    b: PersonOut
    reasons: list[str]


class MergeIn(Schema):
    keep_id: uuid.UUID
    other_id: uuid.UUID
    fields: dict[str, Literal["keep", "other"]] = {}


class IdsIn(Schema):
    ids: list[uuid.UUID]


class DismissIn(Schema):
    a_id: uuid.UUID
    b_id: uuid.UUID


class UpcomingBirthday(Schema):
    id: uuid.UUID
    name: str
    date: datetime.date
    days: int
    age: Optional[int]


class OverdueOut(Schema):
    id: uuid.UUID
    name: str
    next_due: datetime.date
    days_overdue: int


class StatsOut(Schema):
    total: int
    favorites: int
    overdue: int
    keep_in_touch: int
    recent: int
    birthdays_this_month: int
    upcoming_birthdays: list[UpcomingBirthday]
    overdue_people: list[OverdueOut]
    tags: list[TagOut]
    sources: dict[str, int]


class SettingsOut(Schema):
    birthday_reminders: Literal["off", "day_before", "on_day"]
    keep_in_touch_reminders: bool


class SettingsPatch(Schema):
    birthday_reminders: Optional[Literal["off", "day_before", "on_day"]] = None
    keep_in_touch_reminders: Optional[bool] = None


# ================================================================ helpers

def _people(user):
    return Person.objects.filter(owner=user)


def _person(user, person_id):
    return get_object_or_404(_people(user).select_related("user").prefetch_related("tags"), id=person_id)


def _brief_qs(user):
    return (_people(user).defer("avatar", "search", "notes", "how_met")
            .annotate(has_avatar=ExpressionWrapper(Q(avatar__isnull=False), output_field=BooleanField()))
            .prefetch_related("tags"))


def _save(person, payload, partial):
    data = payload.dict(exclude_unset=partial)
    data = {**data, **{k: [x if isinstance(x, dict) else x.dict() for x in data[k]]
                       for k in ("emails", "phones", "addresses", "links", "custom_fields") if k in data}}
    cleaned = _bad(svc.clean, data)
    if not partial or any(k in cleaned for k in ("first_name", "last_name", "display_name", "nickname", "company", "emails", "phones")):
        probe = Person(**{k: cleaned.get(k, getattr(person, k)) for k in
                          ("first_name", "last_name", "display_name", "nickname", "company", "emails", "phones")})
        if not svc.has_identity(probe):
            raise HttpError(400, "Give the contact a name, company, email or phone")
    return svc.apply(person, cleaned, source=None if partial else "manual")


def meta():
    return {
        "networks": [{"key": k, "label": n.label, "group": n.group, "kind": n.kind} for k, n in profiles.NETWORKS.items()],
        "relationship_kinds": list(Relationship.INVERSE),
        "interaction_kinds": [k for k, _ in Interaction.KINDS],
        "import_formats": importers.FORMATS,
        "import_fields": importers.FIELDS,
        "max_upload_bytes": importers.MAX_BYTES,
    }


# ================================================================ people

@router.get("/meta", summary="Profile networks, relationship and interaction kinds, import fields")
def get_meta(request):
    return meta()


class BirthdayOut(Schema):
    id: uuid.UUID
    name: str
    date: datetime.date
    age: Optional[int]


@router.get("/birthdays", response=list[BirthdayOut], summary="Birthdays falling in [start, end] (for the calendar), with age when the year is known")
def birthdays(request, start: datetime.date, end: datetime.date):
    if end < start or (end - start).days > 400:
        raise HttpError(400, "Pick a range of up to 400 days")
    out = []
    for p in _people(request.user).filter(birthday_month__isnull=False, birthday_day__isnull=False):
        day = start
        while day <= end:
            nxt = p.next_birthday(day)  # Feb 29 falls on Feb 28 in other years
            if nxt is None or nxt > end:
                break
            out.append({"id": p.id, "name": p.name, "date": nxt,
                        "age": nxt.year - p.birthday_year if p.birthday_year else None})
            day = nxt + datetime.timedelta(days=1)
    return sorted(out, key=lambda b: (b["date"], b["name"]))


@router.get("/stats", response=StatsOut, summary="Counts, upcoming birthdays, overdue keep-in-touch, tags")
def stats(request):
    today = timezone.localdate()
    qs = _people(request.user)
    upcoming = []
    for p in qs.filter(birthday_month__isnull=False).only(
            "id", "first_name", "middle_name", "last_name", "display_name", "nickname", "company", "emails",
            "birthday_year", "birthday_month", "birthday_day"):
        nb = p.next_birthday(today)
        if nb and (nb - today).days <= 30:
            upcoming.append({"id": p.id, "name": p.name, "date": nb, "days": (nb - today).days,
                             "age": nb.year - p.birthday_year if p.birthday_year else None})
    upcoming.sort(key=lambda x: x["days"])
    overdue = qs.filter(next_due__lte=today).order_by("next_due")
    counts = qs.aggregate(total=Count("id"), favorites=Count("id", filter=Q(favorite=True)),
                          kit=Count("id", filter=Q(keep_in_touch_days__isnull=False)),
                          recent=Count("id", filter=Q(created_on__gte=timezone.now() - datetime.timedelta(days=30))),
                          bmonth=Count("id", filter=Q(birthday_month=today.month)))
    sources = {}
    for s in qs.values_list("sources", flat=True):
        for x in s or []:
            sources[x] = sources.get(x, 0) + 1
    return {"total": counts["total"], "favorites": counts["favorites"], "overdue": overdue.count(),
            "keep_in_touch": counts["kit"], "recent": counts["recent"], "birthdays_this_month": counts["bmonth"],
            "upcoming_birthdays": upcoming[:20],
            "overdue_people": [{"id": p.id, "name": p.name, "next_due": p.next_due, "days_overdue": (today - p.next_due).days}
                               for p in overdue.only("id", "first_name", "middle_name", "last_name", "display_name",
                                                     "nickname", "company", "emails", "next_due")[:20]],
            "tags": _tags(request.user), "sources": sources}


@router.get("/", response=PersonPage, summary="List and search contacts (filters combine)")
def list_people(request, q: str = "", filter: Literal["", "all", "favorites", "overdue", "kit", "recent", "birthdays"] = "",
                tag: str = "", group: str = "", sort: Literal["name", "recent", "last_contacted", "due"] = "name",
                limit: int = 200, offset: int = 0):
    today = timezone.localdate()
    limit, offset = min(max(limit, 1), 5000), max(offset, 0)
    qs = _brief_qs(request.user)
    q = q.strip().lower()[:100]
    if q:
        digits = "".join(c for c in q if c.isdigit())
        cond = Q(search__contains=q) | Q(tags__name__iexact=q)
        if len(digits) >= 4 and len(digits) >= len(q.replace(" ", "")) - 3:
            cond |= Q(search__contains=digits)
        qs = qs.filter(id__in=_people(request.user).filter(cond).values("id"))
    if filter == "favorites":
        qs = qs.filter(favorite=True)
    elif filter == "overdue":
        qs, sort = qs.filter(next_due__lte=today), "due"
    elif filter == "kit":
        qs, sort = qs.filter(keep_in_touch_days__isnull=False), "due"
    elif filter == "recent":
        qs, sort = qs.filter(created_on__gte=timezone.now() - datetime.timedelta(days=30)), "recent"
    elif filter == "birthdays":
        qs = qs.filter(birthday_month=today.month).order_by("birthday_day", "sort_name")
    if tag:
        qs = qs.filter(tags__kind=Tag.TAG, tags__name__iexact=tag)
    if group:
        qs = qs.filter(tags__kind=Tag.GROUP, tags__name__iexact=group)
    if filter != "birthdays":
        qs = qs.order_by(*{"name": ["sort_name"], "recent": ["-created_on"], "due": ["next_due", "sort_name"],
                           "last_contacted": ["-last_contacted", "sort_name"]}[sort])
    total = qs.count()
    return {"items": list(qs[offset:offset + limit]), "total": total}


@router.post("/", response={201: PersonDetail})
def create_person(request, payload: PersonIn):
    p = _save(Person(owner=request.user), payload, partial=False)
    return 201, _person(request.user, p.id)


@router.get("/{uuid:person_id}", response=PersonDetail)
def get_person(request, person_id: uuid.UUID):
    return _person(request.user, person_id)


@router.patch("/{uuid:person_id}", response=PersonDetail)
def update_person(request, person_id: uuid.UUID, payload: PersonIn):
    _save(_person(request.user, person_id), payload, partial=True)
    return _person(request.user, person_id)


@router.delete("/{uuid:person_id}", response={204: None})
def delete_person(request, person_id: uuid.UUID):
    _person(request.user, person_id).delete()
    return 204, None


@router.post("/bulk-delete", response={204: None}, summary="Delete several contacts by id")
def bulk_delete(request, payload: IdsIn):
    _people(request.user).filter(id__in=payload.ids[:5000]).delete()
    return 204, None


@router.get("/{uuid:person_id}/avatar", summary="The uploaded photo (JPEG)")
def get_avatar(request, person_id: uuid.UUID):
    p = get_object_or_404(_people(request.user).only("id", "avatar"), id=person_id)
    if not p.avatar:
        raise HttpError(404, "No photo")
    r = HttpResponse(bytes(p.avatar), content_type="image/jpeg")
    r["Cache-Control"] = "private, max-age=300"
    r["X-Content-Type-Options"] = "nosniff"
    return r


@router.post("/{uuid:person_id}/avatar", response=PersonDetail, summary="Upload a photo (JPEG/PNG/GIF/WebP, max 2 MB)")
def set_avatar(request, person_id: uuid.UUID, file: File[UploadedFile]):
    p = _person(request.user, person_id)
    if file.size > 2_000_000:
        raise HttpError(400, "Photos can be up to 2 MB")
    img = svc.sanitize_photo(file.read())
    if not img:
        raise HttpError(400, "That isn't a JPEG, PNG, GIF or WebP image")
    p.avatar = img
    p.save(update_fields=["avatar"])
    return _person(request.user, person_id)


@router.delete("/{uuid:person_id}/avatar", response=PersonDetail)
def delete_avatar(request, person_id: uuid.UUID):
    p = _person(request.user, person_id)
    p.avatar = None
    p.save(update_fields=["avatar"])
    return _person(request.user, person_id)


# ================================================================ interactions

def _interaction(user, iid):
    return get_object_or_404(Interaction.objects.select_related("person"), id=iid, person__owner=user)


@router.get("/{uuid:person_id}/interactions", response=list[InteractionOut])
def list_interactions(request, person_id: uuid.UUID):
    return list(_person(request.user, person_id).interactions.all())


@router.post("/{uuid:person_id}/interactions", response={201: InteractionOut}, summary="Log a call, meeting, message, email or note")
def add_interaction(request, person_id: uuid.UUID, payload: InteractionIn):
    p = _person(request.user, person_id)
    i = Interaction.objects.create(person=p, kind=payload.kind, date=payload.date or timezone.localdate(),
                                   summary=payload.summary.strip(), notes=payload.notes.strip())
    p.refresh_last_contacted()
    return 201, i


@router.patch("/interactions/{uuid:interaction_id}", response=InteractionOut)
def update_interaction(request, interaction_id: uuid.UUID, payload: InteractionPatch):
    i = _interaction(request.user, interaction_id)
    for k, v in payload.dict(exclude_unset=True).items():
        if v is not None:
            setattr(i, k, v.strip() if isinstance(v, str) else v)
    i.save()
    i.person.refresh_last_contacted()
    return i


@router.delete("/interactions/{uuid:interaction_id}", response={204: None})
def delete_interaction(request, interaction_id: uuid.UUID):
    i = _interaction(request.user, interaction_id)
    person = i.person
    i.delete()
    person.refresh_last_contacted()
    return 204, None


# ================================================================ relationships

@router.post("/{uuid:person_id}/relationships", response={201: RelationshipOut},
             summary="Relate two contacts: other is `kind` to this person (the inverse is added too)")
def add_relationship(request, person_id: uuid.UUID, payload: RelationshipIn):
    p = _person(request.user, person_id)
    other = _person(request.user, payload.other_id)
    if payload.kind not in Relationship.INVERSE:
        raise HttpError(400, "Unknown relationship kind")
    if other.id == p.id:
        raise HttpError(400, "A contact can't be related to themselves")
    rel = svc.relate(p, other, payload.kind)
    return 201, Relationship.objects.select_related("other").get(id=rel.id)


@router.delete("/relationships/{int:rel_id}", response={204: None})
def delete_relationship(request, rel_id: int):
    svc.unrelate(get_object_or_404(Relationship, id=rel_id, person__owner=request.user))
    return 204, None


# ================================================================ tags & groups

def _tags(user):
    return list(Tag.objects.filter(owner=user).annotate(count=Count("people")).filter(count__gt=0)
                .order_by("kind", "name").values("id", "kind", "name", "count"))


@router.get("/tags", response=list[TagOut], summary="Tags and groups in use, with counts")
def list_tags(request):
    return _tags(request.user)


class OverviewOut(Schema):
    meta: dict
    tags: list[TagOut]
    stats: StatsOut


@router.get("/overview", response=OverviewOut, summary="Meta, tags and stats in one request (the Contacts page's first load)")
def overview(request):
    return {"meta": meta(), "tags": _tags(request.user), "stats": stats(request)}


@router.patch("/tags/{int:tag_id}", response=TagOut, summary="Rename a tag or group")
def rename_tag(request, tag_id: int, payload: TagPatch):
    t = get_object_or_404(Tag, id=tag_id, owner=request.user)
    name = payload.name.strip()
    if Tag.objects.filter(owner=request.user, kind=t.kind, name__iexact=name).exclude(id=t.id).exists():
        raise HttpError(400, "That name is already in use")
    t.name = name
    t.save(update_fields=["name"])
    return {"id": t.id, "kind": t.kind, "name": t.name, "count": t.people.count()}


@router.delete("/tags/{int:tag_id}", response={204: None}, summary="Delete a tag or group (contacts stay)")
def delete_tag(request, tag_id: int):
    get_object_or_404(Tag, id=tag_id, owner=request.user).delete()
    return 204, None


# ================================================================ import / export

def _parse_upload(file, format, mapping):
    if file.size > importers.MAX_BYTES:
        raise HttpError(400, "Files can be up to 5 MB")
    mp = None
    if mapping:
        try:
            mp = json.loads(mapping)
        except ValueError:
            raise HttpError(400, "mapping must be a JSON object") from None
        if not isinstance(mp, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in mp.items()) \
                or len(mp) > 500:
            raise HttpError(400, "mapping must map column names to field names")
    if format not in ("auto", *importers.FORMATS):
        raise HttpError(400, "Unknown format")
    return _bad(importers.parse, file.name or "", file.read(importers.MAX_BYTES + 1), format, mp)


@router.post("/import/preview", response=PreviewOut, summary="Parse a file and report what importing it would do")
def import_preview(request, file: File[UploadedFile], format: Form[str] = "auto", mapping: Form[str] = "",
                   mode: Form[Literal["merge", "skip"]] = "merge"):
    parsed = _parse_upload(file, format, mapping)
    plan = svc.plan_import(request.user, parsed, mode)
    return {"format": parsed.format, "format_label": importers.FORMATS[parsed.format], "total": plan["total"],
            "new": plan["new"], "updated": plan["updated"], "duplicates": plan["duplicates"],
            "columns": parsed.columns if parsed.format == "csv" else [], "mapping": parsed.mapping,
            "fields": importers.FIELDS if parsed.format == "csv" else {}, "sample": plan["sample"]}


@router.post("/import/commit", response=CommitOut, summary="Import a file (send the same file and options as the preview)")
def import_commit(request, file: File[UploadedFile], format: Form[str] = "auto", mapping: Form[str] = "",
                  mode: Form[Literal["merge", "skip"]] = "merge"):
    parsed = _parse_upload(file, format, mapping)
    return svc.commit_import(request.user, parsed, mode)


@router.get("/export", summary="Download contacts as vCard 4.0 or CSV (Google Contacts layout)")
def export(request, format: Literal["vcf", "csv"] = "vcf", ids: str = ""):
    try:
        id_list = [uuid.UUID(x) for x in ids.split(",") if x.strip()][:5000]
    except ValueError:
        raise HttpError(400, "ids must be comma-separated contact ids") from None
    if format == "vcf":
        body, ctype = svc.export_vcf(request.user, id_list), "text/vcard; charset=utf-8"
    else:
        body, ctype = "﻿" + svc.export_csv(request.user, id_list), "text/csv; charset=utf-8"
    r = HttpResponse(body, content_type=ctype)
    r["Content-Disposition"] = f'attachment; filename="contacts-{timezone.localdate():%Y-%m-%d}.{format}"'
    r["X-Content-Type-Options"] = "nosniff"
    return r


# ================================================================ duplicates & merge

@router.get("/duplicates", response=list[DuplicateOut], summary="Likely duplicate pairs (same email, phone, profile or name)")
def list_duplicates(request):
    pairs = svc.duplicates(request.user)
    ids = {i for a, b, _ in pairs for i in (a, b)}
    people = {p.id: p for p in _people(request.user).filter(id__in=ids).select_related("user").prefetch_related("tags")}
    return [{"a": people[a], "b": people[b], "reasons": r} for a, b, r in pairs]


@router.post("/duplicates/dismiss", response={204: None}, summary="Mark a suggested pair as different people")
def dismiss_duplicate(request, payload: DismissIn):
    svc.dismiss(request.user, _person(request.user, payload.a_id), _person(request.user, payload.b_id))
    return 204, None


@router.post("/merge", response=PersonDetail, summary="Merge other into keep, choosing field by field")
def merge(request, payload: MergeIn):
    keep, other = _person(request.user, payload.keep_id), _person(request.user, payload.other_id)
    if keep.id == other.id:
        raise HttpError(400, "Pick two different contacts")
    svc.merge(keep, other, payload.fields)
    return _person(request.user, keep.id)


# ================================================================ settings

def _settings(user):
    return ContactSettings.objects.get_or_create(user=user)[0]


@router.get("/settings", response=SettingsOut, summary="Reminder settings")
def get_settings(request):
    return _settings(request.user)


@router.patch("/settings", response=SettingsOut)
def update_settings(request, payload: SettingsPatch):
    s = _settings(request.user)
    for k, v in payload.dict(exclude_unset=True).items():
        if v is not None:
            setattr(s, k, v)
    s.save()
    return s
