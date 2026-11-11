from django.urls import path
from .views import AppSpecPublicView, AdminToolsView, LabUserGroupsView, LabUserCreateView, SpecLinkView

# Toutes ces vues sont réservées au groupe `admins` (permission par défaut, config/settings.py),
# SAUF celles de MEMBER_ROUTES, qui déclarent elles-mêmes leur permission (IsLabMember) et ne
# rendent que les lignes de l'appelant. api/tests.py tient cet inventaire.
MEMBER_ROUTES = frozenset({'spec-links/<str:app>/'})

urlpatterns = [
    path('apps/public/',      AppSpecPublicView.as_view()),
    path('tools/',            AdminToolsView.as_view()),
    path('lab-users/groups/', LabUserGroupsView.as_view()),
    path('lab-users/',        LabUserCreateView.as_view()),
    path('spec-links/<str:app>/', SpecLinkView.as_view()),
]
