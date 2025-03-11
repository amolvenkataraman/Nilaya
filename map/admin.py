from django.contrib import admin
from .models import *

@admin.register(LocationGroup)
class LocationGroupAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'is_public')
    list_filter = ('is_public', 'owner')
    search_fields = ('name', 'description')
    ordering = ('name',)


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'group', 'rating')
    list_filter = ('category', 'group', 'rating')
    search_fields = ('name', 'description', 'address', 'notes')
    ordering = ('name',)
    fieldsets = (
        (None, {
            'fields': ('name', 'description', 'group')
        }),
        ('Location Details', {
            'fields': ('latitude', 'longitude', 'altitude', 'category', 'address')
        }),
        ('Additional Information', {
            'fields': ('rating', 'notes'),
            'classes': ('collapse',)
        }),
    )
