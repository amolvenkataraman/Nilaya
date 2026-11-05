from django.http import HttpResponse, FileResponse, JsonResponse
from django.shortcuts import render, redirect, Http404
from django.contrib.auth import login, logout, update_session_auth_hash
from django.contrib.auth.forms import AuthenticationForm, PasswordChangeForm
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import redirect_to_login
from django.db.models import Q
import uuid
from django.utils.http import url_has_allowed_host_and_scheme
from .models import *
from Comptech.utils import *
from django.conf import settings as _settings
MEDIA_ROOT = _settings.MEDIA_ROOT

from PIL import Image
import base64
import json
import io
import os
import bleach

# Views for login and logout

# Register a user or return the register page
def register_view(request):

    return render(request, 'users/register.html')

# Log a user in or return the login page
def login_view(request):
    error = ""
    status=200
    if request.method == 'POST':
        form = AuthenticationForm(data=request.POST)
        if form.is_valid():
            username = form.get_user()
            login(request, username)
            next_url = request.POST.get('next')
            if next_url and url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
                return redirect(next_url)
            return redirect('index')
        else:
            error = "Please enter a correct username and password. Note that both fields are case-sensitive."
            status=401
    else:
        form = AuthenticationForm

    return render(request, 'users/login.html', {'form': form, 'error': error}, status=status)

@login_required
def password_change_view(request):
    if request.method == 'POST':
        form = PasswordChangeForm(user=request.user, data=request.POST)
        if form.is_valid():
            user = form.save()
            update_session_auth_hash(request, user)  # changing the password must not log this device out
            return redirect('index')
    else:
        form = PasswordChangeForm(user=request.user)
    return render(request, 'users/reset_password.html', {'form': form})

# Render the user profile view
def profile_view(request, user=None):
    if request.method == 'GET':
        if not request.user.is_authenticated:  # profiles (birthday, groups, ...) are for members only
            return redirect_to_login(request.get_full_path())
        if user is None:
            user = request.user
        else:
            lookup = Q(username=user)
            try:
                lookup |= Q(id=uuid.UUID(user))
            except ValueError:
                pass
            user = ComptechUser.objects.filter(lookup).first()
            if user is None:
                raise Http404()
        return render(request, 'users/profile.html', {'user': user.getinfo()})

    elif request.method == 'POST':
        if request.user.is_authenticated:
            try:
                req = json.loads(request.body)
            except:
                return error_response("Malformed JSON. Can not decode.")

            try:
                user = request.user
                new_username = bleach.clean(req['username'].strip())
                if not new_username:
                    return error_response("Username can not be empty")
                if ComptechUser.objects.filter(username=new_username).exclude(id=user.id).exists():
                    return error_response("That username is already taken")
                user.first_name = bleach.clean(req['first_name'].lstrip().rstrip())
                user.last_name = bleach.clean(req['last_name'].lstrip().rstrip())
                user.username = new_username
                user.description = bleach.clean(req['description'].lstrip().rstrip())

                user.save()

                return success_response()

            except Exception as ex:
                return server_error(ex)

        else:
            return error_response("Not logged in", 401)

# Log a user out and redirect to login
def logout_view(request):
    if request.method != 'POST':  # never change state on GET (e.g. a link or <img> elsewhere)
        return redirect('index')
    logout(request)
    return redirect('login')

def profile_picture(request):
    if request.method == 'GET': # Slower method, only for compatibility. Use NGINX
        if not request.user.is_authenticated:
            return error_response("Not logged in", 401)
        username = request.GET.get('user')
        if username == None:
            user = request.user
        else:
            user = ComptechUser.objects.filter(username=username).first()
            if user is None:
                raise Http404()
        try:
            return FileResponse(user.profile_picture)
        except (ValueError, FileNotFoundError):
            return FileResponse(open(os.path.join(MEDIA_ROOT, 'profile_picture.png'), 'rb'))

    elif request.method == 'POST':
        if not request.user.is_authenticated:
            return error_response("Not logged in", 401)

        # Body is a data URL: "data:image/...;base64,<payload>"
        try:
            payload = request.body.decode('utf-8').split(';', 1)[1].split(',', 1)[1]
            img = Image.open(io.BytesIO(base64.b64decode(payload)))
            img.load()
        except Exception:
            return error_response("Invalid image")

        os.makedirs(f"{MEDIA_ROOT}/users/profile_pictures", exist_ok=True)
        filename = f"users/profile_pictures/{random_characters()}.jpg"
        # Re-encode so only real image data ever lands on disk
        img.convert('RGB').save(f"{MEDIA_ROOT}/{filename}", "JPEG", quality=90)
        request.user.profile_picture = filename
        request.user.save()
        return success_response()

def get_user_info(request):
    if request.user.is_authenticated:
        return JsonResponse(request.user.getinfo())
    else:
        return JsonResponse({"error": "Not logged in"})

