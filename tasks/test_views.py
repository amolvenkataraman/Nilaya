import json
import re

from django.test import TestCase

from users.models import ComptechUser


class TasksPageTests(TestCase):
    def test_anonymous_is_sent_to_login(self):
        r = self.client.get("/tasks/")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/accounts/login/", r["Location"])

    def test_page_boots_the_app_with_the_signed_in_user(self):
        user = ComptechUser.objects.create_user("tess", password="pw", first_name="Tess", last_name="Ter")
        self.client.force_login(user)
        r = self.client.get("/tasks/")
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("tasks/tasks.js", html)
        boot = json.loads(re.search(r'<script id="tk-boot" type="application/json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(boot["me"]["username"], "tess")
        self.assertEqual(boot["me"]["name"], "Tess Ter")
        self.assertEqual(r.context["left_sidebar"], True)
