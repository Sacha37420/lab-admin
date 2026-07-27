from django.db import models


class Department(models.Model):
    """Département ou équipe de l'organisation."""

    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)

    class Meta:
        db_table = 'departments'
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class UserRecord(models.Model):
    """Enregistrement d'un utilisateur Keycloak, créé automatiquement à la première connexion."""

    email = models.EmailField(primary_key=True, max_length=255)
    display_name = models.CharField(max_length=200, blank=True)
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='members',
    )
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_records'
        ordering = ['email']

    def __str__(self) -> str:
        return self.display_name or self.email


class DebugTest(models.Model):
    """
    Un test Playwright catalogué pour une app (voir CLAUDE.md, section
    "Tests end-to-end"). Rangée upsertée par CatalogSyncView à chaque
    déploiement (scripts/setup_unit.sh) ; purgée si le test disparaît du
    catalogue renvoyé par le runner à ce moment-là.
    """

    PENDING = 'PENDING'
    PASSED = 'PASSED'
    FAILED = 'FAILED'
    ERROR = 'ERROR'
    STATUS_CHOICES = [
        (PENDING, 'Jamais exécuté'), (PASSED, 'Réussi'),
        (FAILED, 'Échoué'), (ERROR, 'Erreur'),
    ]

    app = models.CharField(max_length=100)
    file = models.CharField(max_length=255)
    title = models.CharField(max_length=255)
    last_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    last_message = models.TextField(blank=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_duration_ms = models.IntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'debug_tests'
        ordering = ['app', 'file', 'title']
        constraints = [
            models.UniqueConstraint(fields=['app', 'file', 'title'], name='uniq_debug_test'),
        ]

    def __str__(self) -> str:
        return f'{self.app} — {self.title}'


class DebugRunJob(models.Model):
    """
    Suivi d'un lancement de tests E2E (une app ou toutes) — même forme que le
    modèle Job de carto-lab (carto-lab/backend/api/models.py).
    """

    PENDING = 'PENDING'
    RUNNING = 'RUNNING'
    DONE = 'DONE'
    ERROR = 'ERROR'
    STATUS_CHOICES = [(PENDING, 'En attente'), (RUNNING, 'En cours'),
                       (DONE, 'Terminé'), (ERROR, 'Erreur')]

    # Vide = toutes les apps du lab.
    scope_app = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    progress = models.IntegerField(default=0)  # 0..100
    message = models.TextField(blank=True)
    celery_task_id = models.CharField(max_length=64, blank=True)
    owner_email = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'debug_run_jobs'
        ordering = ['-created_at']

    def set_state(self, status=None, progress=None, message=None):
        if status is not None:
            self.status = status
        if progress is not None:
            self.progress = progress
        if message is not None:
            self.message = message
        self.save(update_fields=['status', 'progress', 'message', 'updated_at'])
