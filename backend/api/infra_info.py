"""Liens vers les outils d'administration du lab (page Services, admins).

Calculés à partir de variables déjà présentes dans le ``.env`` de cette app
(``SERVER_URL_LAN``, seulement pour nommer le serveur dans la commande de
tunnel SSH) — jamais de dump d'un fichier ``.env``.
La liste des apps du lab, elle, vient du moteur (page Projets) : ce module ne
lit plus ``.ports``.
"""
from __future__ import annotations

from urllib.parse import urlsplit

from django.conf import settings


def admin_tools() -> list[dict]:
    """Liens vers les outils d'administration du lab (jamais de contenu .env brut).

    Vide depuis Keycloak 26 (2026-11-01) : Caddy ne sert plus ni la console
    d'administration ni le realm ``master``, et la console ouverte par tunnel envoie
    la connexion vers l'adresse publique (``authServerUrl``), refusée elle aussi.
    pgAdmin et phpLDAPadmin, liés à la boucle locale de l'hôte, s'ouvrent par tunnel
    SSH : voir ``admin_tunnel()``.
    """
    return []


def _server_host() -> str:
    """Hôte de ``SERVER_URL_LAN`` (ex. ``192.168.1.20``), ou un gabarit lisible."""
    raw = (getattr(settings, 'SERVER_URL_LAN', '') or '').strip()
    host = urlsplit(raw if '://' in raw else f'//{raw}').hostname if raw else None
    if not host or host in ('localhost', '127.0.0.1') or 'CHANGE_ME' in raw.upper():
        return '<serveur>'
    return host


def admin_tunnel() -> dict:
    """Indication d'accès à pgAdmin et phpLDAPadmin par tunnel SSH (admins seulement :
    servie par la même vue que ``admin_tools()``, permission ``IsLabAdmin``)."""
    command = (f'ssh -L 5050:127.0.0.1:5050 -L 8081:127.0.0.1:8081 '
               f'<utilisateur>@{_server_host()}')
    return {
        'command': command,
        'text': ("pgAdmin et phpLDAPadmin ne sont joignables que depuis le serveur lui-même. "
                 "Ouvrez un tunnel SSH, puis http://localhost:5050 (pgAdmin) et "
                 "http://localhost:8081 (phpLDAPadmin)."),
        'urls': {'pgAdmin': 'http://localhost:5050', 'phpLDAPadmin': 'http://localhost:8081'},
    }
