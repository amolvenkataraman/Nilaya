from django.http.response import JsonResponse
from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from .models import *

# Create your views here.
@login_required
def chat(request, dm_id=0):
    friends = [i.getinfo() for i in request.user.friends.all()]
    dms = [i.dm.getinfo() for i in DMUser.objects.filter(user_id=request.user.id)]
    fr_out = [i.getinfo() for i in FriendRequest.objects.filter(fromuser=request.user)]
    fr_in = [i.getinfo() for i in FriendRequest.objects.filter(touser=request.user)]
    return render(request, 'chat/chat.html', {"friends": friends, "dms": dms, "dm_id": dm_id, "fr_out": fr_out, "fr_in": fr_in})

@login_required
def friend_request(request):
    pass

@login_required
def messages(request):
    if not request.user.is_authenticated:
        ans = []
    else:
        dm_id = request.GET.get("dm")
        if dm_id == None:
            ans = []
        else:
            try:
                dm = DirectMessage.objects.filter(id=dm_id)[0]
                ans = [i.getinfo() for i in Message.objects.filter(dm=dm)]
            except IndexError:
                ans = []
    
    return JsonResponse({"messages": ans})
