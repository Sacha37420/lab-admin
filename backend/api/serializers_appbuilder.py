"""Sérialisation en lecture seule du catalogue app-builder (miroir cross-schema).

Fonctions simples plutôt que des ``ModelSerializer`` DRF : les modèles miroir
(``models_appbuilder.py``) modélisent les tables de jonction M2M à la main
(pas de vrai ``ManyToManyField``), ce que DRF sérialise mal par défaut. La
forme de sortie correspond à ``PublicSpec`` (et types associés) de
``frontend/src/app/core/lab-api.service.ts`` — contrat déjà consommé
par les pages dashboard, apps, code-editor et deploy-prompts.
"""
from __future__ import annotations

from .models_appbuilder import FrontendServiceEndpointGroup, PageFrontendService


def _data_model(dm) -> dict:
    return {
        'name': dm.name,
        'description': dm.description,
        'fields': dm.fields,
        'relationships': dm.relationships,
        'order': dm.order,
    }


def _endpoint(ep) -> dict:
    return {
        'method': ep.method,
        'path': ep.path,
        'description': ep.description,
        'operation': ep.operation,
        'linked_model_name': ep.linked_model_name,
        'auth_required': ep.auth_required,
        'required_roles': ep.required_roles,
        'query_params': ep.query_params,
        'steps': ep.steps,
    }


def _endpoint_group(eg) -> dict:
    return {
        'id': eg.id,
        'name': eg.name,
        'description': eg.description,
        'order': eg.order,
        'endpoints': [_endpoint(ep) for ep in eg.endpoints.all()],
    }


def _service(svc) -> dict:
    group_ids = list(
        FrontendServiceEndpointGroup.objects.using('app_builder')
        .filter(frontendservice_id=svc.id)
        .values_list('endpointgroup_id', flat=True)
    )
    return {
        'id': svc.id,
        'name': svc.name,
        'order': svc.order,
        'endpoint_group_ids': group_ids,
    }


def _interaction(i) -> dict:
    return {'name': i.name, 'type': i.type, 'description': i.description}


def _pipeline(p) -> dict:
    return {
        'name': p.name,
        'description': p.description,
        'steps': p.steps,
    }


def _page(page) -> dict:
    service_ids = list(
        PageFrontendService.objects.using('app_builder')
        .filter(page_id=page.id)
        .values_list('frontendservice_id', flat=True)
    )
    return {
        'id': page.id,
        'name': page.name,
        'route': page.route,
        'layout': page.layout,
        'order': page.order,
        'service_ids': service_ids,
        'components': page.components,
        'interactions': [_interaction(i) for i in page.interactions.all()],
        'pipelines': [_pipeline(p) for p in page.pipelines.all()],
    }


def serialize_appspec(spec) -> dict:
    return {
        'id': spec.id,
        'name': spec.name,
        'description': spec.description,
        'owner_email': spec.owner_email,
        'created_at': spec.created_at,
        'updated_at': spec.updated_at,
        'data_models': [_data_model(dm) for dm in spec.data_models.all()],
        'endpoint_groups': [_endpoint_group(eg) for eg in spec.endpoint_groups.all()],
        'services': [_service(s) for s in spec.services.all()],
        'pages': [_page(p) for p in spec.pages.all()],
    }
