"""Tâches Celery — lancement des tests E2E (voir CLAUDE.md, section
"Tests end-to-end"). Le runner (runner/, réseau sso-net) fait tout le travail
lourd (navigateur) ; cette tâche ne fait qu'orchestrer les appels HTTP vers
lui, séquentiellement, et tenir à jour DebugTest/DebugRunJob."""
from __future__ import annotations

import requests
from celery import shared_task
from django.conf import settings
from django.utils import timezone

from . import lab_groups
from .models import DebugRunJob, DebugTest


def _target_apps(scope_app: str) -> list[str]:
    """Une app précise, ou toutes les apps listées du lab (même source que
    LabUserGroupsView : .app-descriptions via lab_groups.listed_apps())."""
    if scope_app:
        return [scope_app]
    return sorted(lab_groups.listed_apps())


@shared_task(bind=True)
def run_debug_tests(self, job_id: int, scope_app: str) -> None:
    job = DebugRunJob.objects.get(pk=job_id)
    job.celery_task_id = self.request.id
    job.set_state(status=DebugRunJob.RUNNING, progress=0, message='Démarrage…')

    apps = _target_apps(scope_app)
    if not apps:
        job.set_state(status=DebugRunJob.ERROR, message='Aucune app à tester.')
        return

    errors: list[str] = []
    for i, app in enumerate(apps):
        job.set_state(message=f'{app}…', progress=int(i / len(apps) * 100))
        try:
            resp = requests.post(
                f'{settings.E2E_RUNNER_URL}/run',
                json={'app': app},
                timeout=180,
            )
            resp.raise_for_status()
            results = resp.json()
        except requests.RequestException as exc:
            # Un runner injoignable ou en échec sur une app ne doit pas
            # empêcher les autres apps du lot d'être testées.
            errors.append(f'{app} : {exc}')
            continue

        now = timezone.now()
        for r in results:
            DebugTest.objects.filter(app=app, file=r['file'], title=r['title']).update(
                last_status=r['status'],
                last_message=r.get('message', ''),
                last_run_at=now,
                last_duration_ms=r.get('durationMs'),
            )

    job.set_state(progress=100)
    if errors:
        job.set_state(status=DebugRunJob.ERROR, message=' ; '.join(errors))
    else:
        job.set_state(status=DebugRunJob.DONE, message=f'{len(apps)} app(s) testée(s).')
