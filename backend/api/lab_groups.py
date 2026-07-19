"""Groupes requis par chaque application du lab.

Source : ``<app>/.keycloak-client-opts`` (``--require-group g1,g2``), monté en
lecture seule dans ``/mnt/dev`` (voir docker-compose.yml). Ce fichier ne
contient jamais de secret — c'est la même ligne de flags que
``scripts/new-app.sh``/``scripts/create-app-client.sh`` utilisent pour
provisionner le client Keycloak de l'app.

⚠ Ne JAMAIS lire un ``.env`` d'app depuis ``/mnt/dev`` ici (secrets) — c'est
exactement le pattern qui a fui via l'ancien ``env-config.json`` de
front-cadriciel. Seul ``.keycloak-client-opts`` est parsé.
"""
from __future__ import annotations

import os
import re

_DEV_ROOT = '/mnt/dev'
_APP_DESCRIPTIONS = os.path.join(_DEV_ROOT, '.app-descriptions')
_HIDDEN_GROUPS_FILE = os.path.join(_DEV_ROOT, '.hidden-groups')
_REQUIRE_GROUP_RE = re.compile(r'--require-group\s+(\S+)')


def listed_apps() -> set[str]:
    """Apps listées dans .app-descriptions — même fichier de curation que la
    page 404 (scripts/complete_404.sh) : seules ces apps sont éligibles à
    apparaître dans les outils d'admin du lab (lab-admin, add-user.sh)."""
    apps: set[str] = set()
    try:
        with open(_APP_DESCRIPTIONS, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                apps.add(line.split('|', 1)[0].strip())
    except OSError:
        pass
    return apps


def hidden_groups() -> set[str]:
    """Groupes listés dans .hidden-groups — jamais affichés, même s'ils
    existent réellement dans l'annuaire LDAP et sont requis par une app."""
    hidden: set[str] = set()
    try:
        with open(_HIDDEN_GROUPS_FILE, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    hidden.add(line)
    except OSError:
        pass
    return hidden


def app_required_groups() -> dict[str, list[str]]:
    """{nom_app: [groupe, ...]} — limité aux apps de .app-descriptions, et
    aux groupes qui ne sont pas dans .hidden-groups."""
    result: dict[str, list[str]] = {}
    if not os.path.isdir(_DEV_ROOT):
        return result

    listed = listed_apps()
    hidden = hidden_groups()
    for name in sorted(os.listdir(_DEV_ROOT)):
        if name not in listed:
            continue
        opts_path = os.path.join(_DEV_ROOT, name, '.keycloak-client-opts')
        compose_path = os.path.join(_DEV_ROOT, name, 'docker-compose.yml')
        if not os.path.isfile(compose_path) or not os.path.isfile(opts_path):
            continue
        try:
            with open(opts_path, encoding='utf-8') as f:
                content = f.read()
        except OSError:
            continue
        m = _REQUIRE_GROUP_RE.search(content)
        groups = [g.strip() for g in m.group(1).split(',') if g.strip()] if m else []
        result[name] = [g for g in groups if g not in hidden]
    return result


def groups_required_by() -> dict[str, list[str]]:
    """Index inversé : {groupe: [app, ...]}."""
    reverse: dict[str, list[str]] = {}
    for app, groups in app_required_groups().items():
        for g in groups:
            reverse.setdefault(g, []).append(app)
    return reverse
