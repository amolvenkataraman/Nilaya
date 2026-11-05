"""Contacts: a private personal CRM per user.

A Person is someone the owner knows (not a site account, though it can link to one).
Multi-value fields (emails, phones, addresses, links, custom fields) are JSON lists of
small dicts; developer/social profiles are a JSON dict {network: handle} normalised by
contacts.profiles. Tags and groups share one per-owner Tag table (kind tag|group).
"""

import datetime
import uuid

from django.db import models
from django.utils import timezone

from users.models import ComptechUser

from . import profiles as profile_mod


class Tag(models.Model):
    TAG, GROUP = "tag", "group"
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=8, choices=[(TAG, "Tag"), (GROUP, "Group")], default=TAG)
    name = models.CharField(max_length=64)

    class Meta:
        unique_together = [("owner", "kind", "name")]
        ordering = ["name"]

    def __str__(self):
        return self.name


class Person(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name="contacts")
    user = models.ForeignKey(ComptechUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
                             help_text="The site account of this person, if they have one")

    prefix = models.CharField(max_length=32, blank=True)
    first_name = models.CharField(max_length=128, blank=True)
    middle_name = models.CharField(max_length=128, blank=True)
    last_name = models.CharField(max_length=128, blank=True)
    suffix = models.CharField(max_length=32, blank=True)
    nickname = models.CharField(max_length=128, blank=True)
    display_name = models.CharField(max_length=200, blank=True, help_text="Overrides the composed name")
    company = models.CharField(max_length=200, blank=True)
    title = models.CharField(max_length=200, blank=True)
    department = models.CharField(max_length=200, blank=True)

    emails = models.JSONField(default=list, blank=True)      # [{"label", "value"}]
    phones = models.JSONField(default=list, blank=True)      # [{"label", "value"}]
    addresses = models.JSONField(default=list, blank=True)   # [{"label", "street", "city", "region", "postcode", "country"}]
    profiles = models.JSONField(default=dict, blank=True)    # {"github": "torvalds", ...}
    links = models.JSONField(default=list, blank=True)       # [{"label", "url"}] (http/https only)
    custom_fields = models.JSONField(default=list, blank=True)  # [{"key", "value"}]
    sources = models.JSONField(default=list, blank=True)     # ["manual", "vcard", "linkedin", ...]

    birthday_year = models.PositiveSmallIntegerField(null=True, blank=True)
    birthday_month = models.PositiveSmallIntegerField(null=True, blank=True)
    birthday_day = models.PositiveSmallIntegerField(null=True, blank=True)
    anniversary = models.DateField(null=True, blank=True)
    how_met = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    favorite = models.BooleanField(default=False)
    tags = models.ManyToManyField(Tag, blank=True, related_name="people")

    last_contacted = models.DateField(null=True, blank=True)
    keep_in_touch_days = models.PositiveSmallIntegerField(null=True, blank=True)
    kit_start = models.DateField(null=True, blank=True, editable=False)  # when keep-in-touch was turned on
    next_due = models.DateField(null=True, blank=True, editable=False)

    avatar = models.BinaryField(null=True, blank=True, editable=False)  # uploaded only; 256px JPEG
    sort_name = models.CharField(max_length=200, blank=True, editable=False)
    search = models.TextField(blank=True, editable=False)  # lowercased haystack for q=
    created_on = models.DateTimeField(auto_now_add=True)
    updated_on = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_name", "created_on"]
        indexes = [models.Index(fields=["owner", "sort_name"]), models.Index(fields=["owner", "next_due"]),
                   models.Index(fields=["owner", "created_on"])]

    def __str__(self):
        return self.name

    # ------------------------------------------------------------ derived

    @property
    def name(self):
        if self.display_name:
            return self.display_name
        full = " ".join(p for p in (self.first_name, self.middle_name, self.last_name) if p)
        if full:
            return full
        return self.nickname or self.company or (self.emails[0]["value"] if self.emails else "") or "Unnamed"

    @property
    def birthday(self):
        if not (self.birthday_month and self.birthday_day):
            return ""
        md = f"{self.birthday_month:02d}-{self.birthday_day:02d}"
        return f"{self.birthday_year:04d}-{md}" if self.birthday_year else f"--{md}"

    def next_birthday(self, today):
        if not (self.birthday_month and self.birthday_day):
            return None
        for year in (today.year, today.year + 1):
            day = self.birthday_day
            if self.birthday_month == 2 and day == 29 and not _leap(year):
                day = 28
            d = datetime.date(year, self.birthday_month, day)
            if d >= today:
                return d
        return None

    def refresh_derived(self):
        today = timezone.localdate()
        if self.keep_in_touch_days:
            self.kit_start = self.kit_start or today
            self.next_due = (self.last_contacted or self.kit_start) + datetime.timedelta(days=self.keep_in_touch_days)
        else:
            self.kit_start = self.next_due = None
        self.sort_name = (self.display_name or " ".join(p for p in (self.first_name, self.last_name) if p)
                          or self.name).lower()[:200]
        parts = [self.name, self.first_name, self.last_name, self.nickname, self.company, self.title, self.department]
        parts += [e.get("value", "") for e in self.emails]
        parts += ["".join(ch for ch in p.get("value", "") if ch.isdigit()) for p in self.phones]
        parts += [str(v) for v in self.profiles.values()]
        self.search = " ".join(p for p in parts if p).lower()

    def save(self, *args, **kwargs):
        self.refresh_derived()
        if kwargs.get("update_fields"):
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {"kit_start", "next_due", "sort_name", "search", "updated_on"}
        super().save(*args, **kwargs)

    def refresh_last_contacted(self):
        latest = self.interactions.aggregate(m=models.Max("date"))["m"]
        self.last_contacted = latest
        self.save(update_fields=["last_contacted"])

    def profile_links(self):
        return profile_mod.links(self.profiles)


def _leap(y):
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


class Interaction(models.Model):
    KINDS = [("call", "Call"), ("meeting", "Meeting"), ("message", "Message"), ("email", "Email"), ("note", "Note")]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="interactions")
    kind = models.CharField(max_length=16, choices=KINDS, default="note")
    date = models.DateField()
    summary = models.CharField(max_length=500)
    notes = models.TextField(blank=True)
    created_on = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_on"]


class Relationship(models.Model):
    """`other` is `kind` to `person` (e.g. kind=manager: other is person's manager). Always stored in pairs."""
    INVERSE = {
        "spouse": "spouse", "partner": "partner", "parent": "child", "child": "parent", "sibling": "sibling",
        "relative": "relative", "friend": "friend", "colleague": "colleague", "manager": "report",
        "report": "manager", "mentor": "mentee", "mentee": "mentor", "classmate": "classmate",
        "roommate": "roommate", "neighbor": "neighbor", "introduced_by": "introduced", "introduced": "introduced_by",
        "other": "other",
    }
    person = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="relationships")
    other = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=16)
    created_on = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("person", "other", "kind")]
        ordering = ["kind", "other__sort_name"]


class DismissedDuplicate(models.Model):
    """The owner said these two are different people (a_id < b_id)."""
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name="+")
    a = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="+")
    b = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="+")

    class Meta:
        unique_together = [("a", "b")]


class ContactSettings(models.Model):
    BIRTHDAY = [("off", "Off"), ("day_before", "The day before"), ("on_day", "On the day")]
    user = models.OneToOneField(ComptechUser, on_delete=models.CASCADE, related_name="+")
    birthday_reminders = models.CharField(max_length=12, choices=BIRTHDAY, default="day_before")
    keep_in_touch_reminders = models.BooleanField(default=True)
