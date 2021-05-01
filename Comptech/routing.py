from django.urls import re_path

from chat import consumers as chat_consumers
from gamevault.scrabble import consumers as scrabble_consumers

websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<dm_id>\w+)/$', chat_consumers.ChatConsumer.as_asgi()),
    re_path(r'ws/games/scrabble/(?P<game_id>\w+)/(?P<option>\w+)/$', scrabble_consumers.ScrabbleConsumer.as_asgi()),
]