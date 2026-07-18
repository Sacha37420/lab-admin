"""Apps hébergées (depuis .ports) et outils d'administration du lab.

``hosted_apps()`` est un port direct de l'ancienne ``InfrastructureView``
d'app-builder (lecture de ``.ports``, montée en lecture seule ici sous
``/mnt/ports`` — même fichier, non secret). ``admin_tools()`` calcule les
liens vers Keycloak / pgAdmin / phpLDAPadmin à partir de variables déjà
présentes dans le ``.env`` de cette app (``DOMAIN``, ``KEYCLOAK_HOSTNAME_URL`` —
jamais de dump brut d'un fichier ``.env``).
"""
from __future__ import annotations

from django.conf import settings

_PORTS_FILE = '/mnt/ports'


def hosted_apps() -> list[dict]:
    domain = getattr(settings, 'DOMAIN', '') or ''
    try:
        with open(_PORTS_FILE, encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        return []

    apps = []
    for line in content.strip().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('__'):
            continue
        parts = line.split(':')
        name = parts[0]
        backend_port = int(parts[1]) if len(parts) > 1 and parts[1] else None
        frontend_port = int(parts[2]) if len(parts) > 2 and parts[2] else None

        if domain and domain != 'CHANGE_ME':
            base = f'https://{domain}'
            frontend_url = f'{base}/{name}/' if frontend_port else None
            backend_url = f'{base}/{name}-api/' if backend_port else None
        else:
            base = 'http://localhost'
            frontend_url = f'{base}:{frontend_port}/' if frontend_port else None
            backend_url = f'{base}:{backend_port}/' if backend_port else None

        apps.append({
            'name': name,
            'backend_port': backend_port,
            'frontend_port': frontend_port,
            'frontend_url': frontend_url,
            'backend_url': backend_url,
        })
    return apps


def admin_tools() -> list[dict]:
    """Liens vers les outils d'administration du lab (jamais de contenu .env brut)."""
    kc_url = getattr(settings, 'KEYCLOAK_PUBLIC_URL', '') or 'http://localhost:8080'
    kc_realm = getattr(settings, 'KEYCLOAK_REALM', '') or 'ssolab'
    domain = getattr(settings, 'DOMAIN', '') or ''

    if domain and domain != 'CHANGE_ME':
        base = f'https://{domain}'
        ldap_url = f'{base}:8081'
        pgadmin_url = f'{base}:5050'
    else:
        base = kc_url.rstrip('/').rsplit(':', 1)[0] if '://' in kc_url else 'http://localhost'
        ldap_url = f'{base}:8081'
        pgadmin_url = f'{base}:5050'

    return [
        {
            'name': 'Keycloak',
            'url': f"{kc_url.rstrip('/')}/admin/{kc_realm}/console/",
            'description': 'Console admin — utilisateurs, groupes, clients, rôles.',
        },
        {
            'name': 'pgAdmin',
            'url': pgadmin_url,
            'description': 'Interface web PostgreSQL (login SSO).',
        },
        {
            'name': 'phpLDAPadmin',
            'url': ldap_url,
            'description': "Interface web de l'annuaire LDAP.",
        },
    ]
