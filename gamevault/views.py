from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.http import Http404
from .models import *

# Create your views here.
@login_required
def gamevault(request):
    return render(request, "gamevault/gamevault.html")

@login_required
def scrabble(request):
    return render(request, "games/scrabble.html")

@login_required
def game(request, game_code):
    try:
        game = Game.objects.filter(code=game_code)[0]
        return render(request, f"games/{game_code}.html")
    except IndexError:
        raise Http404()
