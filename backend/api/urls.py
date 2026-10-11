from django.urls import path
from .views import AppSpecPublicView, AdminToolsView, LabUserGroupsView, LabUserCreateView

# Toutes ces vues sont réservées au groupe `admins` (permission par défaut, config/settings.py).
urlpatterns = [
    path('apps/public/',      AppSpecPublicView.as_view()),
    path('tools/',            AdminToolsView.as_view()),
    path('lab-users/groups/', LabUserGroupsView.as_view()),
    path('lab-users/',        LabUserCreateView.as_view()),
]
