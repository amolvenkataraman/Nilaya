from django.http.response import JsonResponse
from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from .models import *
import datetime

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
        message_timestamp = request.GET.get("timestamp")
        if dm_id == None:
            ans = []
        else:
            try:
                dm = DirectMessage.objects.filter(id=dm_id)[0]
                if message_timestamp == None:
                    ans = [i.getinfo() for i in Message.objects.filter(dm=dm).order_by('-sent_time')[:50]]
                else:
                    mt = datetime.datetime.strptime(message_timestamp, '%Y-%m-%dT%H:%M:%S.%fZ')
                    ans = [i.getinfo() for i in Message.objects.filter(dm=dm, sent_time__lt=message_timestamp).order_by('-sent_time')[:50]]
            except IndexError:
                ans = []
    
    return JsonResponse({"messages": ans})
