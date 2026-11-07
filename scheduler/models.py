import datetime as _dt
import re

from django.db import IntegrityError, models, transaction
from django.db.models import Q
from django.utils import timezone
from users.models import *
from Comptech.utils import get_model_attrs

from . import recurrence as rec

HEX_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
# Icon keys for calendars, events and categories (a superset of the Habits icon set;
# the UI draws them). Served by GET /api/v2/calendar/icons.
ICONS = (
    "calendar", "clock", "bell", "flag", "star", "heart", "smile", "users", "user", "home", "briefcase",
    "school", "book", "pen", "brain", "target", "laptop", "code", "phone", "video", "alert", "dots",
    "coffee", "utensils", "cart", "dollar", "gift", "cake", "party", "trophy", "music", "camera", "palette",
    "run", "bike", "dumbbell", "pill", "stethoscope", "bed", "moon", "sun", "leaf", "tree", "drop", "paw",
    "baby", "plane", "car", "train", "map-pin", "globe", "wrench", "sparkles", "ban",
)
# The fixed categories of the old schema: id → (name, icon). Colour "" = use the calendar colour.
LEGACY_CATEGORIES = {
    0: ("Uncategorized", ""), 1: ("Meeting", "users"), 2: ("Focus Time", "target"), 3: ("Break Time", "coffee"),
    4: ("Study", "book"), 5: ("Work", "briefcase"), 6: ("Personal", "smile"), 7: ("Tech Break", "laptop"),
    8: ("Test / Exam", "alert"), 9: ("Lecture", "school"), 100: ("Other", "dots"),
}
DEFAULT_CATEGORIES = (0, 1, 2, 3, 4, 5, 6, 8, 9, 100)  # for new users (no "Tech Break")
ROLES = ("owner", "admin", "subscriber")


def valid_colour(value):
    return bool(value) and bool(HEX_COLOUR.match(value))


class Invite(models.Model):
    calendar = models.ForeignKey('Calendar', on_delete=models.CASCADE)
    code = models.CharField(max_length=8, unique=True)
    uses = models.IntegerField(default=0)
    active = models.BooleanField(default=True)
    expires_on = models.DateTimeField(null=True, blank=True)       # null = never
    max_uses = models.PositiveIntegerField(null=True, blank=True)   # null = unlimited
    role = models.PositiveSmallIntegerField(choices=((1, 'Admin'), (2, 'Subscriber')), default=2)  # granted on join

    def __str__(self):
        return f"{self.code}, for {self.calendar.name}"

    def problem(self, now=None):
        """Why this invite can't be used right now, or None."""
        if not self.active:
            return "Invite code is not active"
        if self.expires_on and self.expires_on <= (now or timezone.now()):
            return "Invite code has expired"
        if self.max_uses is not None and self.uses >= self.max_uses:
            return "Invite code has been used up"
        return None

    def claim(self):
        """Count one use, atomically and within max_uses. False if it was used up meanwhile."""
        qs = Invite.objects.filter(pk=self.pk).filter(Q(max_uses__isnull=True) | Q(uses__lt=models.F("max_uses")))
        if qs.update(uses=models.F("uses") + 1) != 1:
            return False
        self.uses += 1
        return True

    def getinfo(self, full=False):
        ans = get_model_attrs(self, ["id", "code", "uses", "active", "expires_on", "max_uses", "role"])
        ans["usable"] = self.problem() is None

        if full: ans["calendar"] = self.calendar.getinfo()
        return ans

    @classmethod
    def get_user_objs(cls, user):
        pass

def user_brief(user):
    """The minimum other people need to recognise a user."""
    return {"id": str(user.id), "username": user.username,
            "first_name": user.first_name, "last_name": user.last_name}

