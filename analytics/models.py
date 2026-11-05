"""Usage per person, per app, per day: enough to see which apps matter before V2.
(Four family members use this; finer detail, if ever needed, is in the nginx logs.)"""

from django.conf import settings
from django.db import models


class Usage(models.Model):
    day = models.DateField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    app = models.CharField(max_length=24)  # calendar, tasks, photos, ... (first URL segment)
    page_views = models.PositiveIntegerField(default=0)
    api_calls = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("day", "user", "app")]
