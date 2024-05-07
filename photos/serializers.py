from rest_framework import serializers
from notifications.models import Notification

class NotificationSerializer(serializers.Serializer):
    class Meta:
        model = Notification
        fields = ['id', 'user', 'title', 'source', 'description', 'created_on', 'priority', 'device_group', 'read']
