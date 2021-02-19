from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.forms import UserCreationForm
from .models import ComptechUser

# Customize the registration form
class UserRegisterForm(UserCreationForm):

    # Add email first name and last name
    class Meta:
        model = ComptechUser
        fields = ['username', 'first_name', 'last_name', 'password1', 'password2']
