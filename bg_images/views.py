from django.shortcuts import render
from django.http import JsonResponse, FileResponse
from .models import *
import random

# Create your views here.
def get_random_image():
    image = random.choice(Bg_Image.objects.all())
    return image.id, image.description, image.location

def image(request):
    image_id = request.GET.get("id")
    if image_id != None:
        return FileResponse(Bg_Image.objects.filter(id=image_id)[0].image)