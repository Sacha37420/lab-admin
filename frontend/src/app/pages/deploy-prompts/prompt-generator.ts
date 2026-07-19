import { PublicSpec, DataModelSummary, EndpointGroupSummary, PageSummary } from '../../core/lab-api.service';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[éèêë]/g, 'e').replace(/[àâä]/g, 'a').replace(/[ùûü]/g, 'u')
    .replace(/[ôö]/g, 'o').replace(/[îï]/g, 'i').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toKebab(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}

function formatDataModels(models: DataModelSummary[]): string {
  if (!models.length) return '_Aucun modèle défini._';
  return models.map(m => {
    const fields = m.fields.map(f =>
      `      - \`${f.name}\` (${f.type}${f.required ? ', requis' : ''}${f.unique ? ', unique' : ''}${f.max_length ? `, max=${f.max_length}` : ''}${f.default !== undefined && f.default !== '' ? `, défaut=${f.default}` : ''})`
    ).join('\n');
    const rels = m.relationships.map(r =>
      `      - \`${r.name}\` → ${r.rel_type} vers \`${r.to_model}\` (related_name: ${r.related_name}${r.on_delete ? `, on_delete=${r.on_delete}` : ''})`
    ).join('\n');
    return [
      `  - **${m.name}**${m.description ? ` — ${m.description}` : ''}`,
      fields ? `    Champs :\n${fields}` : '',
      rels   ? `    Relations :\n${rels}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function formatEndpoints(groups: EndpointGroupSummary[]): string {
  if (!groups.length) return '_Aucun endpoint défini._';
  return groups.map(g => {
    const eps = g.endpoints.map(ep => {
      const roles = ep.required_roles?.length
        ? `\n        Rôles requis : ${ep.required_roles.join(', ')}`
        : '';
      const qp = ep.query_params?.length
        ? `\n        Query params : ${ep.query_params.map(p => `\`${p.name}\` (${p.type}${p.required ? ', requis' : ''}${p.description ? ` — ${p.description}` : ''})`).join(', ')}`
        : '';
      const steps = ep.steps?.length
        ? '\n' + ep.steps.map((s, i) => `        ${i + 1}. [${s.type}] ${s.label}${s.description ? ` — ${s.description}` : ''}`).join('\n')
        : '';
      return `    - \`${ep.method} ${ep.path}\` — ${ep.description || ep.operation}${ep.linked_model_name ? ` (modèle: ${ep.linked_model_name})` : ''}${ep.auth_required ? '' : ' [public]'}${roles}${qp}${steps}`;
    }).join('\n');
    return `  - **${g.name}**${g.description ? ` — ${g.description}` : ''}\n${eps}`;
  }).join('\n\n');
}

