from django.db import migrations, models


class Migration(migrations.Migration):
    """Table `spec_links` (chantier app-builder-v2, I8) : lien projet ↔ spécification
    App Builder, une ligne par (compte, projet). Réversible : le retour arrière retire la table."""

    dependencies = [
        ('api', '0004_remove_dead_tables'),
    ]

    operations = [
        migrations.CreateModel(
            name='SpecLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('owner_email', models.EmailField(max_length=255)),
                ('app', models.CharField(max_length=63)),
                ('spec_id', models.PositiveIntegerField()),
                ('fingerprint', models.CharField(blank=True, default='', max_length=71)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'spec_links',
                'constraints': [
                    models.UniqueConstraint(fields=('owner_email', 'app'), name='spec_links_owner_app_unique'),
                ],
            },
        ),
    ]
