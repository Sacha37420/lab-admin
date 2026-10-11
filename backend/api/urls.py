from django.urls import path
from .views import (
    AppSpecPublicView, InfrastructureView, AdminToolsView,
    LabUserGroupsView, LabUserCreateView,
    CatalogSyncView, DebugTestListView, DebugRunView, DebugJobStatusView,
)

urlpatterns = [
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
