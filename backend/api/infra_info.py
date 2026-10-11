"""Liens vers les outils d'administration du lab (page Services, admins).

Calculés à partir de variables déjà présentes dans le ``.env`` de cette app
(``KEYCLOAK_PUBLIC_URL``, ``SERVER_URL_LAN``) — jamais de dump d'un fichier ``.env``.
La liste des apps du lab, elle, vient du moteur (page Projets) : ce module ne
lit plus ``.ports``.
"""
from __future__ import annotations

from django.conf import settings


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