function formatPages(pages: PageSummary[]): string {
  if (!pages.length) return '_Aucune page définie._';
  return pages.map(p => {
    const comps = p.components?.length
      ? `    Composants UI :\n${p.components.map(c => {
          const linked = c.linked_model ? ` (modèle : ${c.linked_model})` : '';
          const fields = c.fields?.length ? ` [champs : ${c.fields.join(', ')}]` : '';
          return `      - ${c.type}${c.label ? ` "${c.label}"` : ''}${linked}${fields}`;
        }).join('\n')}`
      : '';
    const interactions = p.interactions.length
      ? `    Interactions :\n${p.interactions.map(i => `      - ${i.name} (${i.type})${i.description ? ` — ${i.description}` : ''}`).join('\n')}`
      : '';
    const pipelines = p.pipelines.map(pl => {
      const steps = pl.steps.map((s, i) => {
        const detail = s.service_method ? ` → \`${s.service_method}\`` : '';
        const flow   = s.data_flow ? ` [${s.data_flow}]` : '';
        const desc   = s.description ? ` — ${s.description}` : '';
        return `      ${i + 1}. [${s.type}] ${s.label}${detail}${flow}${desc}`;
      }).join('\n');
      return `    Pipeline "${pl.name}"${pl.description ? ` — ${pl.description}` : ''} :\n${steps}`;
    }).join('\n');
    return [
      `  - **${p.name}** — route \`${p.route}\`, layout: ${p.layout}`,
      comps,
      interactions,
      pipelines,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

export function generatePrompt(spec: PublicSpec): string {
  const slug = toSlug(spec.name);

  const backendFiles = [
    `\`${slug}/backend/api/models.py\``,
    `\`${slug}/backend/api/serializers.py\``,
    `\`${slug}/backend/api/views.py\``,
    `\`${slug}/backend/api/urls.py\``,
    `\`${slug}/backend/api/admin.py\``,
  ];

  const frontendFiles = [
    `\`${slug}/frontend/src/app/models/${slug}.model.ts\` — interfaces TypeScript des modèles`,
    `\`${slug}/frontend/src/app/app.routes.ts\` — routes à compléter`,
    ...spec.services.map(s => `\`${slug}/frontend/src/app/core/${toKebab(s.name)}.service.ts\``),
    ...spec.pages.flatMap(p => {
      const ps = toSlug(p.name);
      return [
        `\`${slug}/frontend/src/app/pages/${ps}/${ps}.component.ts\``,
        `\`${slug}/frontend/src/app/pages/${ps}/${ps}.component.html\``,
        `\`${slug}/frontend/src/app/pages/${ps}/${ps}.component.scss\``,
      ];
    }),
  ];

  const pageRoutes = spec.pages.map(p => `- \`${p.route}\` → ${p.name}Component`).join('\n');

  return `# Construire l'application "${spec.name}"

## Contexte

Tu es dans le répertoire \`/home/sacha/dev\`.
${spec.description ? `\n${spec.description}\n` : ''}
## Étape 1 — Trouver les ports libres et scaffolder

Lis \`.ports\` pour trouver les prochains ports disponibles, puis lance \`new-app.sh\` :

\`\`\`bash
LAST_B=$(grep -oP '(?<=:)\\d+(?=:)' .ports | awk '$1>=8083' | sort -n | tail -1)
LAST_F=$(grep -oP '\\d+$' .ports | awk '$1>=4200' | sort -n | tail -1)
PORT_B=$((LAST_B + 1))
PORT_F=$((LAST_F + 1))
printf '${slug}\\n4\\n'$PORT_B'\\n'$PORT_F'\\nO\\n' | bash new-app.sh
\`\`\`

Le type 4 = Django + Angular.

## Étape 2 — Initialiser git et créer le dépôt GitHub

\`\`\`bash
cd ${slug}
git init && git checkout -b main
git add . && git commit -m "feat: initial scaffold"
gh repo create Sacha37420/${slug} --public
git remote add origin https://github.com/Sacha37420/${slug}.git
git push -u origin main
cd ..
sed -i '/^${slug}\\/\$/d' .gitignore
git submodule add https://github.com/Sacha37420/${slug}.git ${slug}
\`\`\`

## Étape 3 — Implémenter les spécifications

### Conventions du système à respecter impérativement

- **Auth backend** : utiliser \`KeycloakJWTAuthentication\` (déjà présent dans \`authentication.py\` après scaffold). Ne pas remplacer par \`IsAuthenticated\` DRF standard seul.
- **Rôles** : si \`required_roles\` est défini sur un endpoint, vérifier \`request.user.claims.get('groups', [])\` dans la view.
- **Auth frontend** : ajouter \`canActivate: [authGuard]\` à toutes les routes protégées dans \`app.routes.ts\`.
- **URL API dans les services Angular** : utiliser \`inject(EnvConfigService).apiUrl\` (voir \`core/env-config.service.ts\` généré par le scaffold).
- **Structure de référence** : \`_templates/django-angular/\` — s'y référer pour \`authentication.py\`, intercepteur, guard, \`app.config.ts\`.

### Fichiers à créer ou modifier

**Backend :**
${backendFiles.map(f => `- ${f}`).join('\n')}

**Frontend :**
${frontendFiles.map(f => `- ${f}`).join('\n')}

### 3.1 Modèles de données (\`${slug}/backend/api/models.py\`)

${formatDataModels(spec.data_models)}

### 3.2 API Backend (\`views.py\` + \`serializers.py\` + \`urls.py\`)

${formatEndpoints(spec.endpoint_groups)}

### 3.3 Services Angular (\`${slug}/frontend/src/app/core/\`)

${spec.services.length
  ? spec.services.map(s => {
      const linkedGroups = spec.endpoint_groups
        .filter(g => s.endpoint_group_ids.includes(g.id!))
        .map(g => g.name);
      return `  - **${s.name}** → groupe(s) : ${linkedGroups.join(', ') || '—'}`;
    }).join('\n')
  : '_Aucun service défini._'
}

### 3.4 Pages Angular (\`${slug}/frontend/src/app/pages/\`)

${formatPages(spec.pages)}

### 3.5 Interfaces TypeScript (\`${slug}/frontend/src/app/models/${slug}.model.ts\`)

Créer une interface TypeScript pour chaque modèle Django :
${spec.data_models.map(m => `- \`${m.name}\``).join('\n')}

### 3.6 Routes Angular (\`${slug}/frontend/src/app/app.routes.ts\`)

Ajouter les routes suivantes avec \`authGuard\` :
${pageRoutes}

## Étape 4 — Configurer le .env

Renseigner les champs obligatoires dans \`${slug}/.env\` :
- \`SECRET_KEY\` (généré par new-app.sh, garder tel quel en dev)
- \`DEBUG=True\`
- \`DOMAIN=CHANGE_ME\` (laisser tel quel en HTTP local)

## Étape 5 — Déployer

> ⛔ **INTERDIT** : ne jamais lancer \`docker-compose up\`, \`recompose_docker.sh\` ou tout autre commande Docker directement.
> Ces commandes **ne créent pas le client Keycloak** et l'app sera inaccessible (erreur "Client not found").
> **Seule commande autorisée pour démarrer ou redémarrer l'app :**

\`\`\`bash
bash setup2.sh ${slug} --yes
\`\`\`

## Étape 6 — Rendre l'app visible dans lab-admin et la page 404

Ajouter une ligne dans \`.app-descriptions\` (racine du dépôt \`dev/\`) :

\`\`\`
${slug}|Nom affiché|Description courte.
\`\`\`

Aucun redémarrage requis : la page "Apps du lab" de lab-admin et la page 404
lisent ce fichier à chaque requête.

---
_Spec générée depuis App Builder — owner: ${spec.owner_email} — mise à jour: ${new Date(spec.updated_at).toLocaleString('fr-FR')}_
`;
}
