from django.contrib import admin
from .models import *

# Register your models here.
class EventAdmin(admin.ModelAdmin):
    ordering = ('-startdate',)
    list_display = ('name', 'calendar', 'kind', 'startdate', 'status', 'event_category')
    list_filter = ('kind', 'status')
    raw_id_fields = ('recurrence_parent', 'place', 'created_by', 'event_category')

admin.site.register(Calendar)
admin.site.register(Subscriber)
admin.site.register(Event, EventAdmin)
admin.site.register(Todo)
admin.site.register(Invite)
admin.site.register(EventCategory)
admin.site.register(EventReminder)
admin.site.register(EventAttendee)
admin.site.register(CalendarMigrationLog)
