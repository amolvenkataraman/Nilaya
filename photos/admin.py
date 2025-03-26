from django.contrib import admin
from .models import *

class PhotoAdmin(admin.ModelAdmin):
    ordering = ('-date_taken',)

# Register your models here.
admin.site.register(Photo, PhotoAdmin)
admin.site.register(Album)
admin.site.register(Album_Subscriber)
