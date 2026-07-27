from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_example_data'),
    ]

    operations = [
        migrations.CreateModel(
            name='DebugTest',
            fields=[
                ('id',               models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('app',               models.CharField(max_length=100)),
                ('file',              models.CharField(max_length=255)),
                ('title',             models.CharField(max_length=255)),
                ('last_status',       models.CharField(
                    choices=[
                        ('PENDING', 'Jamais exécuté'), ('PASSED', 'Réussi'),
                        ('FAILED', 'Échoué'), ('ERROR', 'Erreur'),
                    ],
                    default='PENDING', max_length=10,
                )),
                ('last_message',      models.TextField(blank=True)),
                ('last_run_at',       models.DateTimeField(blank=True, null=True)),
                ('last_duration_ms',  models.IntegerField(blank=True, null=True)),
                ('updated_at',        models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'debug_tests',
                'ordering': ['app', 'file', 'title'],
            },
        ),
        migrations.AddConstraint(
            model_name='debugtest',
            constraint=models.UniqueConstraint(
                fields=('app', 'file', 'title'), name='uniq_debug_test',
            ),
        ),
        migrations.CreateModel(
            name='DebugRunJob',
            fields=[
                ('id',              models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('scope_app',       models.CharField(blank=True, max_length=100)),
                ('status',          models.CharField(
                    choices=[
                        ('PENDING', 'En attente'), ('RUNNING', 'En cours'),
                        ('DONE', 'Terminé'), ('ERROR', 'Erreur'),
                    ],
                    default='PENDING', max_length=10,
                )),
                ('progress',        models.IntegerField(default=0)),
                ('message',         models.TextField(blank=True)),
                ('celery_task_id',  models.CharField(blank=True, max_length=64)),
                ('owner_email',     models.CharField(blank=True, max_length=255)),
                ('created_at',      models.DateTimeField(auto_now_add=True)),
                ('updated_at',      models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'debug_run_jobs',
                'ordering': ['-created_at'],
            },
        ),
    ]
