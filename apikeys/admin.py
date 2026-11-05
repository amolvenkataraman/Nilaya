from django.contrib import admin

from .models import ApiKey


@admin.register(ApiKey)
class ApiKeyAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "prefix", "created_on", "last_used_on", "expires_on")
    search_fields = ("name", "user__username", "prefix")
    readonly_fields = ("prefix", "hashed", "created_on", "last_used_on", "last_used_ip")
