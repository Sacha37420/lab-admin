"""Miroir en lecture seule des tables d'app-builder (schéma 'app_builder').

Toutes les apps du lab partagent la même instance Postgres ``devdb`` (un
schéma par app, rôle ``devuser`` commun à toutes — voir CLAUDE.md). Plutôt que
d'appeler l'API HTTP d'app-builder, ce module lit directement ses tables via
un second alias de connexion (``DATABASES['app_builder']``, même
host/user/password que la connexion par défaut, ``search_path`` différent).

``managed = False`` : ces tables appartiennent à app-builder (ses migrations
les créent/modifient) — ce module ne fait jamais d'écriture ni de migration
dessus. Les champs et ``db_table`` sont recopiés depuis
``app-builder/backend/api/models.py`` ; à maintenir en cas d'évolution du
schéma là-bas.

Toutes les requêtes doivent utiliser ``.using('app_builder')`` explicitement
(pas de DB router — ce sont les seuls modèles de cette app à ne pas vivre
dans son propre schéma).
"""
from django.db import models


class AppSpec(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    app_type = models.CharField(max_length=30)
    owner_email = models.EmailField(max_length=255, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'app_specs'
        ordering = ['-updated_at']


class DataModel(models.Model):
    app = models.ForeignKey(AppSpec, related_name='data_models', on_delete=models.DO_NOTHING)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    fields = models.JSONField(default=list)
    relationships = models.JSONField(default=list)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        managed = False
        db_table = 'data_models'
        ordering = ['order', 'name']


class EndpointGroup(models.Model):
    app = models.ForeignKey(AppSpec, related_name='endpoint_groups', on_delete=models.DO_NOTHING)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        managed = False
        db_table = 'endpoint_groups'
        ordering = ['order', 'name']


class Endpoint(models.Model):
    group = models.ForeignKey(EndpointGroup, related_name='endpoints', on_delete=models.DO_NOTHING)
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    operation = models.CharField(max_length=20, default='custom')
    linked_model_name = models.CharField(max_length=200, blank=True)
    auth_required = models.BooleanField(default=True)
    required_roles = models.JSONField(default=list)
    query_params = models.JSONField(default=list)
    steps = models.JSONField(default=list)

    class Meta:
        managed = False
        db_table = 'endpoints'
        ordering = ['order', 'path']


class FrontendService(models.Model):
    app = models.ForeignKey(AppSpec, related_name='services', on_delete=models.DO_NOTHING)
    name = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        managed = False
        db_table = 'frontend_services'
        ordering = ['order', 'name']


class FrontendServiceEndpointGroup(models.Model):
    """Table intermédiaire M2M FrontendService <-> EndpointGroup (auto-générée par Django)."""
    id = models.BigAutoField(primary_key=True)
    frontendservice = models.ForeignKey(FrontendService, on_delete=models.DO_NOTHING, db_column='frontendservice_id')
    endpointgroup = models.ForeignKey(EndpointGroup, on_delete=models.DO_NOTHING, db_column='endpointgroup_id')

    class Meta:
        managed = False
        db_table = 'frontend_services_endpoint_groups'


class Page(models.Model):
    app = models.ForeignKey(AppSpec, related_name='pages', on_delete=models.DO_NOTHING)
    name = models.CharField(max_length=200)
    route = models.CharField(max_length=500)
    order = models.PositiveIntegerField(default=0)
    layout = models.CharField(max_length=20, default='mixed')
    components = models.JSONField(default=list)

    class Meta:
        managed = False
        db_table = 'pages'
        ordering = ['order', 'name']


class PageFrontendService(models.Model):
    """Table intermédiaire M2M Page <-> FrontendService (auto-générée par Django)."""
    id = models.BigAutoField(primary_key=True)
    page = models.ForeignKey(Page, on_delete=models.DO_NOTHING, db_column='page_id')
    frontendservice = models.ForeignKey(FrontendService, on_delete=models.DO_NOTHING, db_column='frontendservice_id')

    class Meta:
        managed = False
        db_table = 'pages_services'


class Interaction(models.Model):
    page = models.ForeignKey(Page, related_name='interactions', on_delete=models.DO_NOTHING)
    name = models.CharField(max_length=200)
    type = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        managed = False
        db_table = 'interactions'
        ordering = ['order']


class Pipeline(models.Model):
    page = models.ForeignKey(Page, related_name='pipelines', on_delete=models.DO_NOTHING)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    trigger_interaction = models.CharField(max_length=200, blank=True)
    steps = models.JSONField(default=list)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        managed = False
        db_table = 'pipelines'
        ordering = ['order', 'name']
