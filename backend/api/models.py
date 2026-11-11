"""Modèles de lab-admin.

Ses anciennes tables ont été retirées par la migration 0004 :
- `departments`, `user_records` : exemples du gabarit d'origine, sans usage ;
- `debug_tests`, `debug_run_jobs` : catalogue et lancements des tests de
  cloisonnement, désormais tenus par le moteur du lab.

Les modèles en lecture seule du catalogue App Builder sont dans
`models_appbuilder.py` (non gérés : aucune migration ne les touche).

Seule table propre depuis le chantier app-builder-v2 (I8) : `spec_links`.
"""
from django.db import models


class SpecLink(models.Model):
    """Lien durable entre un projet du lab et la spécification App Builder dont il est né
    (chantier app-builder-v2, I8).

    Une ligne par (compte, projet) : `owner_email` est l'email du jeton de celui qui l'a
    écrite, et personne d'autre ne la lit ni ne la modifie (`SpecLinkView`). Le moteur n'en
    sait rien et App Builder non plus : c'est la mémoire de l'interface, qui s'en sert pour
    retrouver la spécification d'origine même après un renommage, et pour comparer
    l'empreinte de la spécification au jour de la création (ou du dernier envoi au projet)
    avec son empreinte actuelle.

    `fingerprint` vaut `""` quand App Builder n'en rendait pas (ancienne image) : rien
    n'est alors comparé.
    """

    owner_email = models.EmailField(max_length=255)
    app = models.CharField(max_length=63)
    spec_id = models.PositiveIntegerField()
    fingerprint = models.CharField(max_length=71, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'spec_links'
        constraints = [
            models.UniqueConstraint(fields=['owner_email', 'app'], name='spec_links_owner_app_unique'),
        ]

    def __str__(self) -> str:
        return f'{self.app} ← spécification n° {self.spec_id}'
