import re
import secrets
import string

from django.conf import settings
from django.core.mail import send_mail
from rest_framework.views import APIView
from rest_framework import status
from rest_framework.response import Response
from . import keycloak_admin, lab_groups, infra_info
from .keycloak_admin import KeycloakAdminError
from .models import SpecLink
from .models_appbuilder import AppSpec as RemoteAppSpec
from .permissions import IsLabMember
from .serializers_appbuilder import serialize_appspec


class AppSpecPublicView(APIView):
    """
    GET /api/apps/public/ — catalogue app-builder (data models, endpoints, pages),
    tous propriétaires confondus. Lu directement dans le schéma 'app_builder' de
    la base du cadriciel (voir api/models_appbuilder.py) — plus d'appel HTTP à app-builder.
    """

    def get(self, request):
        specs = RemoteAppSpec.objects.using('app_builder').all()
        return Response([serialize_appspec(s) for s in specs])


class AdminToolsView(APIView):
    """GET /api/tools/ — outils d'administration : lien Keycloak, et l'indication de
    tunnel SSH pour pgAdmin et phpLDAPadmin (liés à la boucle locale de l'hôte).
    Permission par défaut ``IsLabAdmin`` : un `developers` sans `admins` prend 403."""

    def get(self, request):
        return Response({'tools': infra_info.admin_tools(), 'tunnel': infra_info.admin_tunnel()})


class LabUserGroupsView(APIView):
    """
    GET /api/lab-users/groups/ — groupes Keycloak disponibles, avec la liste
    des apps du lab qui les requièrent (pour le formulaire de création
    d'utilisateur). Miroir de la logique interactive de scripts/add-user.sh.
    """

    def get(self, request):
        required_by = lab_groups.groups_required_by()
        app_groups = lab_groups.app_required_groups()
        try:
            groups = keycloak_admin.all_groups()
        except KeycloakAdminError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({
            'groups': [
                {'id': g['id'], 'name': g['name'], 'required_by': required_by.get(g['name'], [])}
                for g in sorted(groups, key=lambda g: g['name'])
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

        body = {
            'username': username,
            'email': email,
            'groups': added_groups,
            'failed_groups': failed_groups,
            'base_url': base_url,
            'email_sent': email_sent,
            'email_error': email_error,
        }
        # Filet de sécurité si l'email n'est pas parti, et SEULEMENT dans ce cas :
        # le mot de passe est rendu une fois à l'admin, jamais ré-affichable
        # ensuite. Email parti ⇒ la clé est absente de la réponse (le titulaire
        # l'a reçu ; l'admin n'a pas à le voir transiter).
        if not email_sent:
            body['password'] = password
        return Response(body, status=status.HTTP_201_CREATED)


# ── Lien projet ↔ spécification App Builder (chantier app-builder-v2, I8) ─────────

# Nom de projet tel que le moteur et le runner l'acceptent. `\Z` et non `$` : `$` laisse
# passer un retour à la ligne final.
_APP_RE = re.compile(r'[a-z][a-z0-9-]{0,62}\Z')
_FINGERPRINT_RE = re.compile(r'sha256:[0-9a-f]{64}\Z')
_SPEC_ID_MAX = 2_147_483_647      # PositiveIntegerField


def _spec_link_body(link: SpecLink) -> dict:
    return {
        'app': link.app,
        'spec_id': link.spec_id,
        'fingerprint': link.fingerprint,
        'created_at': link.created_at.isoformat(),
    }


class SpecLinkView(APIView):
    """
    GET /api/spec-links/<app>/ — le lien de l'APPELANT pour ce projet, 404 s'il n'en a pas.
    PUT /api/spec-links/<app>/ — `{"spec_id": 12, "fingerprint": "sha256:…" | ""}` :
    crée (201) ou remplace (200) la ligne de l'appelant ; `created_at` est celle de la
    première écriture.

    Ouverte aux membres de la porte (``IsLabMember``, déclarée ici : la permission par
    défaut est ``IsLabAdmin``). L'appelant est identifié par l'email de son jeton et ne
    voit, n'écrit que SES lignes — un superutilisateur pas plus qu'un autre. Rien n'est
    vérifié auprès du moteur ni d'App Builder : un lien vers un projet qui n'est pas le
    sien, ou vers une spécification qui n'existe pas, ne donne accès à rien (l'interface
    relit tout avec le jeton de l'utilisateur).
    """

    permission_classes = [IsLabMember]
    http_method_names = ['get', 'put', 'head', 'options']

    @staticmethod
    def _owner(request) -> str:
        return request.user.email.strip().lower()

    @staticmethod
    def _bad_app(app: str):
        if _APP_RE.match(app):
            return None
        return Response({'error': 'invalid', 'detail': 'Nom de projet invalide.'},
                        status=status.HTTP_400_BAD_REQUEST)

    def get(self, request, app: str):
        bad = self._bad_app(app)
        if bad:
            return bad
        link = SpecLink.objects.filter(owner_email=self._owner(request), app=app).first()
        if link is None:
            return Response({'error': 'not_found', 'detail': 'Aucune spécification liée à ce projet.'},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(_spec_link_body(link))

    def put(self, request, app: str):
        bad = self._bad_app(app)
        if bad:
            return bad
        data = request.data
        if not isinstance(data, dict):
            return Response({'error': 'invalid', 'detail': 'Corps attendu : un objet JSON.'},
                            status=status.HTTP_400_BAD_REQUEST)
        errors = []
        spec_id = data.get('spec_id')
        # `bool` est un `int` en Python : `true` n'est pas un numéro de spécification.
        if isinstance(spec_id, bool) or not isinstance(spec_id, int) or not 0 < spec_id <= _SPEC_ID_MAX:
            errors.append('spec_id : entier positif attendu.')
        fingerprint = data.get('fingerprint', '')
        if fingerprint is None:
            fingerprint = ''
        if not isinstance(fingerprint, str) or (fingerprint and not _FINGERPRINT_RE.match(fingerprint)):
            errors.append('fingerprint : « sha256: » suivi de 64 chiffres hexadécimaux, ou vide.')
        if errors:
            return Response({'error': 'invalid', 'detail': ' '.join(errors)},
                            status=status.HTTP_400_BAD_REQUEST)
        link, created = SpecLink.objects.update_or_create(
            owner_email=self._owner(request), app=app,
            defaults={'spec_id': spec_id, 'fingerprint': fingerprint},
        )
        return Response(_spec_link_body(link),
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
