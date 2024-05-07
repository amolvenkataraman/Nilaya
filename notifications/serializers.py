from notifications.models import Notification
from rest_framework import serializers

class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'user', 'title', 'source', 'description', 'created_on', 'priority', 'device_group', 'expires_on', 'read']
        read_only_fields = ['id', 'created_on']