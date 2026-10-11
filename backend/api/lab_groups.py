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
# Les apps naissent dans <racine>/deploiement/<app> ; les anciennes vivent encore
# à la racine tant qu'elles n'ont pas déménagé (contrat multi-dev v5).
_DEPLOY_SUBDIR = 'deploiement'
_APP_NAME_RE = re.compile(r'[a-z0-9][a-z0-9_-]{0,62}')


def app_dir(name: str) -> str:
    """Dossier d'une app — même règle que ``registry_app_dir``
    (scripts/lib/registry.sh) : ``deploiement/<app>`` s'il existe, sinon
    ``<app>`` à la racine. Un nom qui pourrait sortir de la racine (« .. »,
    « / ») rend un chemin qui n'existe pas."""
    if not isinstance(name, str) or not _APP_NAME_RE.fullmatch(name):
        return os.path.join(_DEV_ROOT, '.nom-invalide')
    nested = os.path.join(_DEV_ROOT, _DEPLOY_SUBDIR, name)
    return nested if os.path.isdir(nested) else os.path.join(_DEV_ROOT, name)


def app_names() -> list[str]:
    """Noms des dossiers candidats : ceux de ``deploiement/`` et ceux de la
    racine, sans doublon (``app_dir`` dit ensuite lequel fait foi)."""
    names: set[str] = set()
    for base in (os.path.join(_DEV_ROOT, _DEPLOY_SUBDIR), _DEV_ROOT):
        try:
            names.update(n for n in os.listdir(base) if _APP_NAME_RE.fullmatch(n))
        except OSError:
            continue
    names.discard(_DEPLOY_SUBDIR)
    return sorted(names)
_REQUIRE_GROUP_RE = re.compile(r'--require-group\s+(\S+)')


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

    for name in app_names():
        opts_path = os.path.join(app_dir(name), '.keycloak-client-opts')
        compose_path = os.path.join(app_dir(name), 'docker-compose.yml')
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
