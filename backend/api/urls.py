from django.urls import path
from .views import (
    MeView, DepartmentListView, UserListView,
    AppSpecPublicView, InfrastructureView, AdminToolsView,
    LabUserGroupsView, LabUserCreateView,
)

urlpatterns = [
    path('me/',               MeView.as_view()),
    path('departments/',      DepartmentListView.as_view()),
    path('users/',            UserListView.as_view()),
    path('apps/public/',      AppSpecPublicView.as_view()),
    path('infrastructure/',   InfrastructureView.as_view()),
    path('tools/',            AdminToolsView.as_view()),
    path('lab-users/groups/', LabUserGroupsView.as_view()),
    path('lab-users/',        LabUserCreateView.as_view()),
]
