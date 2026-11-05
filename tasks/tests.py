"""Tasks: quick-add parsing, recurring, kanban done-sync, WIP limits, sharing roles, Inbox."""

import datetime
from datetime import datetime as _dt

dt_parse = _dt.fromisoformat

import pytz
from django.test import TestCase

from scheduler.models import Todo
from users.models import ComptechUser

from .service import parse_quick_add

TZ = pytz.timezone("America/Toronto")
NOW = TZ.localize(datetime.datetime(2026, 11, 4, 21, 0))  # a Wednesday evening


class QuickAddTests(TestCase):
    def test_tokens_dates_and_repeats(self):
        cases = {
            "Pay rent tomorrow 5pm *bills +Home !3 every month":
                ("Pay rent", "2026-11-05 17:00", ["bills"], "Home", 15, 2, None),
            'Buy milk *"grocery run" +"Side Projects"': ("Buy milk", None, ["grocery run"], "Side Projects", None, 0, None),
            "Call mom fri": ("Call mom", "2026-11-06 23:59", [], None, None, 0, None),
            "Dentist Nov 20 at 3:30pm": ("Dentist", "2026-11-20 15:30", [], None, None, 0, None),
            "Ship at 8pm": ("Ship", "2026-11-05 20:00", [], None, None, 0, None),  # past today -> tomorrow
            "Gym every 2 days": ("Gym", "2026-11-04 23:59", [], None, None, 1, 172800),
            "Just a title": ("Just a title", None, [], None, None, 0, None),
            "Call grandma tonight": ("Call grandma", "2026-11-04 20:00", [], None, None, 0, None),
        }
        for text, (title, due, labels, project, prio, mode, every) in cases.items():
            with self.subTest(text=text):
                r = parse_quick_add(text, TZ, NOW)
                self.assertEqual((r["title"], r["due"] and r["due"].strftime("%Y-%m-%d %H:%M"), r["labels"], r["project"],
                                  r["priority"], r["repeat_mode"], r["repeat_every"]),
                                 (title, due, labels, project, prio, mode, every))


