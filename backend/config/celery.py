"""Application Celery pour les tâches asynchrones (lancement des tests E2E).
Copié du pattern carto-lab (carto-lab/backend/config/celery.py)."""
import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('lab_admin')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