class Calendar(models.Model):
    name = models.CharField(max_length=64)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_owner')
    colour = models.CharField(max_length=16, default='#000000')
    icon = models.CharField(max_length=24, blank=True, default='')
    description = models.TextField(blank=True, default='')
    public = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    calendar_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Local Calendar'),
        (1, 'ICalendar'),
        (2, 'Google Calendar'),
        (50, 'UWaterloo WCMS'),
    ), default=0)
    calendar_url = models.CharField(max_length=256, null=True, blank=True)
    time_zone = models.CharField(max_length=64, blank=True, default='')  # "" = settings.TIME_ZONE
    tags = models.JSONField(default=list, blank=True)
    auto_sync = models.BooleanField(default=False)
    # Sync window: [first of this month − past, first of this month + future months)
    sync_past_months = models.PositiveSmallIntegerField(default=1)
    sync_future_months = models.PositiveSmallIntegerField(default=12)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_sync_error = models.TextField(blank=True, default='')
    sync_etag = models.CharField(max_length=256, blank=True, default='')
    sync_last_modified = models.CharField(max_length=64, blank=True, default='')

    def  __str__(self):
        return f"{self.name}, Owner: {self.owner.username}"

    @property
    def tz(self):
        return rec.zone(self.time_zone)

    def getinfo(self):
        ans = get_model_attrs(self, ["id", "name", "colour", "public", "active", "calendar_type", "auto_sync",
                                     "icon", "description", "time_zone", "tags"])
        ans["owner"] = {"id": self.owner_id}

        return ans

    def get_subs(self, editor=False):
        """Who's in the calendar. Only names are shared (no birthdays, groups or
        admin flags); the subscriber list and invite codes are for owners/admins."""
        ans = {"owner": user_brief(self.owner), "subscribers": [], "invites": []}
        if editor:
            ans["subscribers"] = [i.getinfo(user=True) for i in self.users_subscribed.select_related('user', 'calendar')]
            ans["invites"] = [i.getinfo() for i in Invite.objects.filter(calendar=self)]
        return ans

    def role_of(self, user, sub=None):
        """'owner' (from Calendar.owner), 'admin', 'subscriber', or None."""
        if user is None or not user.is_authenticated:
            return None
        if self.owner_id == user.id:
            return "owner"
        if sub is None:
            sub = self.users_subscribed.filter(user=user).first()
        if sub is None:
            return None
        return "admin" if sub.subscribe_type in (0, 1) else "subscriber"

    def can_edit(self, user):
        return self.role_of(user) in ("owner", "admin")

class Subscriber(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE, related_name='users_subscribed')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_subscribed')
    subscribe_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Owner'),
        (1, 'Admin'),
        (2, 'Subscriber'),
    ), default=2)
    display_busy = models.PositiveSmallIntegerField(choices=(
        (0, 'None'),
        (1, 'Event Type Only'),
        (2, 'All'),
    ), default=0)
    colour = models.CharField(max_length=16, null=True, blank=True, default=None)
    visible = models.BooleanField(default=True)
    notify = models.BooleanField(default=True)  # False = no automatic reminders from this calendar

    def __str__(self):
        return f"{self.user.username} subscribed to {self.calendar.name}"

    @property
    def role(self):
        """Ownership comes from Calendar.owner; subscribe_type only separates admins from subscribers."""
        if self.user_id == self.calendar.owner_id:
            return "owner"
        return "admin" if self.subscribe_type in (0, 1) else "subscriber"

    def getinfo(self, cal=False, user=False):
        ans = get_model_attrs(self, ["id", "subscribe_type", "display_busy", "colour", "visible", "notify"])
        ans["user"] = self.user_id
        ans["role"] = self.role

        if cal: ans["calendar"] = self.calendar.getinfo()
    
        if user: ans["user"] = user_brief(self.user)

        return ans


class EventCategory(models.Model):
    """A user's own event categories. Events use their calendar owner's categories.
    legacy_id links the categories made from the old fixed list (0–9, 100)."""
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='event_categories')
    name = models.CharField(max_length=64)
    colour = models.CharField(max_length=7, blank=True, default='')  # "" = use the calendar colour
    icon = models.CharField(max_length=24, blank=True, default='')
    position = models.IntegerField(default=0)
    legacy_id = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['position', 'name']
        constraints = [models.UniqueConstraint(fields=['owner', 'legacy_id'], condition=Q(legacy_id__isnull=False),
                                               name='scheduler_category_owner_legacy_uniq')]

    def __str__(self):
        return f"{self.name} ({self.owner_id})"

    @classmethod
    def ensure_defaults(cls, owner_id):
        """Give a user the default categories the first time they need any."""
        if not cls.objects.filter(owner_id=owner_id).exists():
            for pos, lid in enumerate(DEFAULT_CATEGORIES):
                cls._make(owner_id, lid, pos)

    @classmethod
    def _make(cls, owner_id, legacy_id, position=None):
        name, icon = LEGACY_CATEGORIES.get(legacy_id, (f"Category {legacy_id}", ""))
        try:
            with transaction.atomic():
                return cls.objects.get_or_create(owner_id=owner_id, legacy_id=legacy_id, defaults={
                    "name": name, "icon": icon,
                    "position": position if position is not None else (legacy_id if legacy_id < 100 else 100)})[0]
        except IntegrityError:  # created concurrently
            return cls.objects.get(owner_id=owner_id, legacy_id=legacy_id)

    @classmethod
    def for_legacy(cls, owner_id, legacy_id, cache=None):
        """The owner's category for an old category number (created on demand)."""
        k = (owner_id, legacy_id or 0)
        if cache is not None and k in cache:
            return cache[k]
        cat = cls.objects.filter(owner_id=owner_id, legacy_id=legacy_id or 0).first()
        if cat is None:
            cls.ensure_defaults(owner_id)
            cat = cls._make(owner_id, legacy_id or 0)
        if cache is not None:
            cache[k] = cat
        return cat

    def brief(self):
        return {"id": self.id, "name": self.name, "colour": self.colour, "icon": self.icon}


