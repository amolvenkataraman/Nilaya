from django.shortcuts import render

# Create your views here.
def flappyblock(request):
    return render(request, "gamevault/flappyblock.html")

def ymca_game(request):
    return render(request, "gamevault/ymca_game.html")