from django.urls import re_path

from chat import consumers as chat_consumers

websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<dm_id>\w+)/$', chat_consumers.ChatConsumer.as_asgi()),
]