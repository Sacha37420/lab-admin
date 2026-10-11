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
n'a AUCUNE vue pour les non-admins : l'interface des développeurs parle au
moteur (/mcp/api). Ces tests tiennent cette propriété.

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

from . import infra_info, lab_groups, urls as api_urls
from .authentication import KeycloakJWTAuthentication, KeycloakUser

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
    return '/api/' + str(pattern.pattern).replace('<int:pk>', '1')


# Seule vue hors JWT : secret partagé X-Setup-Key (scripts/setup_unit.sh).
SHARED_SECRET = {'debug/catalog-sync/'}


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
            if route in SHARED_SECRET:
                continue
            path = _sample_path(pattern)
            for method in ('get', 'post', 'put', 'patch', 'delete'):
                with self.subTest(route=route, method=method):
                    resp = getattr(self.hassan, method)(path, {}, format='json')
                    self.assertEqual(resp.status_code, 403, f'{method.upper()} {path}')
            checked.append(route)
        # L'inventaire couvre bien tout ce qui existait, et rien n'a été ouvert.
        self.assertEqual(len(checked), len(api_urls.urlpatterns) - len(SHARED_SECRET))
        # Routes sans appelant retirées (relecture du 2026-10-11) : elles ne doivent pas revenir.
        for gone in ('me/', 'users/', 'departments/'):
            self.assertNotIn(gone, checked)
            self.assertEqual(self.sacha.get('/api/' + gone).status_code, 404)
        for expected in ('apps/public/', 'infrastructure/',
                         'tools/', 'lab-users/groups/', 'lab-users/', 'debug/tests/',
                         'debug/run/', 'debug/jobs/<int:pk>/'):
            self.assertIn(expected, checked)

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
            for path in ('/api/tools/', '/api/infrastructure/', '/api/debug/tests/'):
                with self.subTest(path=path):
                    self.assertEqual(c.get(path).status_code, 200, path)

    def test_catalog_sync_still_uses_its_shared_secret(self):
        with override_settings(SETUP_CATALOG_KEY='k' * 32):
            anon = APIClient()
            refused = anon.post('/api/debug/catalog-sync/', {'app': 'x'}, format='json')
            self.assertEqual(refused.status_code, 403)
            ok = anon.post('/api/debug/catalog-sync/', {'app': 'x', 'tests': []},
                           format='json', HTTP_X_SETUP_KEY='k' * 32)
            self.assertEqual(ok.status_code, 200)

    def test_anonymous_gets_nothing(self):
        anon = APIClient()
        for path in ('/api/tools/', '/api/infrastructure/', '/api/lab-users/groups/'):
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
        for path in ('/api/tools/', '/api/infrastructure/',
                     '/api/lab-users/groups/', '/api/debug/tests/', '/api/apps/public/'):
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
        ports = os.path.join(self.root, '.ports')
        with open(ports, 'w') as f:
            f.write('ancienne:9001:9101\nnouvelle:9002:9102\ndemenagee:9003:9103\n'
                    'sans-compose:9004:9104\norpheline:9005:9105\n../evil:1:2\n')
        for target, attr, value in ((lab_groups, '_DEV_ROOT', self.root),
                                    (lab_groups, '_APP_DESCRIPTIONS', os.path.join(self.root, '.app-descriptions')),
                                    (infra_info, '_PORTS_FILE', ports)):
            p = mock.patch.object(target, attr, value)
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

    @override_settings(DOMAIN='lab.example.org')
    def test_hosted_apps_reads_both_locations(self):
        apps = {a['name']: a for a in infra_info.hosted_apps()}
        self.assertEqual(sorted(apps), ['ancienne', 'demenagee', 'nouvelle'])
        self.assertEqual(apps['ancienne']['frontend_url'], 'https://lab.example.org/ancienne/')
        self.assertEqual(apps['nouvelle']['frontend_url'], 'https://lab.example.org/nouvelle/')
        self.assertEqual(apps['nouvelle']['backend_url'], 'https://lab.example.org/nouvelle-api/')
        # Le compose de deploiement/ fait foi, pas la copie restée à la racine.
        self.assertEqual(apps['demenagee']['frontend_url'], 'https://lab.example.org/demenagee/')

    def test_endpoints_serve_both_locations_to_an_admin(self):
        sacha = client_for('sacha', ADMINS)
        names = [a['name'] for a in sacha.get('/api/infrastructure/').json()['apps']]
        self.assertEqual(sorted(names), ['ancienne', 'demenagee', 'nouvelle'])
