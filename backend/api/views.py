import secrets
import string

from django.conf import settings
from django.core.mail import send_mail
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework import generics, status
from rest_framework.response import Response
from .models import Department, UserRecord
from .serializers import DepartmentSerializer, UserRecordSerializer
from . import keycloak_admin, lab_groups, infra_info
from .keycloak_admin import KeycloakAdminError
from .models_appbuilder import AppSpec as RemoteAppSpec
from .serializers_appbuilder import serialize_appspec


class MeView(APIView):
    """
    permission_classes = [IsAuthenticated]
    GET /api/me/
    Retourne l'identité de l'utilisateur authentifié (depuis le JWT + DB).
    Crée un UserRecord à la première visite.
    """

    def get(self, request):
        email    = request.user.email
        username = request.user.username
        groups   = request.user.claims.get('groups', [])

        record, created = UserRecord.objects.get_or_create(
            email=email,
            defaults={'display_name': username},
        )

        return Response({
            'email':        email,
            'username':     username,
            'groups':       groups,
            'display_name': record.display_name,
            'department':   DepartmentSerializer(record.department).data
                            if record.department else None,
            'registered_at': record.registered_at,
            'is_new':        created,
        })


class DepartmentListView(generics.ListAPIView):
    """GET /api/departments/ — liste tous les départements."""

    queryset         = Department.objects.all()
    serializer_class = DepartmentSerializer


class UserListView(generics.ListAPIView):
    """GET /api/users/ — liste tous les utilisateurs enregistrés."""

    queryset         = UserRecord.objects.select_related('department')
    serializer_class = UserRecordSerializer


class AppSpecPublicView(APIView):
    """
    GET /api/apps/public/ — catalogue app-builder (data models, endpoints, pages),
    tous propriétaires confondus. Lu directement dans le schéma 'app_builder' de
    devdb (voir api/models_appbuilder.py) — plus d'appel HTTP à app-builder.
    """

    def get(self, request):
        specs = RemoteAppSpec.objects.using('app_builder').all()
        return Response([serialize_appspec(s) for s in specs])


class InfrastructureView(APIView):
    """GET /api/infrastructure/ — apps hébergées du lab (depuis .ports)."""

    def get(self, request):
        return Response({'apps': infra_info.hosted_apps()})


class AdminToolsView(APIView):
    """GET /api/tools/ — liens vers les outils d'administration (Keycloak, pgAdmin, phpLDAPadmin)."""

    def get(self, request):
        return Response({'tools': infra_info.admin_tools()})


class LabUserGroupsView(APIView):
    """
    GET /api/lab-users/groups/ — groupes Keycloak disponibles, avec la liste
    des apps du lab qui les requièrent (pour le formulaire de création
    d'utilisateur). Miroir de la logique interactive de scripts/add-user.sh.
    """

    def get(self, request):
        required_by = lab_groups.groups_required_by()
        app_groups = lab_groups.app_required_groups()
        hidden = lab_groups.hidden_groups()
        try:
            groups = keycloak_admin.all_groups()
        except KeycloakAdminError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({
            'groups': [
                {'id': g['id'], 'name': g['name'], 'required_by': required_by.get(g['name'], [])}
                for g in sorted(groups, key=lambda g: g['name'])
                if g['name'] not in hidden
            ],
            'apps': [
                {'name': app, 'required_groups': gs}
                for app, gs in sorted(app_groups.items())
            ],
        })


def _generate_password(length: int = 50) -> str:
    """Mot de passe alphanumérique aléatoire — même format que gen_pass() dans
    scripts/init-secrets.sh et scripts/add-user.sh."""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


class LabUserCreateView(APIView):
    """
    POST /api/lab-users/ — crée un nouvel utilisateur dans Keycloak/LDAP,
    l'assigne aux groupes choisis, lui envoie ses identifiants par email.

    Équivalent web de scripts/add-user.sh — même mécanisme (service account
    Keycloak, editMode=WRITABLE écrit dans le LDAP), même génération de mot
    de passe. Ne gère que la CRÉATION : si le nom d'utilisateur ou l'email
    existe déjà, retourne 409 sans rien modifier.

    Body attendu : {username, first_name, last_name, email, groups: [nom, ...]}
    """

    def post(self, request):
        data = request.data
        username = (data.get('username') or '').strip()
        first_name = (data.get('first_name') or '').strip()
        last_name = (data.get('last_name') or '').strip()
        email = (data.get('email') or '').strip()
        group_names = data.get('groups') or []

        if not username or not first_name or not last_name or not email:
            return Response(
                {'error': 'username, first_name, last_name et email sont requis.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if keycloak_admin.find_user_by_username(username):
                return Response(
                    {'error': f"Le nom d'utilisateur '{username}' existe déjà."},
                    status=status.HTTP_409_CONFLICT,
                )
            if keycloak_admin.find_user_by_email(email):
                return Response(
                    {'error': f"L'email '{email}' est déjà utilisé."},
                    status=status.HTTP_409_CONFLICT,
                )

            all_groups = {g['name']: g['id'] for g in keycloak_admin.all_groups()}
            unknown = [g for g in group_names if g not in all_groups]
            if unknown:
                return Response(
                    {'error': f"Groupe(s) inconnu(s) : {', '.join(unknown)}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            password = _generate_password()
            user_id = keycloak_admin.create_user(
                email=email, username=username, first_name=first_name, last_name=last_name,
            )
            keycloak_admin.set_password(user_id, password, temporary=False)

            added_groups, failed_groups = [], []
            for name in group_names:
                try:
                    keycloak_admin.add_user_to_group(user_id, all_groups[name])
                    added_groups.append(name)
                except KeycloakAdminError:
                    failed_groups.append(name)
        except KeycloakAdminError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        base_url = f'https://{settings.DOMAIN}' if settings.DOMAIN != 'CHANGE_ME' else settings.SERVER_URL_WAN
        email_sent, email_error = False, None
        if settings.EMAIL_HOST and settings.DEFAULT_FROM_EMAIL:
            try:
                send_mail(
                    subject='Votre accès au SSO Lab',
                    message=(
                        f"Bonjour {first_name},\n\n"
                        "Un compte vient d'être créé pour vous sur le SSO Lab.\n\n"
                        f"Adresse du serveur : {base_url or '(non configurée)'}\n"
                        f"Identifiant         : {username}\n"
                        f"Mot de passe        : {password}\n"
                        f"Groupes             : {', '.join(added_groups) or 'aucun'}\n\n"
                        "Conservez ce mot de passe en lieu sûr — vous pourrez le changer "
                        "une fois connecté.\n"
                    ),
                    from_email=f'{settings.SMTP_FROM_DISPLAY} <{settings.DEFAULT_FROM_EMAIL}>',
                    recipient_list=[email],
                    fail_silently=False,
                )
                email_sent = True
            except Exception as exc:  # SMTP peut échouer de multiples façons — jamais fatal ici
                email_error = str(exc)
        else:
            email_error = 'SMTP non configuré dans lab-admin/.env.'

        return Response({
            'username': username,
            'email': email,
            'groups': added_groups,
            'failed_groups': failed_groups,
            'base_url': base_url,
            # Filet de sécurité si l'email échoue : le mot de passe reste
            # visible une fois côté admin, jamais ré-affichable ensuite.
            'password': password,
            'email_sent': email_sent,
            'email_error': email_error,
        }, status=status.HTTP_201_CREATED)
