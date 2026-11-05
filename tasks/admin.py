from django.contrib import admin

from .models import Bucket, Comment, Label, Project, ProjectMember, Reminder, SavedView


class BucketInline(admin.TabularInline):
    model = Bucket
    extra = 0


class MemberInline(admin.TabularInline):
    model = ProjectMember
    extra = 0


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "is_inbox", "archived", "created_on")
    list_filter = ("is_inbox", "archived")
    search_fields = ("name", "owner__username")
    inlines = [BucketInline, MemberInline]


admin.site.register([Label, Reminder, Comment, SavedView])
