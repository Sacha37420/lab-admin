from rest_framework import serializers
from .models import DebugTest, DebugRunJob


class DebugTestSerializer(serializers.ModelSerializer):
    class Meta:
        model = DebugTest
        fields = [
            'id', 'app', 'file', 'title',
            'last_status', 'last_message', 'last_run_at', 'last_duration_ms',
        ]


class DebugRunJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = DebugRunJob
        fields = [
            'id', 'scope_app', 'status', 'progress', 'message',
            'created_at', 'updated_at',
        ]