class EventManager(models.Manager):
    def bulk_create(self, objs, *args, **kwargs):
        objs = list(objs)
        cache = {}
        for o in objs:
            o.normalize(category_cache=cache)
        return super().bulk_create(objs, *args, **kwargs)


_SNAPSHOT = ("kind", "allday", "startdate", "enddate", "start_date", "end_date", "calendar_id")


class Event(models.Model):
    KINDS = (('event', 'Event'), ('all_day', 'All day'), ('deadline', 'Deadline'))
    STATUSES = (('confirmed', 'Confirmed'), ('tentative', 'Tentative'), ('cancelled', 'Cancelled'))
    TRANSPARENCIES = (('busy', 'Busy'), ('free', 'Free'))
    VISIBILITIES = (('default', 'Default'), ('public', 'Public'), ('private', 'Private'))

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256, null=False, blank=False)
    kind = models.CharField(max_length=8, choices=KINDS, default='event')
    # Timed events: UTC instants. All-day events: start_date/end_date (end exclusive) are the
    # truth and startdate/enddate are derived at local midnight. Deadlines: no end.
    startdate = models.DateTimeField(auto_now=False)
    enddate = models.DateTimeField(auto_now=False, null=True, blank=True)
    allday = models.BooleanField(default=False)  # derived from kind, kept for old clients
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    # Old fixed category number, kept in sync with event_category (the legacy UI shows its icons).
    category = models.PositiveSmallIntegerField(choices=tuple((k, v[0]) for k, v in LEGACY_CATEGORIES.items()),
                                                default=0)
    event_category = models.ForeignKey(EventCategory, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='events')
    location = models.CharField(max_length=256, null=True, blank=True)
    place = models.ForeignKey('map.Location', on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    meeting_url = models.URLField(max_length=500, blank=True, default='')
    description = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default='confirmed')
    transparency = models.CharField(max_length=4, choices=TRANSPARENCIES, default='busy')
    visibility = models.CharField(max_length=8, choices=VISIBILITIES, default='default')
    colour = models.CharField(max_length=7, null=True, blank=True)   # overrides category/calendar colour
    icon = models.CharField(max_length=24, null=True, blank=True)
    tags = models.JSONField(default=list, blank=True)
    time_zone = models.CharField(max_length=64, blank=True, default='')  # repeats in this zone; "" = the calendar's
    # Recurrence (RFC 5545). Override rows point at their series with original_start.
    rrule = models.TextField(blank=True, default='')
    exdates = models.JSONField(default=list, blank=True)   # occurrence keys, "YYYY-MM-DDTHH:MM:SSZ"
    rdates = models.JSONField(default=list, blank=True)
    recurrence_end = models.DateTimeField(null=True, blank=True)  # end of the last occurrence; null = forever
    recurrence_parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True,
                                          related_name='overrides')
    original_start = models.DateTimeField(null=True, blank=True)
    sync_id = models.CharField(max_length=256, null=True, blank=True)
    custom_info = models.JSONField(default=dict, null=True, blank=True)
    created_on = models.DateTimeField(default=timezone.now)
    updated_on = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(ComptechUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    objects = EventManager()

    class Meta:
        indexes = [
            models.Index(fields=['calendar', 'startdate'], name='scheduler_event_cal_start'),
            models.Index(fields=['calendar', 'enddate'], name='scheduler_event_cal_end'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['calendar', 'sync_id'], condition=Q(sync_id__isnull=False),
                                    name='scheduler_event_cal_sync_id_uniq'),
            models.UniqueConstraint(fields=['recurrence_parent', 'original_start'],
                                    condition=Q(recurrence_parent__isnull=False),
                                    name='scheduler_event_override_uniq'),
        ]

    def __str__(self):
        return f"{self.name} for {self.calendar.name}. From {str(self.startdate)} to {str(self.enddate)}"

    # ------------------------------------------------ retired columns, kept as properties
    # priority/completed live in custom_info now (legacy_priority/legacy_completed) and
    # public became visibility; old code and the legacy UI keep reading/writing these.

    def _ci_get(self, key, default):
        ci = self.custom_info
        return ci.get(key, default) if isinstance(ci, dict) else default

    def _ci_set(self, key, value, default):
        ci = self.custom_info
        ci = dict(ci) if isinstance(ci, dict) else ({} if ci is None else {"legacy_custom_info": ci})
        if value == default:
            ci.pop(key, None)
        else:
            ci[key] = value
        self.custom_info = ci

    @property
    def priority(self):
        try:
            return int(self._ci_get("legacy_priority", 10))
        except (TypeError, ValueError):
            return 10

    @priority.setter
    def priority(self, value):
        try:
            value = int(value)
        except (TypeError, ValueError):
            value = 10
        self._ci_set("legacy_priority", value, 10)

    @property
    def completed(self):
        return bool(self._ci_get("legacy_completed", False))

    @completed.setter
    def completed(self, value):
        self._ci_set("legacy_completed", bool(value), False)

    @property
    def public(self):
        return self.visibility == "public"

    @public.setter
    def public(self, value):
        if value:
            self.visibility = "public"
        elif self.visibility == "public":
            self.visibility = "default"

    # ------------------------------------------------ identity in expanded lists

    @property
    def is_recurring(self):
        return bool(self.rrule)

    def ident(self):
        """The id clients use: a plain uuid, or <series>:<original start> for occurrences/overrides."""
        if getattr(self, "occurrence_id", None):
            return self.occurrence_id
        if self.recurrence_parent_id and self.original_start:
            return f"{self.recurrence_parent_id}:{rec.key(self.original_start)}"
        return str(self.id)

    def series(self):
        return getattr(self, "series_id", None) or self.recurrence_parent_id or (self.id if self.rrule else None)

    # ------------------------------------------------ derived fields

    @classmethod
    def from_db(cls, db, field_names, values):
        inst = super().from_db(db, field_names, values)
        inst._loaded = {f: inst.__dict__.get(f) for f in _SNAPSHOT}
        return inst

    def _coerce(self, value, tz):
        if value is None or value == "":
            return None
        if isinstance(value, str):
            return rec.parse_moment(value, tz)
        if isinstance(value, _dt.datetime):
            return value.replace(tzinfo=tz) if value.tzinfo is None else value
        if isinstance(value, _dt.date):
            return rec.local_midnight(value, tz)
        return value

    def normalize(self, category_cache=None):
        """Keep the derived columns consistent: kind ↔ allday, all-day dates ↔ datetimes,
        deadline transparency, recurrence_end and the category FK."""
        cal = self.calendar
        tz = cal.tz
        loaded = getattr(self, "_loaded", None)
        self.startdate = self._coerce(self.startdate, tz)
        self.enddate = self._coerce(self.enddate, tz)
        for f in ("start_date", "end_date"):
            v = getattr(self, f)
            if isinstance(v, str):
                setattr(self, f, _dt.date.fromisoformat(v[:10]) if v else None)
            elif isinstance(v, _dt.datetime):
                setattr(self, f, v.date())

        # kind: an explicit change of kind wins; otherwise it follows allday/enddate (old clients)
        implied = "all_day" if self.allday else ("deadline" if self.enddate is None else "event")
        explicit = (self.kind != loaded["kind"]) if loaded else (self.kind != "event")
        if not explicit:
            self.kind = implied
        self.allday = self.kind == "all_day"

        if self.kind == "all_day":
            dt_changed = loaded is None or (self.startdate, self.enddate) != (loaded["startdate"], loaded["enddate"])
            d_changed = loaded is None or (self.start_date, self.end_date) != (loaded["start_date"], loaded["end_date"])
            if not (self.start_date and (d_changed or not dt_changed or self.startdate is None)):
                if self.startdate is None:
                    raise ValueError("An all-day event needs a start")
                self.start_date = self.startdate.astimezone(tz).date()
                if self.enddate is not None:
                    el = self.enddate.astimezone(tz)
                    self.end_date = el.date() if el.time() == _dt.time() else el.date() + _dt.timedelta(days=1)
                else:
                    self.end_date = None
            if not self.end_date or self.end_date <= self.start_date:
                self.end_date = self.start_date + _dt.timedelta(days=1)
            self.startdate = rec.local_midnight(self.start_date, tz)
            self.enddate = rec.local_midnight(self.end_date, tz)
        else:
            self.start_date = self.end_date = None
            if self.kind == "deadline":
                self.enddate = None
                if self._state.adding and self.transparency == "busy":
                    self.transparency = "free"  # deadlines never block availability by default
            elif self.enddate is None:
                self.enddate = self.startdate + _dt.timedelta(hours=1)

        if self.recurrence_parent_id:
            self.rrule = ""
        self.recurrence_end = rec.recurrence_end(self, rec.event_zone(self)) if self.rrule else None

        if self.event_category_id is None:
            self.event_category = EventCategory.for_legacy(cal.owner_id, self.category or 0, category_cache)

    def set_category(self, cat):
        """Point at a category (one of the calendar owner's) and keep the old number in sync."""
        self.event_category = cat
        self.category = cat.legacy_id if cat.legacy_id in LEGACY_CATEGORIES else 100

    def save(self, *args, **kwargs):
        self.normalize()
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {
                "updated_on", "kind", "allday", "startdate", "enddate", "start_date", "end_date",
                "recurrence_end", "event_category", "transparency", "rrule"}
        loaded = getattr(self, "_loaded", None)
        moved_from = loaded.get("calendar_id") if loaded else None
        if kwargs.get("update_fields") is not None and not {"calendar", "calendar_id"} & set(kwargs["update_fields"]):
            moved_from = None
        super().save(*args, **kwargs)
        if moved_from is not None and moved_from != self.calendar_id and self.rrule:
            # A series moved to another calendar takes its changed occurrences along: they're
            # listed with the series, and roles/colours come from their own calendar.
            ow = Event.objects.filter(recurrence_parent=self)
            if Calendar.objects.filter(id=moved_from).values_list("owner_id", flat=True).first() != self.calendar.owner_id:
                ow.update(calendar_id=self.calendar_id, event_category_id=self.event_category_id, category=self.category)
            else:
                ow.update(calendar_id=self.calendar_id)
        self._loaded = {f: self.__dict__.get(f) for f in _SNAPSHOT}

    def display_colour(self, sub_colour=None):
        """event colour → category colour → your colour for the calendar → calendar colour."""
        cat = self.event_category if self.event_category_id else None
        return self.colour or (cat.colour if cat else "") or sub_colour or self.calendar.colour

    def getinfo(self, full=False, sub_colour=None, masked=False):
        ans = get_model_attrs(self, ["id", "name", "startdate", "enddate", "allday", "category", "location", "description", "completed", "public", "priority"])
        ans["id"] = self.ident()
        ans["calendar"] = self.calendar_id
        cat = self.event_category if self.event_category_id else None
        ans.update({
            "kind": self.kind, "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "status": self.status, "transparency": self.transparency, "visibility": self.visibility,
            "tags": self.tags or [], "colour": self.colour, "icon": self.icon,
            "display_colour": self.display_colour(sub_colour),
            "category_id": self.event_category_id, "category_name": cat.name if cat else None,
            "category_colour": cat.colour if cat else None, "category_icon": cat.icon if cat else None,
            "meeting_url": self.meeting_url, "place_id": str(self.place_id) if self.place_id else None,
            "recurring": bool(self.series()), "series_id": str(self.series()) if self.series() else None,
            "rrule": self.rrule or None,
            "original_start": self.original_start if (self.recurrence_parent_id or getattr(self, "is_occurrence", False)) else None,
            "created_on": self.created_on, "updated_on": self.updated_on,
            "created_by": str(self.created_by_id) if self.created_by_id else None,
        })
        if masked:  # a private event on someone else's calendar: show only that you're busy
            ans.update({"name": "Busy", "description": None, "location": None, "meeting_url": "",
                        "place_id": None, "tags": []})

        if full: ans = {**ans, **get_model_attrs(self, ["sync_id"])}

        return ans

    @classmethod
    def get_user_objs(cls, user):
        pass


class EventReminder(models.Model):
    """Per-event reminder leads; when an event has any, they replace the global
    ReminderSettings lead for it (for every subscriber who hasn't muted the calendar)."""
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='reminders')
    minutes_before = models.PositiveIntegerField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['event', 'minutes_before'], name='scheduler_eventreminder_uniq')]
        ordering = ['-minutes_before']


