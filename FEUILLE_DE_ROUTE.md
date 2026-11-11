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

## Lot 3 — Décisions de la relecture et libellés   ·   statut : en cours
**Objectif :** Ⓟ trancher les points laissés ouverts, puis les appliquer.
**Tâches :**
- [x] B5 : les cartes pgAdmin et phpLDAPadmin pointent vers `http://<IP LAN>:5050/8081` (`backend/api/infra_info.py:28-44`). Retirées (chantier failles, F10 : ces ports sont liés à `127.0.0.1`) ; à la place, pour les `admins` seulement, l'indication de tunnel SSH (`admin_tunnel()`, servie par `GET /api/tools/`, `IsLabAdmin`)
- [ ] « éditeur ouvert » et « Fermer l'éditeur » s'affichent aussi pour une conversation (`mes-projets.component.html:45,216`, `projet.component.html:48`) : passer à « espace ouvert » et « Fermer l'espace »
- [ ] Vue des apps pour un administrateur qui ne développe pas (perdue avec la fusion d'« Apps du lab »)
- [ ] Retirer `core/smtp-stale.service.ts` (plus aucun moteur sans `stale` en service) ; commentaire périmé `mes-projets.component.ts:224`
- [x] PKCE (`pkceMethod: 'S256'`) ; ports en `${LAB_BIND_ADDR:-127.0.0.1}` (chantier failles, I1)
**Tests à passer avant de clore le lot :**
- [ ] `npm run test:engine` et `ng build` ; parcours `e2edev` à 390 px
**Vérifié le :** 2026-11-01 — non déployé (B5 et PKCE seulement). `bash chantiers/tests/essai.sh lab-admin api` : 20 tests OK (17 + 3 : `AdminToolsTunnelTests`, dont un `developers` non `admins` refusé en 403 sans la ligne du tunnel) ; image `lab-admin-frontend:candidat` : `ng build` OK, `npm run test:engine` 51/51, `pkceMethod:"S256"` dans le bundle ; `docker compose config` : `host_ip: 127.0.0.1`. Parcours `e2edev` à 390 px : après déploiement.

## Lot 4 — Documentation juste   ·   statut : livré
**Objectif :** le README dit l'état réel.
**Constat [C] :** la section « Points connus, laissés ouverts » (`README.md:291-307`) est fausse sur
4 lignes : OpenAPI public, frontend recevant tout le `.env`, `runserver`, absence de `cloisonnement.spec.ts`.
**Tâches :**
- [x] Corriger les « Points connus » et la section Tests ; ajouter la commande de test backend
  (travail de nuit du 2026-11-08 : points réglés déplacés dans un paragraphe « Réglés depuis » avec
  leur preuve ; ports, mot de passe rendu, interfaces d'administration et nombres de tests mis à jour ;
  `bash chantiers/tests/essai.sh lab-admin` cité)
- [x] Signaler à l'architecte les lignes périmées de `CLAUDE.md` (l. 66-68, 108) — déjà fait :
  cochées dans `to_do_global.md` § T6
**Tests à passer avant de clore le lot :**
- [x] Le grep de `Apps du lab`, `Debug` et `runserver` dans le README ne trouve que des mentions historiques
**Vérifié le :** 2026-11-08 — `grep -n "runserver\|Apps du lab\|Debug\|debug" README.md` : une seule ligne,
la liste des anciennes adresses redirigées (`/debug`). Relecture des affirmations du README contre
`backend/config/urls.py`, `backend/Dockerfile`, `docker-compose.yml`, `backend/api/infra_info.py`.

## Lot 5 — Passerelle avec App Builder   ·   statut : en cours
**Objectif :** un projet né d'une spécification App Builder garde son lien avec elle : on voit ce qui sera remis avant de créer, on sait quand la spec a changé, et on peut le transmettre à l'agent du projet. Contrat : `chantiers/app-builder-v2/` (I7, I8) à la racine du lab.
**Tâches :**
- [x] `SpecLink` (table `spec_links`, migration `0005`) et `GET/PUT /api/spec-links/<app>/` (`IsLabMember` : porte `admins,developers`, lignes de l'appelant seulement)
- [x] « Mes spécifications » : aperçu des lots et du cahier (texte, jamais HTML) avant la création ; lien enregistré après une création réussie ; lien « Connecter Claude Code / Vibe à App Builder »
- [x] Page projet : bloc « Spécification d'origine », alerte quand l'empreinte a changé, « Transmettre au projet » par un ticket (`POST /projects/<app>/tickets`)
- [ ] Ⓟ Mise en service et parcours en navigateur réel (`chantiers/app-builder-v2/rapports/D.md`, « Parcours navigateur ») ; un ticket réel sur un dépôt créé par le moteur
**Tests à passer avant de clore le lot :**
- [x] `python manage.py test api.tests.SpecLinkTests api.tests.DefaultDenyTests` (membre accepté, ligne d'autrui invisible et intouchable, non-membre refusé, valeurs invalides 400, inventaire des routes ouvertes)
- [x] `npm run test:engine` (`spec-link.client.spec.ts` : ticket ≤ 60 000 même avec un cahier de 200 000 caractères, aucune ligne `#` de la spec hors bloc, ni jeton ni historique)
- [x] `npx ng build` sans erreur
**Vérifié le :** 2026-11-11 — tests backend sur PostgreSQL jetable : 29 OK ; `npm run test:engine` : 62/62 ; `npx ng build` sans erreur ; image du commit `e6b8505` construite pendant que l'ancienne tournait, `scripts/app-test.sh lab-admin` : 29 OK. **Non mis en service** (refusé à l'agent de nuit, à faire par le propriétaire).

## Mise en service — chantier « failles » (2026-11-01)
Les mentions « non déployé » ci-dessus datent d'avant cette mise en service. Image construite pendant
que l'ancienne tournait, `scripts/app-test.sh` : 20 tests OK, puis `up -d --no-build` ; ports
publiés sur `127.0.0.1` ; client Keycloak passé en PKCE S256 exigé, URI de retour réduites à celles de
l'app (`create-app-client.sh --pkce --prune-uris`) ; cloisonnement `lab-runner` 3/3 avant et après le durcissement du client, puis de nouveau 3/3 sur Keycloak 26.8.1.
Restent les vérifications en navigateur réel notées dans les lots (images, coffres de clés, envois).
