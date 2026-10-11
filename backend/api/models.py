"""lab-admin n'a plus de modèle à lui.

Ses anciennes tables ont été retirées par la migration 0004 :
- `departments`, `user_records` : exemples du gabarit d'origine, sans usage ;
- `debug_tests`, `debug_run_jobs` : catalogue et lancements des tests de
  cloisonnement, désormais tenus par le moteur du lab.

Les modèles en lecture seule du catalogue App Builder sont dans
`models_appbuilder.py` (non gérés : aucune migration ne les touche).
"""
