import json
from asgiref.sync import async_to_sync, sync_to_async
from channels.generic.websocket import WebsocketConsumer, AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.sessions.models import Session
from chat.models import *
import datetime

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['dm_id']
        self.room_group_name = 'chat_%s' % self.room_name

        if (await sync_to_async(check_user_dm)(self.scope['user'].id, self.room_name) == True) or self.room_name == "0":
            # Join room group
            await self.channel_layer.group_add(
                self.room_group_name,
                self.channel_name
            )

            await self.accept()

    async def disconnect(self, close_code):
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    # Receive message from WebSocket
    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message = text_data_json['message'].lstrip().rstrip().replace("<script>", "").replace("</script>", "")

        # Send message to room group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'user': str(self.scope['user'].id),
                'username': self.scope['user'].username,
                'timestamp': str(datetime.datetime.now())
            }
        )

        await sync_to_async(create_message)(self.room_group_name.split("_")[1], message, self.scope['user'].id)

    # Receive message from room group
    async def chat_message(self, event):
        # Send message to WebSocket
        await self.send(text_data=json.dumps({
            'message': event['message'],
            'user': event['user'],
            'username': event['username'],
            'timestamp': event['timestamp']
        }))

def check_user_dm(user_id, dm_id):
    if dm_id == 0:
        return True
    
    try:
        _ =  DMUser.objects.filter(user_id=user_id, dm=DirectMessage.objects.filter(id=dm_id)[0])[0]
        return True
    except IndexError:
        return False

def create_message(user_id, msg, sent_by):
    msg = Message(dm=DirectMessage.objects.filter(id=user_id)[0], message=msg, sent_by=sent_by)
    msg.save()
