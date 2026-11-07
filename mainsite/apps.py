from django.apps import AppConfig
from django.core import checks


class MainsiteConfig(AppConfig):
    name = 'mainsite'

    def ready(self):
        checks.register(site_settings_check, checks.Tags.compatibility)


def site_settings_check(app_configs, **kwargs):
    """Warn (manage.py check / migrate) when a production server still has the repo's example.com defaults."""
    from django.conf import settings
    if settings.DEBUG or not any(h == "example.com" or h.endswith(".example.com") for h in settings.ALLOWED_HOSTS):
        return []
    return [checks.Warning(
        "Site settings not found: the site only answers to example.com (every other host gets 400 Bad Request).",
        hint=f"Create {settings.SECRETS_DIR / 'site.json'} (docs/UPGRADE-phase-1.md, 'Site settings').",
        id="mainsite.W001")]
