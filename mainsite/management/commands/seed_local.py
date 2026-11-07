"""Fill a LOCAL test instance with dummy data (refuses to run anywhere else).

    manage.py seed_local                 # users, groups, calendars, events, todos, places
    manage.py seed_local --photos        # + albums ingested from the photo sources (hardlinked)
    manage.py seed_local --photos --limit 100   # at most 100 files per album (quick runs)
    manage.py seed_local --fresh ...     # wipe the local DB + library first

Photo sources are hardlinked into each album's Ingest/ folder, then the real
ingest pipeline runs (which hardlinks again into year/month folders under
PHOTOS_INGEST_HARDLINK). No bytes are copied and the originals are never modified.
"""

import datetime as dt
import os
import random
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from map.models import Location, LocationGroup
from photos.models import Album, Album_Subscriber, Photo, ShareAlbum, ShareAlbum_Photo, ShareAlbum_Subscriber
from scheduler.models import Calendar, Event, Invite, Subscriber, Todo
from users.models import ComptechUser, UserGroup

PHOTO_SOURCES = {
    "Phone": Path.home() / "Desktop/26Projects/Compress/3",
    "Camera": Path.home() / "Desktop/26Projects/Compress/7",
}
PASSWORD = "localdev"
TZ = ZoneInfo("America/Toronto")

EVENT_TEMPLATES = [
    # (name, category, minutes, location)
    ("Team standup", 1, 30, "Zoom"),
    ("1:1 with manager", 1, 45, "Office 3B"),
    ("Deep work: platform loader", 2, 120, None),
    ("Lunch", 3, 60, "Kitchen"),
    ("CS 341 lecture", 9, 80, "MC 2066"),
    ("STAT 230 tutorial", 4, 50, "DC 1350"),
    ("Gym", 6, 75, "PAC"),
    ("Grocery run", 6, 40, "Farm Boy"),
    ("Code review", 5, 60, None),
    ("Tech break", 7, 15, None),
    ("Dinner with family", 6, 90, "Home"),
    ("Dentist", 6, 60, "123 King St W"),
]
DESCRIPTIONS = [
    None,
    "Agenda: https://example.com/agenda",
    "Bring laptop + charger.\nNotes in the shared doc.",
    "Room changed — check https://portal.example.edu/rooms",
    "<b>bold?</b> should render safely",
]


