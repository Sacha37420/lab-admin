# lab-admin

Le portail du lab : la seule interface web d'un lab où plusieurs développeurs créent, codent et
mettent en ligne leurs applications sur un même serveur. `lab-admin` **ne détient aucun privilège** :
tout ce qu'un développeur y fait (créer un projet, déployer, lire ses journaux, ouvrir son éditeur)
est une demande adressée à un autre service du lab, le moteur `lab-mcp`, qui seul vérifie et exécute.
Son propre backend ne sert plus qu'à trois choses d'administration : créer un compte, donner les
liens d'administration, lire le catalogue d'App Builder.

Ce dépôt est un sous-module du dépôt du lab ; il ne fonctionne pas seul.

## Les pages, et qui les voit

Quatre profils existent. Un compte entre dans `lab-admin` s'il est membre du groupe `admins` ou du
groupe `developers` ; ce qu'il voit ensuite dépend de ce qu'il est.

| Page | Superutilisateur du lab | Développeur | Administrateur qui ne développe pas | Membre de `developers` sans compte développeur possible |
|---|---|---|---|---|
| **Accueil** `/` | présentation du lab, ses chiffres, son parcours, les règles | idem ; à la première visite, son espace est préparé automatiquement | présentation, règles | présentation, règles |
| **Services** `/services` | services communs, sa base et son pgAdmin, ses comptes d'envoi d'email, accès pour ses assistants, interfaces d'administration | services communs, sa base et son pgAdmin, ses comptes d'envoi d'email, accès pour ses assistants | services communs, interfaces d'administration | services communs |
| **Projets** `/projets` | tous les projets du lab avec leur propriétaire, vue d'un développeur donné, création, « Tout tester » ; puis le bloc « Conception » | ses projets, création | pas de liste, et la page dit pourquoi ; puis le bloc « Conception » | « aucun projet à votre nom » |
| **Un projet** `/projets/<nom>` | tout projet ; sur celui d'un autre : base et email en lecture seule, variables réduites à leurs noms | ses projets | — | — |
| **Nouvel utilisateur** | oui | refusé | oui | refusé |

Précisions :

- **Services communs** : la page « Mon compte » de Keycloak, Storage (les fichiers), OAuth Hub
  (liaison du compte GitHub). **Interfaces d'administration** : la console Keycloak, le pgAdmin du
  lab, l'annuaire, l'éditeur du code du lab.
- **Un projet** : état des conteneurs, déploiement d'un commit avec suivi et journal, déploiement
  automatique, journaux, test de cloisonnement, variables d'environnement, base de données et
  console SQL, compte d'envoi d'email, ouverture de l'éditeur (VS Code dans le navigateur),
  ouverture d'un ticket.