class TaskApiTests(TestCase):
    def setUp(self):
        self.owner = ComptechUser.objects.create_user("own", password="pw")
        self.other = ComptechUser.objects.create_user("oth", password="pw")
        self.client.force_login(self.owner)

    def post(self, path, body=None, user=None):
        if user:
            self.client.force_login(user)
        return self.client.post(f"/api/v2/tasks/{path}", body or {}, content_type="application/json")

    def test_creator_loses_edit_rights_when_made_read_only(self):
        from .models import ProjectMember
        p = self.post("projects", {"name": "Shared"}).json()
        ProjectMember.objects.create(project_id=p["id"], user=self.other, role=ProjectMember.Role.WRITE)
        t = self.post("", {"title": "Mine", "project_id": p["id"]}, user=self.other).json()
        ProjectMember.objects.filter(project_id=p["id"], user=self.other).update(role=ProjectMember.Role.READ)
        r = self.client.patch(f"/api/v2/tasks/{t['id']}", {"title": "Changed"}, content_type="application/json")
        self.assertIn(r.status_code, (403, 404))

    def test_import_keeps_completion_and_creation_dates(self):
        p = self.post("projects", {"name": "From Vikunja"}).json()
        t = self.post("", {"title": "Old done task", "project_id": p["id"], "done": True, "done_at": "2025-03-04T10:00:00Z",
                           "created_at": "2025-02-01T09:00:00Z", "end": "2025-03-05T10:00:00Z", "ref": "vikunja:#12"}).json()
        self.assertEqual((t["done"], t["done_at"][:10], t["created_on"][:10], t["ref"]), (True, "2025-03-04", "2025-02-01", "vikunja:#12"))
        self.assertEqual(self.client.get("/api/v2/tasks/overview").json()["done_today"], 0)  # history isn't "done today"
        r = self.client.patch(f"/api/v2/tasks/{t['id']}", {"done_at": "2025-03-06T10:00:00Z"}, content_type="application/json").json()
        self.assertEqual(r["done_at"][:10], "2025-03-06")
        bad = self.post("", {"title": "Future", "done": True, "done_at": "2999-01-01T00:00:00Z"})
        self.assertEqual(bad.status_code, 400)

    def test_orphan_todos_land_in_the_inbox(self):
        Todo.objects.create(user=self.owner, name="From the calendar")
        inbox = self.client.get("/api/v2/tasks/overview").json()["inbox_id"]
        self.assertEqual(str(Todo.objects.get().project_id), inbox)

    def test_reorder_and_quick_add_into_a_column(self):
        p = self.post("projects", {"name": "Board"}).json()
        todo, doing, done = self.client.get(f"/api/v2/tasks/projects/{p['id']}/buckets").json()
        q = self.post("quick", {"text": "Fix bug tomorrow !3", "project_id": p["id"], "bucket_id": doing["id"]}).json()
        self.assertEqual((q["bucket_id"], q["priority"]), (doing["id"], 15))
        a, b = self.post("", {"title": "A", "project_id": p["id"]}).json(), self.post("", {"title": "B", "project_id": p["id"]}).json()
        self.post(f"projects/{p['id']}/reorder", {"ids": [b["id"], q["id"], a["id"]]})
        order = [t["title"] for t in self.client.get(f"/api/v2/tasks/?project={p['id']}&sort=position").json()["items"]]
        self.assertEqual(order, ["B", "Fix bug", "A"])

    def test_overview_can_include_projects_labels_and_views(self):
        self.post("labels", {"name": "home"})
        r = self.client.get("/api/v2/tasks/overview?include=projects,labels,views").json()
        self.assertEqual((len(r["projects"]), [l["name"] for l in r["labels"]], r["views"]), (1, ["home"], []))
        self.assertNotIn("projects", self.client.get("/api/v2/tasks/overview").json())

    def test_done_after_filter(self):
        t = self.post("", {"title": "Ship it", "percent": 40, "time_spent": 30}).json()
        self.assertEqual((t["percent"], t["time_spent"]), (40, 30))
        self.post(f"{t['id']}/done")
        self.assertEqual(self.client.get("/api/v2/tasks/?done=true&done_after=2000-01-01T00:00:00Z").json()["total"], 1)
        self.assertEqual(self.client.get("/api/v2/tasks/?done=true&done_after=2999-01-01T00:00:00Z").json()["total"], 0)
        self.assertEqual(self.client.get("/api/v2/tasks/overview").json()["done_today"], 1)

    def test_repeating_task_moves_forward_and_stays_open(self):
        due = "2026-11-04T09:00:00+00:00"
        t = self.post("", {"title": "Water plants", "due": due, "repeat_mode": 1, "repeat_every": 86400}).json()
        r = self.post(f"{t['id']}/done").json()
        self.assertTrue(r["repeated"])
        self.assertFalse(r["task"]["done"])
        self.assertGreater(r["task"]["due"], due)
        undone = self.client.post(f"/api/v2/tasks/{t['id']}/done?done=false").json()  # Undo puts the dates back
        self.assertEqual(dt_parse(undone["task"]["due"]), dt_parse(due))
        self.assertEqual(self.post("", {"title": "Someday", "priority": 0}).json()["priority_label"], "None")

    def test_done_column_sync_and_wip_limit(self):
        p = self.post("projects", {"name": "Reno"}).json()
        todo, doing, done = self.client.get(f"/api/v2/tasks/projects/{p['id']}/buckets").json()
        a = self.post("", {"title": "A", "project_id": p["id"]}).json()
        b = self.post("", {"title": "B", "project_id": p["id"]}).json()
        self.assertTrue(self.post(f"{a['id']}/move", {"bucket_id": done["id"]}).json()["done"])
        self.assertEqual(self.post(f"{a['id']}/done?done=false").json()["task"]["bucket_id"], todo["id"])
        self.client.patch(f"/api/v2/tasks/buckets/{doing['id']}", {"limit": 1}, content_type="application/json")
        self.assertEqual(self.post(f"{a['id']}/move", {"bucket_id": doing["id"]}).status_code, 200)
        self.assertEqual(self.post(f"{b['id']}/move", {"bucket_id": doing["id"]}).status_code, 400)
        self.post("", {"title": "sub", "project_id": p["id"], "parent_id": a["id"], "bucket_id": doing["id"]})
        self.client.patch(f"/api/v2/tasks/buckets/{doing['id']}", {"limit": 2}, content_type="application/json")
        self.assertEqual(self.post(f"{b['id']}/move", {"bucket_id": doing["id"]}).status_code, 200)  # subtasks don't count

    def test_sharing_roles(self):
        p = self.post("projects", {"name": "Family"}).json()
        self.assertEqual(p["owner"]["username"], "own")
        t = self.post("", {"title": "Groceries", "project_id": p["id"], "description": "<b>milk</b> & eggs"}).json()
        self.assertEqual(t["description"], "milk &amp; eggs")
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(f"/api/v2/tasks/{t['id']}").status_code, 404)
        self.post(f"projects/{p['id']}/members", {"username": "oth", "role": 0}, user=self.owner)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(f"/api/v2/tasks/{t['id']}").status_code, 200)
        patch = lambda: self.client.patch(f"/api/v2/tasks/{t['id']}", {"title": "x"}, content_type="application/json")
        self.assertEqual(patch().status_code, 403)
        self.post(f"projects/{p['id']}/members", {"username": "oth", "role": 1}, user=self.owner)
        self.client.force_login(self.other)
        self.assertEqual(patch().status_code, 200)
        self.assertEqual(self.client.delete(f"/api/v2/tasks/projects/{p['id']}").status_code, 403)

    def test_relations_are_stored_both_ways_and_cycles_are_refused(self):
        a = self.post("", {"title": "A"}).json()
        b = self.post("", {"title": "B", "parent_id": a["id"]}).json()
        self.post(f"{a['id']}/relations", {"other_id": b["id"], "kind": "blocks"})
        self.assertEqual(self.client.get(f"/api/v2/tasks/{b['id']}").json()["relations"][0]["kind"], "blocked_by")
        r = self.client.patch(f"/api/v2/tasks/{a['id']}", {"parent_id": b["id"]}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        listed = {t["id"]: t["relation_count"] for t in self.client.get("/api/v2/tasks/?done=false").json()["items"]}
        self.assertEqual((listed[a["id"]], listed[b["id"]]), (1, 1))


class NullPatchTests(TestCase):
    def test_null_for_a_required_field_is_ignored_not_a_500(self):
        user = ComptechUser.objects.create_user("nul", password="pw")
        self.client.force_login(user)
        post = lambda path, body: self.client.post(path, body, content_type="application/json").json()
        task = post("/api/v2/tasks/", {"title": "T"})["id"]
        group = post("/api/v2/places/groups", {"name": "G"})["id"]
        place = post("/api/v2/places/", {"group_id": group, "name": "P", "latitude": 1, "longitude": 2})["id"]
        cal = post("/api/v2/calendar/calendars", {"name": "C"})["id"]
        event = post("/api/v2/calendar/events", {"calendar_id": cal, "name": "E", "start": "2026-11-05T15:00:00Z"})["id"]
        for path, field in ((f"/api/v2/tasks/{task}", "title"), (f"/api/v2/tasks/{task}", "priority"),
                            (f"/api/v2/places/groups/{group}", "name"), (f"/api/v2/places/{place}", "latitude"),
                            (f"/api/v2/calendar/events/{event}", "name"), ("/api/v2/me", "first_name")):
            with self.subTest(path=path, field=field):
                self.assertEqual(self.client.patch(path, {field: None}, content_type="application/json").status_code, 200)
        self.assertEqual(Todo.objects.get(id=task).name, "T")
        self.assertEqual(self.client.post(f"/api/v2/calendar/events/{event}/duplicate?days=99999999").status_code, 400)


class SharingFixTests(TestCase):
    """Review fixes: project nesting, per-user labels, assignees, view-only writes, removed members."""

    def setUp(self):
        from .models import ProjectMember
        self.Role = ProjectMember.Role
        self.owner = ComptechUser.objects.create_user("own", password="pw")
        self.other = ComptechUser.objects.create_user("oth", password="pw")
        self.client.force_login(self.owner)
        self.project = self.api("post", "projects", {"name": "Shared"}).json()

    def api(self, method, path, body=None, user=None):
        self.client.force_login(user or self.owner)
        return getattr(self.client, method)(f"/api/v2/tasks/{path}", body or {}, content_type="application/json")

    def share(self, role):
        from .models import ProjectMember
        ProjectMember.objects.update_or_create(project_id=self.project["id"], user=self.other, defaults={"role": role})

    def test_admin_cannot_nest_the_owners_project_and_deleting_a_parent_keeps_others_subprojects(self):
        from .models import Project
        self.share(self.Role.ADMIN)
        mine = self.api("post", "projects", {"name": "Admin's"}, user=self.other).json()
        r = self.api("patch", f"projects/{self.project['id']}", {"parent_id": mine["id"]}, user=self.other)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.api("patch", f"projects/{self.project['id']}", {"parent_id": mine["id"]}).status_code, 404)
        legacy = Project.objects.create(owner=self.other, name="Inside", parent_id=self.project["id"])  # made before the fix
        self.api("delete", f"projects/{self.project['id']}")
        self.assertIsNone(Project.objects.get(id=legacy.id).parent_id)

    def test_a_sharee_setting_labels_keeps_the_owners_labels(self):
        self.share(self.Role.WRITE)
        mine = self.api("post", "labels", {"name": "urgent"}).json()
        theirs = self.api("post", "labels", {"name": "later"}, user=self.other).json()
        t = self.api("post", "", {"title": "T", "project_id": self.project["id"], "labels": [mine["id"]]}).json()
        r = self.api("patch", t["id"], {"labels": [theirs["id"]]}, user=self.other).json()
        self.assertEqual(sorted(r["labels"]), sorted([mine["id"], theirs["id"]]))

    def test_assignees_must_be_project_members_and_can_unassign_themselves(self):
        t = self.api("post", "", {"title": "T", "project_id": self.project["id"]}).json()
        self.assertEqual(self.api("patch", t["id"], {"assignees": ["oth"]}).status_code, 400)
        loose = self.api("post", "", {"title": "Mine", "assignees": ["oth"]})
        self.assertEqual(loose.status_code, 400)
        self.share(self.Role.READ)
        self.assertEqual(self.api("patch", t["id"], {"assignees": ["oth"]}).status_code, 200)
        self.assertEqual(self.api("post", f"{t['id']}/unassign", user=self.other).status_code, 204)
        self.assertEqual(self.api("get", t["id"]).json()["assignees"], [])

    def test_view_only_cannot_add_relations_subtasks_or_comments_and_hidden_titles_stay_hidden(self):
        t = self.api("post", "", {"title": "Owner's", "project_id": self.project["id"]}).json()
        secret = self.api("post", "", {"title": "Secret"}).json()
        self.api("post", f"{t['id']}/relations", {"other_id": secret["id"], "kind": "related"})
        self.share(self.Role.READ)
        own = self.api("post", "", {"title": "Theirs"}, user=self.other).json()
        self.assertEqual(self.api("post", f"{own['id']}/relations", {"other_id": t["id"], "kind": "blocks"},
                                  user=self.other).status_code, 403)
        self.assertEqual(self.api("post", "", {"title": "Sub", "parent_id": t["id"]}, user=self.other).status_code, 403)
        self.assertEqual(self.api("post", f"{t['id']}/comments", {"body": "hi"}, user=self.other).status_code, 403)
        rel = self.api("get", t["id"], user=self.other).json()["relations"][0]
        self.assertEqual((rel["other_name"], rel["other_visible"]), ("Private task", False))
        self.assertEqual(self.api("get", t["id"]).json()["relations"][0]["other_name"], "Secret")

    def test_a_removed_member_stops_seeing_tasks_they_created(self):
        from .models import ProjectMember
        self.share(self.Role.WRITE)
        t = self.api("post", "", {"title": "Theirs", "project_id": self.project["id"]}, user=self.other).json()
        ProjectMember.objects.filter(user=self.other).delete()
        self.assertEqual(self.api("get", t["id"], user=self.other).status_code, 404)
        self.assertNotIn(t["id"], [x["id"] for x in self.api("get", "?done=false", user=self.other).json()["items"]])


class RepeatAndInputTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("rep", password="pw", timezone="America/Toronto")
        self.client.force_login(self.user)

    def test_repeats_keep_the_day_of_month_and_the_wall_clock_time(self):
        from unittest import mock

        from . import service as svc
        local = lambda *a: TZ.localize(datetime.datetime(*a))

        def done_at(todo, now):
            with mock.patch.object(svc.timezone, "now", return_value=now):
                svc.set_done(todo, True)
            return todo.complete_by.astimezone(TZ).strftime("%Y-%m-%d %H:%M")

        monthly = Todo.objects.create(user=self.user, name="Rent", repeat_mode=2, complete_by=local(2026, 1, 31, 9))
        self.assertEqual(done_at(monthly, local(2026, 1, 31, 10)), "2026-02-28 09:00")
        self.assertEqual(done_at(monthly, local(2026, 2, 28, 10)), "2026-03-31 09:00")  # not Mar 28; EDT by now
        daily = Todo.objects.create(user=self.user, name="Walk", repeat_mode=1, repeat_every=86400,
                                    complete_by=local(2026, 3, 7, 9))
        self.assertEqual(done_at(daily, local(2026, 3, 7, 10)), "2026-03-08 09:00")  # DST starts Mar 8

    def test_a_repeating_task_dropped_in_done_moves_on_and_stays_open(self):
        post = lambda path, body=None: self.client.post(f"/api/v2/tasks/{path}", body or {}, content_type="application/json")
        p = post("projects", {"name": "Chores"}).json()
        todo, _, done = self.client.get(f"/api/v2/tasks/projects/{p['id']}/buckets").json()
        t = post("", {"title": "Bins", "project_id": p["id"], "due": "2026-11-04T09:00:00+00:00",
                      "repeat_mode": 1, "repeat_every": 604800}).json()
        moved = post(f"{t['id']}/move", {"bucket_id": done["id"]}).json()
        self.assertEqual((moved["done"], moved["bucket_id"]), (False, todo["id"]))
        self.assertGreater(moved["due"], t["due"])

    def test_out_of_range_numbers_are_refused_and_unknown_zones_fall_back(self):
        r = self.client.post("/api/v2/tasks/", {"title": "T", "time_spent": 40000}, content_type="application/json")
        self.assertEqual(r.status_code, 422)  # smallint column on Postgres
        ComptechUser.objects.filter(id=self.user.id).update(timezone="Mars/Olympus")
        r = self.client.post("/api/v2/tasks/quick", {"text": "Stretch every day"}, content_type="application/json")
        self.assertEqual(r.status_code, 201)
