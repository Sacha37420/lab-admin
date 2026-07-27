from rest_framework import serializers
from .models import Department, UserRecord, DebugTest, DebugRunJob


class DepartmentSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(source='members.count', read_only=True)

    class Meta:
        model = Department
        fields = ['id', 'name', 'description', 'member_count']


class UserRecordSerializer(serializers.ModelSerializer):
    department = DepartmentSerializer(read_only=True)

    class Meta:
        model = UserRecord
        fields = ['email', 'display_name', 'department', 'registered_at']


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
