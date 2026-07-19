"""Apps hébergées (depuis .ports) et outils d'administration du lab.

``hosted_apps()`` est un port direct de l'ancienne ``InfrastructureView``
d'app-builder (lecture de ``.ports``, montée en lecture seule ici sous
``/mnt/ports`` — même fichier, non secret). ``admin_tools()`` calcule les
liens vers Keycloak / pgAdmin / phpLDAPadmin à partir de variables déjà
présentes dans le ``.env`` de cette app (``DOMAIN``, ``KEYCLOAK_HOSTNAME_URL`` —
jamais de dump brut d'un fichier ``.env``).
"""
from __future__ import annotations

import re

from django.conf import settings

from . import lab_groups

_PORTS_FILE = '/mnt/ports'
_DEV_ROOT = '/mnt/dev'
_HANDLE_PATH_RE = re.compile(r'caddy\.handle_path:\s*"(/[^"]*)/\*"')


def _caddy_paths(app: str) -> tuple[str | None, str | None]:
    """(chemin_frontend, chemin_backend) déduits des labels caddy.handle_path
    du docker-compose.yml de l'app — seule source de vérité du routage réel.
    Le nom de dossier peut diverger du préfixe réel (ex: analyse-lora → /lora/),
    d'où le bug historique des liens faux basés sur le nom de dossier. Même
    logique que front_prefix() dans scripts/complete_404.sh."""
    try:
        with open(f'{_DEV_ROOT}/{app}/docker-compose.yml', encoding='utf-8') as f:
            content = f.read()
    except OSError:
        return None, None
    paths = _HANDLE_PATH_RE.findall(content)
    backend = next((p for p in paths if p.endswith('-api')), None)
    frontend = next((p for p in paths if not p.endswith('-api')), None)
    return frontend, backend


def hosted_apps() -> list[dict]:
    """Apps affichées : limitées à .app-descriptions (mêmes apps que la page
    404 — google-agenda et toute app volontairement tenue hors vitrine
    n'apparaissent pas ici non plus)."""
    domain = getattr(settings, 'DOMAIN', '') or ''
    listed = lab_groups.listed_apps()
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
        if name not in listed:
            continue
        backend_port = int(parts[1]) if len(parts) > 1 and parts[1] else None
        frontend_port = int(parts[2]) if len(parts) > 2 and parts[2] else None

        if domain and domain != 'CHANGE_ME':
            base = f'https://{domain}'
            frontend_path, backend_path = _caddy_paths(name)
            frontend_url = f'{base}{frontend_path}/' if frontend_path else None
            backend_url = f'{base}{backend_path}/' if backend_path else None
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
    """Liens vers les outils d'administration du lab (jamais de contenu .env brut).

    Keycloak passe par Caddy (routage par chemin, cf. KEYCLOAK_PUBLIC_URL) donc
    reste joignable en WAN comme en LAN. pgAdmin et phpLDAPadmin, eux, ne sont
    PAS routés par Caddy — publiés en HTTP brut sur leur port dédié
    (docker-compose.yml de sso-lab/infra), et ces deux ports ne sont jamais
    ouverts sur le routeur (cf. scripts/open-bbox-ports2.sh) : contrairement
    aux apps, il n'y a aucune barrière Keycloak devant eux, ils ne doivent
    donc être joignables qu'en LAN. Un lien construit sur DOMAIN + ces ports
    ne fonctionnerait de toute façon jamais (rien n'écoute côté WAN) — c'est
    l'IP LAN, en HTTP, qu'il faut utiliser dans tous les cas.
    """
    kc_url = getattr(settings, 'KEYCLOAK_PUBLIC_URL', '') or 'http://localhost:8080'
    kc_realm = getattr(settings, 'KEYCLOAK_REALM', '') or 'ssolab'
    lan_base = (getattr(settings, 'SERVER_URL_LAN', '') or 'http://localhost').rstrip('/')

    return [
        {
            'name': 'Keycloak',
            'url': f"{kc_url.rstrip('/')}/admin/{kc_realm}/console/",
            'description': 'Console admin — utilisateurs, groupes, clients, rôles.',
        },
        {
            'name': 'pgAdmin',
            'url': f'{lan_base}:5050',
            'description': 'Interface web PostgreSQL (login SSO) — accessible en LAN uniquement.',
        },
        {
            'name': 'phpLDAPadmin',
            'url': f'{lan_base}:8081',
            'description': "Interface web de l'annuaire LDAP — accessible en LAN uniquement.",
        },
    ]
