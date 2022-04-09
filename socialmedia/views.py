from django.shortcuts import render, HttpResponse
from .models import *

# Create your views here.
def home(request):
    return render(request, "socialmedia/home.html", {"posts": [i.getinfo() for i in Post.objects.all()]})