- **Trois ouvertures par projet**, dans la liste comme sur la page du projet : « VS Code »
  (l'éditeur complet), « Claude Code » et « Mistral Vibe » (la conversation seule avec
  l'assistant, pensée pour le téléphone). C'est le même appel au moteur, avec une cible ; mêmes
  attentes et mêmes refus. Une conversation s'ouvre dans l'onglet courant sur un écran de moins
  de 900 px, dans un nouvel onglet au-delà (`core/tool-tab.ts`, `beginOpening`).
- **Projets** est en deux sections quand le moteur indique la nature de chaque projet : « Projets
  de déploiement » et « Outils de dev ». Chaque ligne donne l'état, la version en service, l'écart
  avec GitHub et le dernier verdict du test de cloisonnement (détail des cas à la demande). Un
  administrateur y voit en plus les ports, la description de vitrine et l'étiquette « hors
  vitrine ». Le superutilisateur peut lancer le test de tous les projets ; un projet sans test
  n'y est jamais compté comme vérifié.
- **Pourquoi un administrateur qui ne développe pas n'a pas de liste** : la liste vient du moteur,
  qui ne répond qu'aux comptes développeurs. `lab-admin` n'en tient pas une copie.
- Le **superutilisateur** est celui que le moteur désigne comme tel dans ses réponses ; `lab-admin`
  ne le déduit d'aucun groupe.
  Le quatrième profil est celui d'un compte dont l'identifiant ne peut pas servir de compte
  développeur (autre chose que des minuscules et des chiffres).
- Le menu ne montre jamais un lien vers une page qui refuserait : trois liens pour un
  non-administrateur, quatre pour un administrateur.
- Les anciennes adresses `/outils`, `/conception`, `/code`, `/apps-hebergees` et `/debug`
  redirigent vers `/services` ou `/projets`. (`/code` est ici la route de `lab-admin` ; l'éditeur du lab, servi ailleurs sous le
  même mot, n'est pas concerné.)

## Architecture

```
                         navigateur
                             │  jeton Keycloak de l'utilisateur (client « lab-admin »)
        ┌────────────────────┴─────────────────────┐
        ▼                                          ▼
  frontend Angular ── /mcp/api ──►  moteur lab-mcp          (autre service du lab)
  (ce dépôt, frontend/)            projets, déploiements, journaux, base, éditeur,
        │                          pgAdmin, comptes d'envoi d'email…
        │                          Formes des réponses : lab-mcp/API.md, dans le dépôt du lab.
        │
        └── /lab-admin-api ──►  backend Django (ce dépôt, backend/)
                                administration seulement : création de comptes (et groupes
                                requis par chaque app), liens d'administration,
                                catalogue App Builder.
```

Ce que fait le **frontend** : il présente, il appelle. Il parle au moteur sur la même origine,
avec le jeton de l'utilisateur. Il n'a pas d'accès propre à quoi que ce soit.

Ce que fait le **moteur** (hors de ce dépôt) : il vérifie à chaque appel qui demande et à qui
appartient le projet, puis agit. Un projet qui n'appartient pas à l'appelant lui est rendu comme
introuvable.

Ce que fait le **backend** de `lab-admin` : quatre routes, toutes d'administration. Il crée des
comptes par un compte de service Keycloak, lit en lecture seule dans le dépôt du lab monté dans le
conteneur les groupes requis par chaque app (jamais un fichier `.env`), donne les liens
d'administration et lit le catalogue d'App Builder. Il n'a aucune table à lui.

Ce que le backend **ne fait pas** : rien pour les développeurs. Aucune de ses vues n'est ouverte à
un non-administrateur. Ajouter un endpoint ici pour une page de développeur reviendrait à donner
un privilège à `lab-admin` : la fonction va dans le moteur. Il ne liste pas les apps et ne lance
aucun test : c'est le moteur qui le fait.

Conteneurs (`docker-compose.yml`) : `lab-admin-frontend` (nginx) et `lab-admin-backend` (Django).
Le reverse proxy du lab sert le frontend sous `/lab-admin/` et le backend sous `/lab-admin-api/`.
Aucun socket Docker n'est monté ; le seul montage du backend est en lecture seule.

## Modèle de sécurité

**La porte.** Keycloak n'ouvre le client `lab-admin` qu'aux groupes `admins` et `developers`
(`.keycloak-client-opts`). Le backend refuse en plus tout jeton émis pour un autre client et tout
jeton sans l'un de ces groupes (`backend/api/authentication.py`).

**La permission par défaut est fermée.** Entrer ne donne rien : la permission par défaut du
backend exige le groupe `admins` (`DEFAULT_PERMISSION_CLASSES = ['api.permissions.IsLabAdmin']`,
`backend/config/settings.py`). Aucune vue n'y échappe.

Deux règles pour qui modifie ce dépôt :

- **toute nouvelle vue du backend est une vue d'administrateur tant qu'elle ne déclare rien** — ne
  jamais remettre `IsAuthenticated` par défaut : la création de comptes s'ouvrirait à tout
  développeur ;
- **toute nouvelle route d'administration porte `adminGuard`** (`frontend/src/app/app.routes.ts`)
  et `adminOnly: true` dans le menu (`frontend/src/app/app.ts`). Les pages communes portent
  `labGuard` et conditionnent leurs blocs d'administration à `kc.isAdmin`.

Les gardes Angular ne sont que de l'affichage : ce sont le backend et le moteur qui refusent.
Un test vérifie, route par route et méthode par méthode, qu'un développeur non administrateur
reçoit 403 sur tout le backend (`backend/api/tests.py`).

**Les secrets à l'écran.** Quatre secrets passent par l'interface ; la règle est la même pour
tous :

| Secret | Où | Règle |
|---|---|---|
| mot de passe de la base d'un développeur | `shared/ma-base` | demandé au moteur au clic seulement, jamais au chargement ; masqué de nouveau après 2 minutes, quand l'onglet passe à l'arrière-plan, en quittant la page |
| mot de passe d'un compte qu'un administrateur vient de créer | `pages/nouvel-utilisateur` | masqué par défaut, affiché à la demande, mêmes effacements |
| valeur d'une variable d'environnement d'un projet | `shared/env-vars` | la liste ne porte que les noms ; une valeur se demande au moteur au clic, une à la fois, par le propriétaire seulement ; mêmes effacements ; modifier ou supprimer ne l'affiche pas |
| mot de passe d'un compte d'envoi d'email | `shared/email` | en écriture seule : envoyé une fois, jamais relu ni réaffiché, vidé du formulaire dès l'envoi |

À ne jamais faire avec l'un d'eux : l'écrire dans `localStorage`, `sessionStorage`, un cookie, une
URL ou la console ; le garder dans un service partagé entre pages ; l'afficher sans action de
l'utilisateur ; afficher sa longueur.

Deux autres précautions tenues dans le code : l'adresse de retour après la connexion est la page
demandée, prise dans l'adresse courante et jamais dans un paramètre (`core/redirect-uri.ts`) ;
l'adresse d'un éditeur ou d'un pgAdmin rendue par le moteur n'est suivie que si elle est sur
l'origine du lab, en https, sous le chemin attendu, et n'est ni gardée ni affichée
(`core/tool-tab.ts`, `isWorkspaceUrl` / `isPgadminUrl`) ; pour un espace, elle doit en plus être
celle de la cible demandée — une adresse d'éditeur n'est jamais ouverte à la place d'une
conversation (`isWorkspaceTargetUrl`).

## Où sont les choses

```
frontend/src/app/
  core/
    engine.client.ts      LE client du moteur : toutes les routes, un type par forme de réponse,
                          les erreurs, le suivi d'un job. Sans dépendance à Angular.
                          Une forme qui change côté moteur se corrige ici et nulle part ailleurs.
    engine.service.ts     le même, branché sur HttpClient
    auth.guard.ts         adminGuard et labGuard
    auth.interceptor.ts   pose le jeton sur chaque requête
    keycloak.service.ts   connexion, groupes, isAdmin
    redirect-uri.ts       adresse de retour après la connexion
    tool-tab.ts           ouverture d'un outil dans un nouvel onglet
    env.ts                seul lecteur de la configuration injectée (assets/env.js)
    format.ts             LE format de date (jj/mm/aaaa hh:mm) et de SHA (7 caractères)
  pages/
    accueil/  services/  projets/        les pages de tout le monde
    projets/projet.component.*           la page d'un projet
    dashboard/                           le bloc « Conception », inclus dans Projets pour les admins
    nouvel-utilisateur/                  la page d'administration
  shared/
    ma-base/          base de données, mot de passe à la demande, pgAdmin personnel
    email/            comptes d'envoi (page Services) et choix du compte d'un projet
    env-vars/         variables d'environnement d'un projet, valeur à la demande
    job-suivi/        suivi d'une création, d'un déploiement, d'un test
    confirm-dialog/   demande de confirmation (remplace les boîtes natives du navigateur)
frontend/src/styles.scss   couleurs, espacements et polices en variables CSS ; aucun composant
                           ne porte de couleur en dur
backend/api/
  permissions.py      IsLabAdmin
  authentication.py   validation du jeton Keycloak
  views.py, urls.py   les quatre vues d'administration
  infra_info.py       liens d'administration
  lab_groups.py       lecture du dépôt du lab : groupes requis par chaque app
  keycloak_admin.py   compte de service pour la création de comptes
  models_appbuilder.py   lecture seule du catalogue d'App Builder (aucune table propre)
  tests.py            tests du cloisonnement
```

## Tests

**Backend** — quatorze tests. Le rôle de base de données de `lab-admin` ne peut pas créer de base de
test : on lui donne un PostgreSQL jetable. Depuis la racine du dépôt du lab, l'image
`lab-admin-backend` étant construite :

```bash
docker network create lab-admin-test-net
docker run -d --rm --name lab-admin-test-pg --network lab-admin-test-net \
  -e POSTGRES_USER=essai -e POSTGRES_PASSWORD=essai -e POSTGRES_DB=essai \
  --tmpfs /var/lib/postgresql/data postgres:16-alpine
docker run --rm --env-file lab-admin/.env --network lab-admin-test-net \
  -e DB_HOST=lab-admin-test-pg -e DB_NAME=essai -e DB_USER=essai -e DB_PASSWORD=essai \
  -v "$PWD/lab-admin/backend:/app:ro" -w /app lab-admin-backend \
  python manage.py test api
docker stop lab-admin-test-pg && docker network rm lab-admin-test-net
```

**Client du moteur** — vingt-deux tests, sous Node, sans navigateur ; ils tiennent la méthode, le
chemin et le corps de chaque appel, la lecture des erreurs, le suivi d'un job, l'adresse de retour :

```bash
cd frontend && npm install && npm run test:engine
```

**Compilation stricte** (types et gabarits) et **build** :

```bash
cd frontend && npx ngc -p tsconfig.app.json --noEmit && npx ng build
```

Il n'y a pas de test de composant Angular : aucun outillage n'est installé pour cela.

**Navigateur réel.** Le lab a un conteneur de test (`lab-runner`, Playwright et Chromium) qui
joint le reverse proxy par son nom. On y exécute un script par `docker exec -i lab-runner node -
< script.js`, avec `--host-resolver-rules=MAP <domaine> caddy`, en se connectant par Keycloak avec
les comptes de test du lab. Pour vérifier un build **avant** de le déployer, le script sert le
contenu de `frontend/dist/` à la place des fichiers statiques de `lab-admin` (`page.route`), le
reste — Keycloak, moteur, `assets/env.js` — restant réel. Deux pièges : la cible d'une redirection
HTTP n'est pas interceptée (recharger la page après le retour de Keycloak), et un seul navigateur
à la fois sur la machine.

## Déploiement

`lab-admin` se déploie par le lab, depuis la racine du dépôt du lab :

```bash
bash scripts/setup2.sh lab-admin --yes
```

Le code est copié dans les images : toute modification demande ce redéploiement. Les migrations
s'appliquent au démarrage du backend.

Variables lues (fichier `.env`, non versionné ; `.env.example` en donne la liste). La plupart sont
écrites par les scripts du lab, pas à la main.

| Variable | Rôle |
|---|---|
| `DOMAIN` | nom de domaine du lab ; sert à construire les adresses publiques et la configuration du frontend |
| `PORT_BACKEND`, `PORT_FRONTEND`, `FRONTEND_URL`, `SERVER_URL_LAN`, `SERVER_URL_WAN` | ports et adresses hors domaine |
| `SCRIPT_NAME` | préfixe sous lequel le backend est servi |
| `HOST_DEV_ROOT` | chemin du dépôt du lab sur l'hôte, monté en lecture seule dans le backend |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SCHEMA`, `DB_USER`, `DB_PASSWORD` | base de données de `lab-admin` |
| `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` | réglages Django |
| `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_REALM`, `KEYCLOAK_ISSUER_URI`, `KEYCLOAK_PUBLIC_URL` | Keycloak : client, realm, adresses interne et publique |
| `KEYCLOAK_REQUIRED_GROUPS` | groupes admis par le backend (`admins,developers`), écrit d'après `.keycloak-client-opts` |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET`, `KEYCLOAK_ADMIN_BASE_URL` | compte de service qui crée les comptes |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_SSL`, `SMTP_FROM`, `SMTP_FROM_DISPLAY` | envoi de ses identifiants à un compte créé |

Le frontend reçoit sa configuration au démarrage du conteneur : `frontend/nginx-entrypoint.sh`
écrit `assets/env.js` (adresses de Keycloak, du backend, du moteur, de Storage, d'OAuth Hub,
d'App Builder, de l'éditeur du lab). Ce fichier ne contient aucun secret.

`.env.example` porte aussi `BACKEND_URL`, `KEYCLOAK_URL` et `PORT_KEYCLOAK`, que les scripts du lab
tiennent à jour mais que le code de ce dépôt ne lit pas.

## Points connus, laissés ouverts

- **Les liens vers le pgAdmin du lab et l'annuaire** pointent le réseau local : hors de ce réseau
  ils ne mènent nulle part.
- **Le schéma OpenAPI et la page Swagger du backend** répondent sans authentification (les données,
  elles, exigent un administrateur).
- **Le conteneur du frontend reçoit tout le `.env`**, secrets du backend compris, alors qu'il n'a
  besoin que de quelques adresses.
- **Le backend est servi par le serveur de développement de Django** (`runserver`, `Dockerfile`).
- **Les ports du backend et du frontend sont publiés sur l'hôte**, en plus du reverse proxy.
- **Le backend renvoie le mot de passe d'un compte créé** dans sa réponse, y compris quand l'email
  est parti : le masquage est fait par la page.
- **Signalement d'un compte d'envoi modifié** : la page s'appuie sur ce que dit le moteur, avec un
  repli en mémoire de session à retirer quand il ne servira plus (`core/smtp-stale.service.ts`).
- **Un administrateur qui ne développe pas n'a plus de vue des apps du lab** (voir plus haut).
- **Pas de test de cloisonnement automatisé** (`frontend/e2e/cloisonnement.spec.ts`) pour
  `lab-admin` lui-même.

## Licence

MIT — voir `LICENSE`.
