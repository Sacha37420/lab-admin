# Feuille de route — lab-admin

Ce fichier est lu par une machine : `validate-app.sh` refuse de déployer s'il manque ou s'il ne
contient aucun lot au format ci-dessous, et `app-test.sh` lit la commande de test. Garder les titres
tels quels.

Service du cadriciel, livré avant l'obligation de feuille de route : le Lot 1 résume l'existant.
Les lots suivants viennent de l'analyse du 2026-10-31 (vue d'ensemble : `to_do_global.md` à la
racine du dépôt du lab). [C] constaté, [D] déduit.

## Commande de test
python manage.py test

## Notes
Les tests backend demandent un PostgreSQL jetable : le rôle `lab` ne peut pas créer de base. La
commande est en tête de `backend/api/tests.py`, ou passer par `bash chantiers/tests/essai.sh lab-admin`.

## Lot 1 — Existant : Accueil, Services, Projets, administration   ·   statut : livré
**Objectif :** seule interface du lab multi-dev :
- accueil et initialisation à la première connexion ;
- Services (Keycloak, base et pgAdmin, email, Storage, OAuth Hub, MCP) ;
- Projets (déploiement, outils de dev, adresse d'essai, « Mes spécifications ») ;
- pour `admins` : Nouvel utilisateur.
**Tâches :**
- [x] Relecture du 2026-10-11 appliquée : page Code supprimée, « Apps du lab » et « Debug » en redirections, tables mortes retirées
- [x] Correctifs du gabarit : frontend sans `.env`, gunicorn, OpenAPI seulement en DEBUG, lien direct (`core/redirect-uri.ts`), `tokenBases()`
**Tests à passer avant de clore le lot :**
- [x] 14 tests backend ; `npm run test:engine` ; `frontend/e2e/cloisonnement.spec.ts`
**Vérifié le :** 2026-10-31 — relevé par lecture (version en service = `3455573`), tests non rejoués.

## Lot 2 — Surface exposée   ·   statut : livré
**Objectif :** ne rien rendre ni publier de plus que nécessaire.
**Constat [C] :**
- Le backend renvoie le mot de passe d'un compte créé même quand l'email est parti
  (`backend/api/views.py:163-165`) ; seule la page le masque.
- Les ports 8083 et 4201 sont publiés sur toutes les interfaces (`docker-compose.yml:29-30,58-59`).
**Tâches :**
- [x] Ne renvoyer `password` que si `email_sent` est faux (`backend/api/views.py`) ; la page n'affiche la ligne du mot de passe que si l'email n'est pas parti
- [x] Lier les `ports:` à `127.0.0.1` (contrat urgences v1 § 7 : pas de suppression)
**Tests à passer avant de clore le lot :**
- [x] Nouveau test : email envoyé ⇒ pas de `password` dans la réponse (`UserCreationPasswordTests`, avec les deux cas inverses : échec SMTP, SMTP non configuré)
- [x] `ss -tlnp | grep -E ':(8083|4201)'` ne montre que `127.0.0.1` ; page OK dans `lab-runner` (vérifié le 2026-10-31 après déploiement : 127.0.0.1 seulement, cloisonnement 3/3)
**Vérifié le :** 2026-10-31 — `bash chantiers/tests/essai.sh lab-admin` : 17 tests OK (14 + 3 nouveaux) ; avec l'ancienne `views.py`, `test_email_sent_means_no_password_in_response` échoue (cas négatif) ; `npm run test:engine` 51/51 ; `ng build` OK ; `docker compose config` rend `host_ip: 127.0.0.1` sur les deux ports. Non déployé : `ss` et `lab-runner` restent à faire. **Mis en service le 2026-10-31** (chantier « urgences ») : image construite pendant que l'ancienne tournait, `scripts/app-test.sh` vert sur cette image, puis `up -d --no-build` ; test de cloisonnement par `lab-runner` vert après déploiement.

## Lot 3 — Décisions de la relecture et libellés   ·   statut : à faire
**Objectif :** Ⓟ trancher les points laissés ouverts, puis les appliquer.
**Tâches :**
- [ ] B5 : les cartes pgAdmin et phpLDAPadmin pointent vers `http://<IP LAN>:5050/8081` (`backend/api/infra_info.py:28-44`). Les afficher seulement depuis le LAN, ou les retirer.
- [ ] « éditeur ouvert » et « Fermer l'éditeur » s'affichent aussi pour une conversation (`mes-projets.component.html:45,216`, `projet.component.html:48`) : passer à « espace ouvert » et « Fermer l'espace »
- [ ] Vue des apps pour un administrateur qui ne développe pas (perdue avec la fusion d'« Apps du lab »)
- [ ] Retirer `core/smtp-stale.service.ts` (plus aucun moteur sans `stale` en service) ; commentaire périmé `mes-projets.component.ts:224`
- [ ] PKCE
**Tests à passer avant de clore le lot :**
- [ ] `npm run test:engine` et `ng build` ; parcours `e2edev` à 390 px
**Vérifié le :**

## Lot 4 — Documentation juste   ·   statut : à faire
**Objectif :** le README dit l'état réel.
**Constat [C] :** la section « Points connus, laissés ouverts » (`README.md:291-307`) est fausse sur
4 lignes : OpenAPI public, frontend recevant tout le `.env`, `runserver`, absence de `cloisonnement.spec.ts`.
**Tâches :**
- [ ] Corriger les « Points connus » et la section Tests ; ajouter la commande de test backend
- [ ] Signaler à l'architecte les lignes périmées de `CLAUDE.md` (l. 66-68, 108)
**Tests à passer avant de clore le lot :**
- [ ] Le grep de `Apps du lab`, `Debug` et `runserver` dans le README ne trouve que des mentions historiques
**Vérifié le :**
