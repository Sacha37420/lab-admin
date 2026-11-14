"""Tests de lab-admin — cloisonnement par vue (contrat multi-dev, I6).

Lancer — le rôle `lab` de lab-admin ne peut pas créer de base de test : on lui
donne un PostgreSQL jetable, le temps des tests.

    docker network create lab-admin-test-net
    docker run -d --rm --name lab-admin-test-pg --network lab-admin-test-net \\
      -e POSTGRES_USER=essai -e POSTGRES_PASSWORD=essai -e POSTGRES_DB=essai \\
      --tmpfs /var/lib/postgresql/data postgres:16-alpine
    docker run --rm --env-file lab-admin/.env --network lab-admin-test-net \\
      -e DB_HOST=lab-admin-test-pg -e DB_NAME=essai -e DB_USER=essai -e DB_PASSWORD=essai \\
      -v "$PWD/lab-admin/backend:/app:ro" -w /app lab-admin-backend \\
      python manage.py test api
    docker stop lab-admin-test-pg && docker network rm lab-admin-test-net

lab-admin laisse entrer deux groupes (`admins`, `developers`) mais son backend
n'a qu'UNE vue pour les non-admins — `spec-links/<app>/` (chantier
app-builder-v2, I8), qui ne rend que les lignes de l'appelant : l'interface des
développeurs parle au moteur (/mcp/api). Ces tests tiennent cette propriété
(``DefaultDenyTests`` pour l'inventaire, ``SpecLinkTests`` pour la vue ouverte).

Les identités sont posées par ``force_authenticate`` sur un vrai
``KeycloakUser`` ; ``RealTokenGateTests`` repasse en plus par
``KeycloakJWTAuthentication`` avec des jetons RS256 signés par une clé locale
(seul le téléchargement du JWKS est remplacé).
"""
from __future__ import annotations

import os
import shutil
import tempfile
import time
from unittest import mock

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.test import TestCase, override_settings
from django.urls import URLPattern
from rest_framework.test import APIClient

from . import lab_groups, urls as api_urls
from .authentication import KeycloakJWTAuthentication, KeycloakUser
from .models import SpecLink

ADMINS = ['admins', 'developers']
DEVELOPERS = ['developers']


def client_for(uid: str, groups: list[str]) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=KeycloakUser({
        'preferred_username': uid, 'email': f'{uid}@ssolab.local',
        'groups': groups, 'azp': 'lab-admin',
    }))
    return c


def _sample_path(pattern: URLPattern) -> str:
    return '/api/' + str(pattern.pattern).replace('<int:pk>', '1').replace('<str:app>', 'mon-app')


# Plus aucune vue hors JWT : CatalogSyncView (secret partagé) est partie avec la page Debug.
SHARED_SECRET: set[str] = set()


