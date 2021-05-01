import json
from asgiref.sync import async_to_sync, sync_to_async
from channels.generic.websocket import WebsocketConsumer, AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.sessions.models import Session
from chat.models import *

class ScrabbleConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        if self.scope['user'].is_authenticated:
            self.room_name = self.scope['url_route']['kwargs']['game_id']
            self.room_group_name = 'scrabble_%s' % self.room_name

            if self.scope['url_route']['kwargs']['option'] == 'create':
                if self.room_group_name in self.channel_layer.groups:
                    await self.close()
                else:
                    # Join room group
                    await self.channel_layer.group_add(
                        self.room_group_name,
                        self.channel_name
                    )

                    await self.accept()

            elif self.scope['url_route']['kwargs']['option'] == 'join':
                if self.room_group_name in self.channel_layer.groups:
                    # Join room group
                    await self.channel_layer.group_add(
                        self.room_group_name,
                        self.channel_name
                    )

                    await self.accept()
                else:
                    await self.close(code=-11)

    async def disconnect(self, close_code):
        #if self.scope['url_route']['kwargs']['option'] == 'create':

        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    # Receive message from WebSocket
    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message = text_data_json['message'].lstrip().rstrip()

        # Send message to room group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'user': self.scope['user'].id,
                'username': self.scope['user'].username,
            }
        )

    # Receive message from room group
    async def chat_message(self, event):
        message = event['message']
        user = event['user']
        username = event['username']

        # Send message to WebSocket
        await self.send(text_data=json.dumps({
            'message': message,
            'user': user,
            'username': username,
        }))
