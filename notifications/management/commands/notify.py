"""Send a notification from scripts / cron:  manage.py notify amol "Backup done" --body "3.2 GB" --priority high"""

from django.core.management.base import BaseCommand, CommandError

from notifications.service import Priority, notify
from users.models import ComptechUser


class Command(BaseCommand):
    help = "Send a notification to a user (saved in the bell menu and pushed to their channels)."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("title")
        parser.add_argument("--body", default="")
        parser.add_argument("--source", default="Server")
        parser.add_argument("--url", default="", help="in-app link, e.g. /photos/")
        parser.add_argument("--priority", default="normal", choices=[p.name.lower() for p in Priority])

    def handle(self, username, title, body, source, url, priority, **options):
        user = ComptechUser.objects.filter(username=username).first()
        if user is None:
            raise CommandError(f"No user {username!r}")
        n = notify(user, title, body, source=source, url=url, priority=Priority[priority.upper()])
        self.stdout.write(f"Sent notification {n.id} to {username}")
