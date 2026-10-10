"""Permissions de lab-admin.

Depuis le contrat multi-dev v4, deux groupes passent la porte de lab-admin
(``KEYCLOAK_REQUIRED_GROUPS=admins,developers``, contrôlé dans
``api/authentication.py``) : le groupe ne suffit donc plus à dire « admin ».
``IsLabAdmin`` est la permission PAR DÉFAUT (``config/settings.py``) : toute vue
qui ne déclare rien reste réservée à ``admins``.
"""
from django.conf import settings
from rest_framework.permissions import BasePermission


def user_groups(user) -> set[str]:
    claims = getattr(user, 'claims', None) or {}
    groups = claims.get('groups') or []
    return {g for g in groups if isinstance(g, str)}


class IsLabAdmin(BasePermission):
    """Authentifié ET membre d'un groupe d'administration (``admins``)."""

    message = "Réservé aux administrateurs du lab (groupe 'admins')."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not getattr(user, 'is_authenticated', False):
            return False
        return bool(user_groups(user) & settings.LAB_ADMIN_GROUPS)
