from django.shortcuts import render

# Create your views here.
def flappyblock(request):
    return render(request, "games/flappyblock.html")
