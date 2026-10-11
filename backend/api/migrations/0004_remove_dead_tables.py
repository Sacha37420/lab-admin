from django.db import migrations


class Migration(migrations.Migration):
    """Retire les quatre tables de lab-admin, qui n'ont plus de lecteur.

    - `debug_tests`, `debug_run_jobs` : les tests de cloisonnement sont lancés et gardés par
      le moteur du lab ; la page « Debug », son catalogue et ses lancements disparaissent.
      Résultats jetables : ils se reconstituent en relançant les tests.
    - `user_records`, `departments` : exemples du gabarit d'origine (migration 0002), plus
      aucun code ne les lit depuis le retrait de /api/me/, /api/users/, /api/departments/.

    `user_records` avant `departments` : la première porte la clé étrangère vers la seconde.
    Réversible : le retour arrière recrée les quatre tables, vides.
    """

    dependencies = [
        ('api', '0003_debug_tests'),
    ]

    operations = [
        migrations.DeleteModel(name='DebugTest'),
        migrations.DeleteModel(name='DebugRunJob'),
        migrations.DeleteModel(name='UserRecord'),
        migrations.DeleteModel(name='Department'),
    ]