class DefaultDenyTests(TestCase):
    """Un jeton `developers` sans `admins` prend 403 sur CHAQUE endpoint —
    inventaire tiré de api/urls.py, pas d'une liste écrite ici."""

    def setUp(self) -> None:
        self.sacha = client_for('sacha', ADMINS)
        self.e2e = client_for('e2e_member', ADMINS)
        self.hassan = client_for('hassan', DEVELOPERS)

    def test_every_endpoint_refuses_a_non_admin(self):
        checked = []
        for pattern in api_urls.urlpatterns:
            route = str(pattern.pattern)
            if route in SHARED_SECRET or route in api_urls.MEMBER_ROUTES:
                continue
            path = _sample_path(pattern)
            for method in ('get', 'post', 'put', 'patch', 'delete'):
                with self.subTest(route=route, method=method):
                    resp = getattr(self.hassan, method)(path, {}, format='json')
                    self.assertEqual(resp.status_code, 403, f'{method.upper()} {path}')
            checked.append(route)
        # L'inventaire couvre bien tout ce qui existait, et rien n'a été ouvert.
        self.assertEqual(len(checked), len(api_urls.urlpatterns) - len(SHARED_SECRET) - len(api_urls.MEMBER_ROUTES))
        # Les routes ouvertes aux membres : EXACTEMENT celles-ci, chacune avec sa permission déclarée.
        self.assertEqual(sorted(api_urls.MEMBER_ROUTES), ['spec-links/<str:app>/'])
        from .permissions import IsLabMember
        for pattern in api_urls.urlpatterns:
            if str(pattern.pattern) in api_urls.MEMBER_ROUTES:
                self.assertEqual(pattern.callback.view_class.permission_classes, [IsLabMember])
        # Routes retirées (sans appelant, ou passées au moteur) : elles ne doivent pas revenir.
        for gone in ('me/', 'users/', 'departments/', 'infrastructure/', 'debug/tests/', 'debug/run/',
                     'debug/jobs/1/', 'debug/catalog-sync/'):
            self.assertNotIn(gone, checked)
            self.assertEqual(self.sacha.get('/api/' + gone).status_code, 404)
        # L'inventaire EXACT du backend : toute route ajoutée ou retirée doit passer par ici.
        self.assertEqual(sorted(checked), ['apps/public/', 'lab-users/', 'lab-users/groups/', 'tools/'])
        # Routes retirées (sans appelant, ou passées au moteur) : elles ne doivent pas revenir.
        for gone in ('me/', 'users/', 'departments/', 'infrastructure/', 'debug/tests/', 'debug/run/',
                     'debug/jobs/1/', 'debug/catalog-sync/'):
            self.assertNotIn(gone, checked)
            self.assertEqual(self.sacha.get('/api/' + gone).status_code, 404)

    def test_user_creation_is_refused_before_touching_keycloak(self):
        with mock.patch('api.views.keycloak_admin') as kc:
            resp = self.hassan.post('/api/lab-users/', {
                'username': 'intrus', 'first_name': 'I', 'last_name': 'N',
                'email': 'intrus@example.org', 'groups': ['admins'],
            }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(kc.mock_calls, [])

    def test_user_without_any_group_claim_is_refused(self):
        self.assertEqual(client_for('ghost', []).get('/api/tools/').status_code, 403)

    def test_admins_keep_everything(self):
        for c in (self.sacha, self.e2e):
            for path in ('/api/tools/',):
                with self.subTest(path=path):
                    self.assertEqual(c.get(path).status_code, 200, path)

    def test_no_view_outside_the_token_check(self):
        # L'ancien point d'entrée à secret partagé n'existe plus, avec ou sans en-tête.
        anon = APIClient()
        resp = anon.post('/api/debug/catalog-sync/', {'app': 'x', 'tests': []},
                         format='json', HTTP_X_SETUP_KEY='k' * 32)
        self.assertEqual(resp.status_code, 404)

    def test_anonymous_gets_nothing(self):
        anon = APIClient()
        for path in ('/api/tools/', '/api/apps/public/', '/api/lab-users/groups/'):
            self.assertIn(anon.get(path).status_code, (401, 403), path)


# ── Verrou 2 réel : jetons signés, groupes `admins,developers` ─────────────────

_RSA = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _LocalJwks:
    """Remplace le TÉLÉCHARGEMENT du JWKS de Keycloak par une clé locale. Tout
    le reste de KeycloakJWTAuthentication (signature, exp, azp, groupes, email)
    s'exécute réellement."""

    class _Key:
        key = _RSA.public_key()

    def get_signing_key_from_jwt(self, token):
        return self._Key()


def token(uid: str, groups, azp: str = 'lab-admin') -> str:
    return jwt.encode({
        'preferred_username': uid, 'groups': groups, 'azp': azp,
        'email': f'{uid}@ssolab.local', 'exp': int(time.time()) + 300,
    }, _RSA, algorithm='RS256')


@override_settings(KEYCLOAK_REQUIRED_GROUPS='admins,developers', KEYCLOAK_CLIENT_ID='lab-admin')
class RealTokenGateTests(TestCase):

    def setUp(self) -> None:
        patcher = mock.patch.object(KeycloakJWTAuthentication, '_get_jwks_client',
                                    classmethod(lambda cls: _LocalJwks()))
        patcher.start()
        self.addCleanup(patcher.stop)

    def get(self, path: str, tok: str):
        return APIClient().get(path, HTTP_AUTHORIZATION=f'Bearer {tok}')

    def test_developer_passes_the_door_and_reaches_nothing(self):
        tok = token('hassan', ['developers', 'amis'])
        for path in ('/api/tools/', '/api/lab-users/groups/', '/api/apps/public/'):
            with self.subTest(path=path):
                resp = self.get(path, tok)
                self.assertEqual(resp.status_code, 403)
                # Refusé par la permission par vue, pas par la porte.
                self.assertIn('administrateurs', resp.json()['detail'])

    def test_admin_keeps_admin_views(self):
        tok = token('sacha', ['admins', 'developers'])
        self.assertEqual(self.get('/api/tools/', tok).status_code, 200)

    def test_other_groups_do_not_enter(self):
        for groups in (['famille'], [], None):
            with self.subTest(groups=groups):
                resp = self.get('/api/tools/', token('lea', groups))
                self.assertEqual(resp.status_code, 403)
                self.assertIn('groupe(s)', resp.json()['detail'])

    def test_foreign_client_token_is_refused(self):
        # admin-cli : client public du realm, password grant — le contrôle azp.
        for azp in ('admin-cli', 'lab-mcp', 'storage'):
            with self.subTest(azp=azp):
                tok = token('sacha', ['admins', 'developers'], azp=azp)
                self.assertEqual(self.get('/api/tools/', tok).status_code, 403)

    def test_forged_signature_is_refused(self):
        other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        forged = jwt.encode({'preferred_username': 'sacha', 'groups': ['admins'],
                             'azp': 'lab-admin', 'email': 's@x',
                             'exp': int(time.time()) + 300}, other, algorithm='RS256')
        self.assertEqual(self.get('/api/tools/', forged).status_code, 403)


# ── F10 (chantier failles) : pgAdmin et phpLDAPadmin par tunnel SSH ──────────

class AdminToolsTunnelTests(TestCase):
    """5050 et 8081 sont liés à 127.0.0.1 : plus de carte « Ouvrir » vers l'IP LAN,
    une indication de tunnel SSH, servie aux seuls `admins`."""

    @override_settings(SERVER_URL_LAN='http://192.168.1.20', KEYCLOAK_PUBLIC_URL='https://lab.example/kc',
                       KEYCLOAK_REALM='ssolab')
    def test_admin_gets_the_tunnel_not_the_dead_links(self):
        resp = client_for('sacha', ADMINS).get('/api/tools/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        # Keycloak 26 : Caddy ne sert plus la console d'administration — aucune carte vers elle.
        self.assertEqual(body['tools'], [])
        self.assertNotIn('/console/', resp.content.decode())
        self.assertNotIn('192.168.1.20:5050', resp.content.decode())
        self.assertNotIn('192.168.1.20:8081', resp.content.decode())
        self.assertEqual(body['tunnel']['command'],
                         'ssh -L 5050:127.0.0.1:5050 -L 8081:127.0.0.1:8081 <utilisateur>@192.168.1.20')
        self.assertEqual(body['tunnel']['urls'],
                         {'pgAdmin': 'http://localhost:5050', 'phpLDAPadmin': 'http://localhost:8081'})

    def test_server_placeholder_when_lan_url_is_unknown(self):
        for lan in ('', 'http://localhost', 'http://CHANGE_ME'):
            with self.subTest(lan=lan), override_settings(SERVER_URL_LAN=lan):
                cmd = client_for('sacha', ADMINS).get('/api/tools/').json()['tunnel']['command']
                self.assertTrue(cmd.endswith(' <utilisateur>@<serveur>'), cmd)

    def test_developer_without_admins_does_not_see_the_tunnel(self):
        resp = client_for('hassan', DEVELOPERS).get('/api/tools/')
        self.assertEqual(resp.status_code, 403)
        self.assertNotIn('tunnel', resp.content.decode())
        self.assertNotIn('5050', resp.content.decode())


# ── Dossier `deploiement/` : une app y vit, ou à la racine (contrat v5) ────────

_COMPOSE = '''services:
  backend:
    labels:
      caddy.handle_path: "/{path}-api/*"
  frontend:
    labels:
      caddy.handle_path: "/{path}/*"
'''


class AppLocationTests(TestCase):
    """`deploiement/<app>` s'il existe, sinon `<app>` à la racine — sur de
    vrais dossiers temporaires, pour les deux emplacements."""

    def setUp(self) -> None:
        self.root = tempfile.mkdtemp(prefix='labroot-')
        self.addCleanup(shutil.rmtree, self.root, True)

        def app(rel: str, path: str, groups: str | None) -> None:
            d = os.path.join(self.root, rel)
            os.makedirs(d)
            with open(os.path.join(d, 'docker-compose.yml'), 'w') as f:
                f.write(_COMPOSE.format(path=path))
            if groups is not None:
                with open(os.path.join(d, '.keycloak-client-opts'), 'w') as f:
                    f.write(f'--public --port 1 --caddy-path {path} --require-group {groups}')

        app('ancienne', 'ancienne', 'famille')                       # restée à la racine
        app('deploiement/nouvelle', 'nouvelle', 'developers,amis')   # née dans deploiement/
        app('demenagee', 'vieux-chemin', 'admins')                   # présente aux DEUX endroits :
        app('deploiement/demenagee', 'demenagee', 'developers')      #   deploiement/ fait foi
        os.makedirs(os.path.join(self.root, 'deploiement', 'sans-compose'))
        p = mock.patch.object(lab_groups, '_DEV_ROOT', self.root)
        p.start()
        self.addCleanup(p.stop)

    def test_app_dir_rule(self):
        self.assertEqual(lab_groups.app_dir('ancienne'), os.path.join(self.root, 'ancienne'))
        self.assertEqual(lab_groups.app_dir('nouvelle'), os.path.join(self.root, 'deploiement', 'nouvelle'))
        self.assertEqual(lab_groups.app_dir('demenagee'), os.path.join(self.root, 'deploiement', 'demenagee'))
        for bad in ('..', '../evil', 'a/b', '', '.env', None):
            with self.subTest(name=bad):
                self.assertFalse(os.path.exists(lab_groups.app_dir(bad)))

    def test_required_groups_reads_both_locations(self):
        self.assertEqual(lab_groups.app_required_groups(), {
            'ancienne': ['famille'],
            'nouvelle': ['developers', 'amis'],
            'demenagee': ['developers'],
        })
        self.assertEqual(lab_groups.groups_required_by()['developers'], ['demenagee', 'nouvelle'])
        # Le dossier `deploiement` lui-même n'est jamais pris pour une app.
        self.assertNotIn('deploiement', lab_groups.app_names())

    def test_groups_endpoint_serves_both_locations_to_an_admin(self):
        # Page « Nouvel utilisateur » : groupes de Keycloak (compte de service, remplacé ici) et
        # apps lues sur disque, aux deux emplacements.
        with mock.patch('api.views.keycloak_admin.all_groups', return_value=[
                {'id': '1', 'name': 'developers'}, {'id': '2', 'name': 'famille'}]):
            data = client_for('sacha', ADMINS).get('/api/lab-users/groups/').json()
        self.assertEqual([a['name'] for a in data['apps']], ['ancienne', 'demenagee', 'nouvelle'])
        by = {g['name']: g['required_by'] for g in data['groups']}
        self.assertEqual(by['developers'], ['demenagee', 'nouvelle'])
        self.assertEqual(by['famille'], ['ancienne'])


# ── Création d'utilisateur : le mot de passe ne revient que si l'email n'est pas parti ──

@override_settings(EMAIL_HOST='smtp.exemple.org', DEFAULT_FROM_EMAIL='lab@exemple.org',
                   EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class UserCreationPasswordTests(TestCase):
    """Lot 2 : email parti ⇒ aucune clé `password` dans la réponse ; sinon elle y est,
    et c'est bien le mot de passe posé dans Keycloak."""

    BODY = {'username': 'nouveau', 'first_name': 'N', 'last_name': 'U',
            'email': 'nouveau@exemple.org', 'groups': ['famille']}

    def setUp(self) -> None:
        p = mock.patch('api.views.keycloak_admin')
        self.kc = p.start()
        self.addCleanup(p.stop)
        self.kc.find_user_by_username.return_value = None
        self.kc.find_user_by_email.return_value = None
        self.kc.all_groups.return_value = [{'id': 'g1', 'name': 'famille'}]
        self.kc.create_user.return_value = 'uid-1'
        self.admin = client_for('sacha', ADMINS)

    def _set_password(self) -> str:
        (_, pwd), kwargs = self.kc.set_password.call_args
        self.assertEqual(kwargs, {'temporary': False})
        return pwd

    def test_email_sent_means_no_password_in_response(self):
        from django.core import mail
        resp = self.admin.post('/api/lab-users/', self.BODY, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertTrue(data['email_sent'])
        self.assertIsNone(data['email_error'])
        self.assertNotIn('password', data)
        # Le mot de passe est parti par email, et nulle part ailleurs dans la réponse.
        pwd = self._set_password()
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(pwd, mail.outbox[0].body)
        self.assertNotIn(pwd, resp.content.decode())

    def test_email_failure_returns_the_password(self):
        with mock.patch('api.views.send_mail', side_effect=OSError('connexion refusée')):
            resp = self.admin.post('/api/lab-users/', self.BODY, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertFalse(data['email_sent'])
        self.assertIn('connexion refusée', data['email_error'])
        self.assertEqual(data['password'], self._set_password())

    @override_settings(EMAIL_HOST='')
    def test_smtp_not_configured_returns_the_password(self):
        from django.core import mail
        resp = self.admin.post('/api/lab-users/', self.BODY, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertFalse(data['email_sent'])
        self.assertEqual(data['password'], self._set_password())
        self.assertEqual(len(mail.outbox), 0)


# ── I8 (chantier app-builder-v2) : lien projet ↔ spécification ────────────────

FP_A = 'sha256:' + 'a' * 64
FP_B = 'sha256:' + '0123456789abcdef' * 4


class SpecLinkTests(TestCase):
    """`/api/spec-links/<app>/` : ouverte à la porte (`admins`, `developers`), et
    chacun n'y lit et n'y écrit que SES lignes (clé : l'email du jeton)."""

    def setUp(self) -> None:
        self.hassan = client_for('hassan', DEVELOPERS)
        self.alice = client_for('alice', DEVELOPERS)
        self.sacha = client_for('sacha', ADMINS)

    def put(self, c: APIClient, app: str, body):
        return c.put(f'/api/spec-links/{app}/', body, format='json')

    def test_member_writes_then_reads_his_link(self):
        resp = self.put(self.hassan, 'gestion-stock', {'spec_id': 12, 'fingerprint': FP_A})
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual({k: body[k] for k in ('app', 'spec_id', 'fingerprint')},
                         {'app': 'gestion-stock', 'spec_id': 12, 'fingerprint': FP_A})
        created_at = body['created_at']
        got = self.hassan.get('/api/spec-links/gestion-stock/')
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.json(), body)
        # Remplacement (après un envoi au projet) : 200, même ligne, date de création gardée.
        again = self.put(self.hassan, 'gestion-stock', {'spec_id': 12, 'fingerprint': FP_B})
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()['fingerprint'], FP_B)
        self.assertEqual(again.json()['created_at'], created_at)
        self.assertEqual(SpecLink.objects.count(), 1)
        # Empreinte vide (App Builder sans `fingerprint`) ou absente : acceptée, rien à comparer.
        for body in ({'spec_id': 12, 'fingerprint': ''}, {'spec_id': 12}, {'spec_id': 12, 'fingerprint': None}):
            with self.subTest(body=body):
                resp = self.put(self.hassan, 'gestion-stock', body)
                self.assertEqual(resp.status_code, 200)
                self.assertEqual(resp.json()['fingerprint'], '')

    def test_admin_is_a_member_too(self):
        self.assertEqual(self.put(self.sacha, 'mon-app', {'spec_id': 3}).status_code, 201)
        self.assertEqual(self.sacha.get('/api/spec-links/mon-app/').status_code, 200)

    def test_no_link_is_404(self):
        resp = self.hassan.get('/api/spec-links/gestion-stock/')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()['error'], 'not_found')

    def test_lines_of_others_are_invisible_and_untouchable(self):
        self.assertEqual(self.put(self.hassan, 'gestion-stock', {'spec_id': 12, 'fingerprint': FP_A}).status_code, 201)
        # Un autre membre, un admin : rien à lire.
        for c in (self.alice, self.sacha):
            self.assertEqual(c.get('/api/spec-links/gestion-stock/').status_code, 404)
        # Écrire « le même » projet crée SA ligne, sans toucher à celle de hassan.
        self.assertEqual(self.put(self.alice, 'gestion-stock', {'spec_id': 99, 'fingerprint': FP_B}).status_code, 201)
        mine = self.hassan.get('/api/spec-links/gestion-stock/').json()
        self.assertEqual((mine['spec_id'], mine['fingerprint']), (12, FP_A))
        self.assertEqual(self.alice.get('/api/spec-links/gestion-stock/').json()['spec_id'], 99)
        # Un champ `owner_email` dans le corps n'y change rien.
        self.put(self.alice, 'autre-app', {'spec_id': 5, 'owner_email': 'hassan@ssolab.local'})
        self.assertEqual(self.hassan.get('/api/spec-links/autre-app/').status_code, 404)
        self.assertEqual(SpecLink.objects.filter(owner_email='hassan@ssolab.local').count(), 1)

    def test_non_members_are_refused(self):
        for c in (client_for('lea', ['famille']), client_for('ghost', [])):
            for method in ('get', 'put'):
                with self.subTest(method=method):
                    resp = getattr(c, method)('/api/spec-links/gestion-stock/', {'spec_id': 1}, format='json')
                    self.assertEqual(resp.status_code, 403)
        # Un jeton sans email (porte franchie) n'écrit pas une ligne au nom de personne.
        c = APIClient()
        c.force_authenticate(user=KeycloakUser({'preferred_username': 'x', 'groups': DEVELOPERS, 'azp': 'lab-admin'}))
        self.assertEqual(self.put(c, 'gestion-stock', {'spec_id': 1}).status_code, 403)
        self.assertIn(APIClient().get('/api/spec-links/gestion-stock/').status_code, (401, 403))
        self.assertEqual(SpecLink.objects.count(), 0)

    def test_invalid_values_are_400(self):
        bad_apps = ['Gestion', '1app', '-app', 'a' * 64, 'app_x', 'app%0A', 'app.x']
        for app in bad_apps:
            with self.subTest(app=app):
                self.assertEqual(self.put(self.hassan, app, {'spec_id': 1}).status_code, 400)
                self.assertEqual(self.hassan.get(f'/api/spec-links/{app}/').status_code, 400)
        # Le plus long nom admis passe.
        self.assertEqual(self.put(self.hassan, 'a' * 63, {'spec_id': 1}).status_code, 201)
        bad_bodies = [
            {}, {'spec_id': 0}, {'spec_id': -3}, {'spec_id': '12'}, {'spec_id': 1.5}, {'spec_id': True},
            {'spec_id': None}, {'spec_id': 2 ** 31},
            {'spec_id': 1, 'fingerprint': 'sha256:' + 'A' * 64},
            {'spec_id': 1, 'fingerprint': 'sha256:' + 'a' * 63},
            {'spec_id': 1, 'fingerprint': 'sha256:' + 'a' * 64 + '\n'},
            {'spec_id': 1, 'fingerprint': 'md5:' + 'a' * 32},
            {'spec_id': 1, 'fingerprint': 42},
        ]
        for body in bad_bodies:
            with self.subTest(body=body):
                resp = self.put(self.hassan, 'gestion-stock', body)
                self.assertEqual(resp.status_code, 400)
                self.assertEqual(resp.json()['error'], 'invalid')
        self.assertEqual(self.hassan.put('/api/spec-links/gestion-stock/', '[1]', content_type='application/json').status_code, 400)
        self.assertFalse(SpecLink.objects.filter(app='gestion-stock').exists())

    def test_other_methods_are_refused(self):
        for method in ('post', 'patch', 'delete'):
            with self.subTest(method=method):
                self.assertEqual(getattr(self.hassan, method)('/api/spec-links/gestion-stock/', {'spec_id': 1},
                                                              format='json').status_code, 405)


@override_settings(KEYCLOAK_REQUIRED_GROUPS='admins,developers', KEYCLOAK_CLIENT_ID='lab-admin')
class SpecLinkRealTokenTests(TestCase):
    """La même vue, derrière la vraie classe d'authentification."""

    def setUp(self) -> None:
        patcher = mock.patch.object(KeycloakJWTAuthentication, '_get_jwks_client',
                                    classmethod(lambda cls: _LocalJwks()))
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, method: str, tok: str, body=None):
        return getattr(APIClient(), method)('/api/spec-links/gestion-stock/', body, format='json',
                                            HTTP_AUTHORIZATION=f'Bearer {tok}')

    def test_developer_token_reaches_his_link(self):
        tok = token('hassan', ['developers'])
        self.assertEqual(self.call('put', tok, {'spec_id': 12, 'fingerprint': FP_A}).status_code, 201)
        self.assertEqual(self.call('get', tok).json()['spec_id'], 12)
        self.assertEqual(SpecLink.objects.get().owner_email, 'hassan@ssolab.local')

    def test_outsiders_and_foreign_clients_do_not(self):
        self.assertEqual(self.call('get', token('lea', ['famille'])).status_code, 403)
        for azp in ('admin-cli', 'app-builder'):
            with self.subTest(azp=azp):
                self.assertEqual(self.call('put', token('hassan', ['developers'], azp=azp), {'spec_id': 1}).status_code, 403)
        self.assertEqual(SpecLink.objects.count(), 0)


# ── Une exception `requests` porte l'URL demandée : jamais dans un message rendu ──

@override_settings(KEYCLOAK_ISSUER_URI='http://keycloak:8080/realms/ssolab',
                   KEYCLOAK_ADMIN_BASE_URL='http://keycloak:8080',
                   KEYCLOAK_ADMIN_CLIENT_ID='lab-admin-admin',
                   KEYCLOAK_ADMIN_CLIENT_SECRET='secret-de-test')
class KeycloakAdminErrorMessageTests(TestCase):
    """`KeycloakAdminError` est rendue telle quelle à la page (`{'error': str(exc)}`) :
    son texte ne doit pas reprendre celui de l'exception `requests`, qui contient l'URL."""

    URL = 'http://keycloak:8080/admin/realms/ssolab/users?email=marqueur-url'

    def setUp(self) -> None:
        from . import keycloak_admin
        self.kc = keycloak_admin
        p = mock.patch.dict(keycloak_admin._token_cache, {'value': '', 'exp': 0.0})
        p.start()
        self.addCleanup(p.stop)

    def _unreachable(self):
        return self.kc.requests.ConnectionError(f'Max retries exceeded with url: {self.URL}')

    def test_token_error_does_not_carry_the_url(self):
        with mock.patch.object(self.kc.requests, 'post', side_effect=self._unreachable()):
            with self.assertRaises(self.kc.KeycloakAdminError) as ctx:
                self.kc._token()
        self.assertIn('Keycloak injoignable', str(ctx.exception))
        self.assertNotIn('marqueur-url', str(ctx.exception))

    def test_admin_call_error_does_not_carry_the_url(self):
        with mock.patch.object(self.kc, '_token', return_value='jeton'), \
                mock.patch.object(self.kc.requests, 'request', side_effect=self._unreachable()):
            with self.assertRaises(self.kc.KeycloakAdminError) as ctx:
                self.kc.all_groups()
        self.assertIn('Appel Keycloak échoué', str(ctx.exception))
        self.assertNotIn('marqueur-url', str(ctx.exception))