class EventAttendee(models.Model):
    RSVP = (('needs_action', 'Needs action'), ('accepted', 'Accepted'), ('declined', 'Declined'),
            ('tentative', 'Tentative'))
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='attendees')
    contact = models.ForeignKey('contacts.Person', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    user = models.ForeignKey(ComptechUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    name = models.CharField(max_length=200, blank=True, default='')
    email = models.EmailField(max_length=254, blank=True, default='')
    rsvp = models.CharField(max_length=12, choices=RSVP, default='needs_action')
    is_organizer = models.BooleanField(default=False)

    class Meta:
        ordering = ['-is_organizer', 'name', 'id']


class CalendarMigrationLog(models.Model):
    """What the calendar schema data migration converted (read by calendar_migration_report)."""
    step = models.CharField(max_length=64)
    ran_on = models.DateTimeField(default=timezone.now)
    counts = models.JSONField(default=dict, blank=True)
    details = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ['ran_on', 'id']


class Todo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True)
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    status = models.PositiveSmallIntegerField(choices=(
        (0, 'Uncategorized'),
        (1, 'Backlog'),
        (2, 'Waiting'),
        (3, 'To-do'),
        (11, 'Design'),
        (12, 'In-Progress'),
        (13, 'Testing'),
        (100, 'Completed'),
    ), default=0)
    description = models.TextField(null=True, blank=True)
    priority = models.SmallIntegerField(default=10)
    completed = models.BooleanField(default=False)
    complete_by = models.DateTimeField(auto_now=False, null=True, blank=True)
    completed_on = models.DateTimeField(auto_now=False, null=True, blank=True)
    percent_complete = models.PositiveSmallIntegerField(null=True, blank=True)
    time_spent = models.PositiveSmallIntegerField(null=True, blank=True)
    custom_info = models.JSONField(default=dict, null=True, blank=True)

    # Tasks app (Vikunja-style). complete_by = due date, completed/completed_on = done.
    project = models.ForeignKey('tasks.Project', on_delete=models.CASCADE, null=True, blank=True, related_name='tasks')
    bucket = models.ForeignKey('tasks.Bucket', on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    position = models.FloatField(default=0)
    labels = models.ManyToManyField('tasks.Label', blank=True, related_name='tasks')
    assignees = models.ManyToManyField(ComptechUser, blank=True, related_name='assigned_todos')
    start_on = models.DateTimeField(null=True, blank=True)
    repeat_mode = models.PositiveSmallIntegerField(choices=(
        (0, 'Does not repeat'),
        (1, 'Every interval after the due date'),
        (2, 'Monthly'),
        (3, 'Every interval after completion'),
    ), default=0)
    repeat_every = models.PositiveIntegerField(null=True, blank=True)  # seconds, for modes 1 and 3
    favorite = models.BooleanField(default=False)
    colour = models.CharField(max_length=7, blank=True, default='')
    created_on = models.DateTimeField(default=timezone.now)
    updated_on = models.DateTimeField(auto_now=True)

    class Meta:
        # The Tasks lists' filters and sorts (manual order in a project, open/done, due, done date, recent).
        indexes = [
            models.Index(fields=["project", "completed", "position"], name="todo_project_open_pos"),
            models.Index(fields=["user", "completed"], name="todo_user_done"),
            models.Index(fields=["completed", "complete_by"], name="todo_done_due"),
            models.Index(fields=["completed", "completed_on"], name="todo_done_on"),
            models.Index(fields=["updated_on"], name="todo_updated"),
        ]

    def __str__(self):
        return f"{self.name} for {self.user.username}."

    def getinfo(self):
        ans = get_model_attrs(self, ["id", "name", "description", "priority", "completed", "complete_by", "completed_on", "percent_complete", "time_spent"])
        ans["user"] = self.user.id

        return ans
