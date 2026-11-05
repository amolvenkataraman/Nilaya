from django.contrib import admin

from notifications.models import Notification, NotificationChannel


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "source", "priority", "read", "created_on")
    list_filter = ("read", "source", "priority")
    search_fields = ("title", "description", "user__username")


@admin.register(NotificationChannel)
class NotificationChannelAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "user", "enabled", "min_priority", "last_sent_at", "last_error")
    list_filter = ("kind", "enabled")


from .models import ReminderSettings  # noqa: E402
admin.site.register(ReminderSettings)
