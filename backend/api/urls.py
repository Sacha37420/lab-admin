from django.urls import path
from .views import (
    MeView, DepartmentListView, UserListView,
    AppSpecPublicView, InfrastructureView, AdminToolsView,
    LabUserGroupsView, LabUserCreateView,
    CatalogSyncView, DebugTestListView, DebugRunView, DebugJobStatusView,
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
    path('debug/catalog-sync/', CatalogSyncView.as_view()),
    path('debug/tests/',        DebugTestListView.as_view()),
    path('debug/run/',          DebugRunView.as_view()),
    path('debug/jobs/<int:pk>/', DebugJobStatusView.as_view()),
]
