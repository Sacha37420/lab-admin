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
_REQUIRE_GROUP_RE = re.compile(r'--require-group\s+(\S+)')


def app_descriptions() -> dict[str, tuple[str, str]]:
    """{nom_app: (nom_affiché, description)} depuis .app-descriptions.

    Ce fichier pilote la **vitrine publique** de la page 404
    (scripts/complete_404.sh). Il n'est plus utilisé ici pour filtrer ce que
    lab-admin affiche (cf. infra_info.hosted_apps) — seulement pour habiller
    une app d'un nom lisible et d'une description quand elle y figure.
    """
    result: dict[str, tuple[str, str]] = {}
    try:
        with open(_APP_DESCRIPTIONS, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = [p.strip() for p in line.split('|')]
                name = parts[0]
                if not name:
                    continue
                label = parts[1] if len(parts) > 1 and parts[1] else name
                description = parts[2] if len(parts) > 2 else ''
                # Une app peut avoir plusieurs lignes (routes multiples, ex.
                # sso-lab) : la première fait foi pour l'habillage.
                result.setdefault(name, (label, description))
    except OSError:
        pass
    return result


def app_required_groups() -> dict[str, list[str]]:
    """{nom_app: [groupe, ...]} — toutes les apps réellement déployées.

    Plus aucun filtre de groupe : le fichier ``.hidden-groups`` a été retiré le
    2026-07-30. Il n'existait que pour cacher ``dom``/``harem`` du temps où ils
    ne servaient qu'à ``google-agenda`` (app déplacée vers ``dev2/``) ; ces deux
    groupes sont désormais requis par ``app-builder`` et ``storage``, donc les
    masquer donnait une vue fausse des droits réellement nécessaires.
    """
    result: dict[str, list[str]] = {}
    if not os.path.isdir(_DEV_ROOT):
        return result

    for name in sorted(os.listdir(_DEV_ROOT)):
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
        result[name] = (
            [g.strip() for g in m.group(1).split(',') if g.strip()] if m else []
        )
    return result


def groups_required_by() -> dict[str, list[str]]:
    """Index inversé : {groupe: [app, ...]}."""
    reverse: dict[str, list[str]] = {}
    for app, groups in app_required_groups().items():
        for g in groups:
            reverse.setdefault(g, []).append(app)
    return reverse
