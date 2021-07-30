from django.contrib import admin
from .models import *

# Register your models here.
class EventAdmin(admin.ModelAdmin):
    ordering = ('-startdate',)

admin.site.register(Calendar)
admin.site.register(Event, EventAdmin)
admin.site.register(Invite)