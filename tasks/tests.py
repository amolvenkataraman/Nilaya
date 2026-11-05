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
