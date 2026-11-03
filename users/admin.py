from django.contrib import admin
from django.db import models
import django.contrib.auth.forms
from django.contrib.auth.admin import UserAdmin
from .models import *

# Register your models here.
class CTUAdmin(UserAdmin):
    search_fields = ('id', 'username', 'first_name', 'last_name', 'email')
    
    fieldsets = UserAdmin.fieldsets + (
        ("Other", {
            'fields': ('birthday', 'timezone', 'profile_picture', 'dark_mode', 'description', 'friends', 'user_groups', 'newuser',),
        }),
    )


admin.site.register(ComptechUser, CTUAdmin)
admin.site.register(UserGroup)
admin.site.register(FriendRequest)