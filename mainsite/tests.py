from django.test import SimpleTestCase, override_settings

from .apps import site_settings_check


class SiteSettingsCheckTests(SimpleTestCase):
    def test_warns_only_while_production_has_the_example_hosts(self):
        with override_settings(DEBUG=False, ALLOWED_HOSTS=["example.com", "localhost"]):
            self.assertEqual([w.id for w in site_settings_check(None)], ["mainsite.W001"])
        with override_settings(DEBUG=False, ALLOWED_HOSTS=["app.home.lan", "localhost"]):
            self.assertEqual(site_settings_check(None), [])


class ApiSchemaTests(SimpleTestCase):
    def test_committed_schema_matches_the_api(self):
        from .management.commands.api_schema import OUTPUT, render

        # Not assertEqual: a diff of the ~500 KB file says less than the fix does.
        self.assertTrue(OUTPUT.read_text() == render(), f"{OUTPUT} is stale: run `make api-types`")
