from django.http import HttpResponse, FileResponse
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.forms import AuthenticationForm
from .forms import UserRegisterForm
from bg_images.views import *
from .models import *

# Views for login and logout

# Register a user or return the register page
def register_view(request):

    return render(request, 'users/register.html')

# Log a user in or return the login page
def login_view(request):
    error = ""
    if request.method == 'POST':
        form = AuthenticationForm(data=request.POST)
        if form.is_valid():
            username = form.get_user()
            login(request, username)
            if 'next' in request.POST:
                return redirect(request.POST.get('next'))
            else:
                return redirect('index')
        else:
            error = "Please enter a correct username and password. Note that both fields are case-sensitive."
    else:
        form = AuthenticationForm

    id_, description, location = get_random_image()
    return render(request, 'users/login.html', {'form': form, 'error': error, 'image': {'id': id_, 'description': description, 'location': location}})

# Log a user out and redirect to login
def logout_view(request):
    if request.method == 'POST':
        logout(request)
        return redirect('login')

#def profile_picture(request):
#    user_id = request.GET.get("user_id")
#    if user_id != None:
#        user = DocketUser.objects.filter(id=user_id)[0]
#        return FileResponse(user.profile_picture)