class Command(BaseCommand):
    help = "Seed the local test instance with dummy data."

    def add_arguments(self, parser):
        parser.add_argument("--photos", action="store_true", help="also create albums and ingest photos")
        parser.add_argument("--limit", type=int, default=0, help="max files per album (0 = all)")
        parser.add_argument("--fresh", action="store_true", help="wipe local DB and library first")

    def handle(self, *args, photos, limit, fresh, **options):
        if not getattr(settings, "LOCAL", False):
            raise CommandError("seed_local only runs with DJANGO_SETTINGS_MODULE=Comptech.settings_local")
        if fresh:
            call_command("flush", interactive=False, verbosity=0)
            for d in (settings.PHOTOS_ROOT, settings.THUMBNAIL_DIR):
                shutil.rmtree(d, ignore_errors=True)
                os.makedirs(d, exist_ok=True)
        self._default_avatar()
        rng = random.Random(42)

        if ComptechUser.objects.exists():
            self.stdout.write("Base data already present (use --fresh to reseed).")
            users = {u.username: u for u in ComptechUser.objects.all()}
        else:
            users = self._users()
            self._calendars(users, rng)
            self._todos(users["amol"], rng)
            self._places(users)
            self.stdout.write(self.style.SUCCESS(f"Users: amol (admin), alex, sam — password '{PASSWORD}'"))

        if photos:
            self._photos(users, limit, rng)

    # ------------------------------------------------------------------ users
    def _default_avatar(self):
        target = Path(settings.MEDIA_ROOT) / "profile_picture.png"
        if not target.exists():
            from PIL import Image, ImageDraw

            target.parent.mkdir(parents=True, exist_ok=True)
            img = Image.new("RGB", (256, 256), "#d1d5db")
            ImageDraw.Draw(img).ellipse((64, 40, 192, 168), fill="#9ca3af")
            ImageDraw.Draw(img).ellipse((24, 170, 232, 380), fill="#9ca3af")
            img.save(target)

    def _users(self):
        family = UserGroup.objects.create(name="Family", description="The household", priority=1)
        uni = UserGroup.objects.create(name="UWaterloo", description="Uni friends", priority=2, public=True)
        spec = [
            ("amol", "Amol", "Demo", dt.date(2000, 1, 1), True),
            ("alex", "Alex", "Rivera", dt.date(2002, 11, 3), False),
            ("sam", "Sam", "Chen", dt.date(2004, 2, 29), False),
        ]
        users = {}
        for username, first, last, birthday, admin in spec:
            create = ComptechUser.objects.create_superuser if admin else ComptechUser.objects.create_user
            u = create(
                username=username, password=PASSWORD, first_name=first, last_name=last,
                email=f"{username}@example.com",
            )
            u.birthday = birthday
            u.description = f"Hi, I'm {first}."
            u.newuser = False
            u.save()
            u.user_groups.add(family if username != "sam" else uni)
            users[username] = u
        users["amol"].friends.add(users["alex"], users["sam"])
        return users

    # ------------------------------------------------------------------ calendar
    def _calendar(self, owner, name, colour, **fields):
        cal = Calendar.objects.create(owner=owner, name=name, colour=colour, **fields)
        Subscriber.objects.create(calendar=cal, user=owner, subscribe_type=0, colour=colour)
        return cal

    def _calendars(self, users, rng):
        amol, alex, sam = users["amol"], users["alex"], users["sam"]
        personal = self._calendar(amol, "Personal", "#3b82f6")
        work = self._calendar(amol, "Work", "#ef4444")
        school = self._calendar(amol, "School", "#10b981", public=True)
        family = self._calendar(alex, "Family", "#f59e0b")
        self._calendar(amol, "Old term (inactive)", "#6b7280", active=False)
        self._calendar(
            amol, "Holidays (ICS, offline)", "#8b5cf6", calendar_type=1,
            calendar_url="https://example.com/holidays.ics",
        )
        Subscriber.objects.create(calendar=family, user=amol, subscribe_type=2, colour="#f59e0b")
        Subscriber.objects.create(calendar=personal, user=alex, subscribe_type=2, display_busy=1)
        Subscriber.objects.create(calendar=school, user=sam, subscribe_type=1)
        Invite.objects.create(calendar=school, code="SCHOOL01", uses=3)
        Invite.objects.create(calendar=work, code="WORKTEAM", active=False)

        today = dt.datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        cals = [personal, work, school, work, school, personal]
        events = []
        for offset in range(-45, 46):
            day = today + dt.timedelta(days=offset)
            weekend = day.weekday() >= 5
            for _ in range(rng.randint(0, 2 if weekend else 4)):
                name, category, minutes, location = rng.choice(EVENT_TEMPLATES)
                start = day + dt.timedelta(hours=rng.randint(8, 19), minutes=rng.choice([0, 15, 30, 45]))
                events.append(Event(
                    calendar=rng.choice(cals), name=name, category=category, location=location,
                    startdate=start, enddate=start + dt.timedelta(minutes=minutes),
                    description=rng.choice(DESCRIPTIONS), priority=rng.randint(0, 20),
                    completed=offset < 0 and rng.random() < 0.4, public=rng.random() < 0.2,
                ))
            if offset % 9 == 0:  # an assignment (no end) every ~9 days
                due = day + dt.timedelta(hours=23, minutes=59)
                events.append(Event(calendar=school, name=f"Assignment {offset // 9 + 6} due", category=8,
                                    startdate=due, enddate=None, completed=offset < 0))
        for start, days, name in [(-20, 3, "Cottage trip"), (5, 1, "Reading day"), (30, 5, "Conference")]:
            s = today + dt.timedelta(days=start)
            events.append(Event(calendar=personal, name=name, allday=True, category=6,
                                startdate=s, enddate=s + dt.timedelta(days=days)))
        for offset, name in [(2, "Mom's birthday dinner"), (12, "Family BBQ")]:
            s = today + dt.timedelta(days=offset, hours=18)
            events.append(Event(calendar=family, name=name, category=6, location="Home",
                                startdate=s, enddate=s + dt.timedelta(hours=3)))
        Event.objects.bulk_create(events)
        self.stdout.write(f"Calendars: 7, events: {len(events)}")

    # ------------------------------------------------------------------ todos
    def _todos(self, amol, rng):
        now = dt.datetime.now(TZ)
        spec = [
            ("Finish V1 security pass", 12, -1, None),
            ("Pay rent", 3, 0, None),
            ("Reply to recruiter", 2, 2, None),
            ("Plan platform loader", 11, 5, None),
            ("Read OSTEP ch. 26", 3, 9, None),
            ("Renew passport", 1, None, None),
            ("Backup NAS", 100, -3, -2),
            ("Submit A3", 100, -6, -6),
            ("Write tests for sync", 13, 3, None),
        ]
        parent = None
        for name, status, due_days, done_days in spec:
            t = Todo.objects.create(
                user=amol, name=name, status=status, priority=rng.randint(0, 20),
                description=rng.choice([None, "Some details\nhttps://example.com/ticket/42"]),
                complete_by=None if due_days is None else (now + dt.timedelta(days=due_days)).replace(hour=23, minute=59),
                completed=done_days is not None,
                completed_on=None if done_days is None else now + dt.timedelta(days=done_days),
                percent_complete=rng.choice([None, 25, 50, 80]),
                time_spent=rng.choice([None, 30, 90]),
            )
            if name == "Plan platform loader":
                parent = t
        for sub in ("Lock file format", "Dependency ordering", "Failure modes"):
            Todo.objects.create(user=amol, parent=parent, name=sub, status=3,
                                complete_by=now + dt.timedelta(days=4))
        self.stdout.write("Todos: 12 (incl. overdue, due today, subtasks, completed)")

    # ------------------------------------------------------------------ places
    def _places(self, users):
        fav = LocationGroup.objects.create(name="Favourites", owner=users["amol"], description="Go-to spots")
        food = LocationGroup.objects.create(name="Food", owner=users["amol"], is_public=True)
        LocationGroup.objects.create(name="Alex's places", owner=users["alex"])
        spots = [
            (fav, "Home", "house", 43.4723, -80.5449, 5, "Waterloo, ON"),
            (fav, "Davis Centre", "university", 43.4723, -80.5422, 4, "200 University Ave W"),
            (fav, "Waterloo Park", "park", 43.4669, -80.5313, 5, ""),
            (fav, "Union Station", "transit", 43.6453, -79.3806, 3, "65 Front St W, Toronto"),
            (food, "Lazeez", "restaurant", 43.4729, -80.5373, 4, "170 University Ave W"),
            (food, "Farm Boy", "shop", 43.4985, -80.5277, 4, ""),
            (food, "Conestoga Mall", "mall", 43.4986, -80.5280, 3, ""),
        ]
        for group, name, category, lat, lng, rating, address in spots:
            Location.objects.create(group=group, name=name, category=category, latitude=lat,
                                    longitude=lng, rating=rating, address=address, notes="Dummy place")
        self.stdout.write(f"Places: {len(spots)} in 2 groups")

    # ------------------------------------------------------------------ photos
    def _photos(self, users, limit, rng):
        from photos.indeximg import photo_ingest_for_album
        from photos.models import refresh_photo_location_cache

        amol, alex = users["amol"], users["alex"]
        for name, source in PHOTO_SOURCES.items():
            if not source.is_dir():
                self.stderr.write(f"Skipping {name}: {source} not found")
                continue
            location = f"{settings.PHOTOS_ROOT}{name}/"
            album, created = Album.objects.get_or_create(
                name=name, owner=amol, defaults={"location": location, "split": True}
            )
            if created:
                Album_Subscriber.objects.create(album=album, user=amol, subscribe_type=0)
                if name == "Phone":
                    Album_Subscriber.objects.create(album=album, user=alex, subscribe_type=2)
            # V1's ingest only scans one folder down (Ingest/<batch>/file), like the server.
            ingest = Path(location) / "Ingest" / source.name
            ingest.mkdir(parents=True, exist_ok=True)
            files = sorted(p for p in source.iterdir() if p.is_file() and not p.name.startswith("."))
            if limit:
                files = files[:limit]
            for f in files:
                target = ingest / f.name
                if not target.exists():
                    try:
                        os.link(f, target)  # no copy; deleting the link never touches the original
                    except OSError:
                        shutil.copy2(f, target)
            self.stdout.write(f"Ingesting {len(files)} files into album {name} …")
            photo_ingest_for_album(album, amol, refresh_matviews=False)
        refresh_photo_location_cache()

        photos = list(Photo.objects.filter(video=False).order_by("?")[:40])
        if photos and not ShareAlbum.objects.exists():
            highlights = ShareAlbum.objects.create(owner=amol, name="Highlights", description="Best of")
            trip = ShareAlbum.objects.create(owner=amol, name="Public trip", public=True)
            for i, p in enumerate(photos):
                ShareAlbum_Photo.objects.create(sharealbum=highlights if i % 2 else trip, photo=p)
            ShareAlbum_Subscriber.objects.create(album=highlights, user=alex, subscribe_type=2)
        self.stdout.write(self.style.SUCCESS(f"Photos: {Photo.objects.count()} indexed"))
