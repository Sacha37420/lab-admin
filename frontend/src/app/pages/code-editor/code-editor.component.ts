import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LabApiService, PublicSpec, HostedApp } from '../../core/lab-api.service';
import { NewAppGuideComponent } from '../../shared/new-app-guide/new-app-guide.component';

interface EnvWindow { __env?: { codeServerUrl?: string } }

function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const CUSTOM = 'custom';

@Component({
  selector: 'app-code-editor',
  standalone: true,
  imports: [FormsModule, NewAppGuideComponent],
  templateUrl: './code-editor.component.html',
  styleUrl: './code-editor.component.scss',
})
export class CodeEditorComponent implements OnInit {
  private api = inject(LabApiService);

  get codeServerUrl(): string {
    const url = (window as unknown as EnvWindow).__env?.codeServerUrl ?? '';
    return url && !url.endsWith('/') ? url + '/' : url;
  }
  available(): boolean { return !!this.codeServerUrl; }

  specs        = signal<PublicSpec[]>([]);
  specsLoading = signal(true);
  specsError   = signal('');
  selectedId   = signal<string>('');
  copied       = signal('');
  hostedApps   = signal<HostedApp[]>([]);

  selectedSpec = computed(() => {
    const v = this.selectedId();
    if (!v || v === CUSTOM) return null;
    return this.specs().find(s => s.id === +v) ?? null;
  });
  isCustom = computed(() => this.selectedId() === CUSTOM);

  ngOnInit() {
    this.api.getAllSpecs().subscribe({
      next:  s  => { this.specs.set(s); this.specsLoading.set(false); },
      error: () => { this.specsError.set("Impossible de charger le catalogue des apps"); this.specsLoading.set(false); },
    });
    this.api.getInfrastructure().subscribe({
      next: res => this.hostedApps.set(res.apps ?? []),
      error: () => {},
    });
  }

  onSelect(event: Event) {
    this.selectedId.set((event.target as HTMLSelectElement).value);
  }

  appSlug(): string {
    const s = this.selectedSpec();
    return s ? toSlug(s.name) : 'mon-app';
  }

  nextPorts(): { backend: number; frontend: number } {
    let maxB = 8082, maxF = 4199;
    for (const a of this.hostedApps()) {
      if (a.backend_port)  maxB = Math.max(maxB, a.backend_port);
      if (a.frontend_port) maxF = Math.max(maxF, a.frontend_port);
    }
    return { backend: maxB + 1, frontend: maxF + 1 };
  }

  newAppCommand(): string {
    const { backend, frontend } = this.nextPorts();
    return `printf '${this.appSlug()}\\n4\\n${backend}\\n${frontend}\\nO\\n' | bash ~/dev/new-app.sh`;
  }

  claudePrompt(): string {
    const spec = this.selectedSpec();
    if (!spec) return '';
    const s   = this.appSlug();
    const pkg = s.replace(/-/g, '_');
    return `Tu travailles dans ~/dev/${s} (Django + Angular), créé par new-app.sh.

Voici le spec complet de l'application :
\`\`\`json
${JSON.stringify(spec, null, 2)}
\`\`\`

Implémente l'application selon ce spec :
1. Modèles Django dans backend/${pkg}/models.py
2. Serializers DRF dans backend/${pkg}/serializers.py
3. ViewSets + URLs dans backend/${pkg}/views.py et urls.py
4. Composants Angular dans frontend/src/app/pages/

Contraintes :
- Ne modifie pas la config Keycloak, Docker, nginx — déjà gérés par le lab
- L'auth Keycloak JWT est en place (KeycloakGuard Django, AuthGuard Angular)
- Les modèles appartiennent au schéma Postgres "${pkg}" (déjà créé)`;
  }

  deployPrompt(): string {
    const s = this.appSlug();
    return `Tu dois déployer et valider l'application "${s}" dans le lab ~/dev/.

## Étape 1 — Déploiement

Lance le script de déploiement complet depuis le terminal hôte (pas depuis Docker) :

\`\`\`bash
bash ~/dev/setup2.sh ${s} --yes
\`\`\`

Ce script enchaîne : arrêt des containers → propagation des URLs → démarrage Keycloak → création client Keycloak → build + démarrage containers → ouverture ports routeur.

Si le script échoue :
- Consulte d'abord ~/dev/.debug/ pour voir si le problème est déjà documenté
- Corrige le problème
- Relance la partie qui a échoué (ou le script entier si nécessaire)
- Documente le bug et sa correction dans ~/dev/.debug/ (nouveau fichier ou mise à jour d'un existant)

## Étape 2 — Vérification du déploiement

Vérifie que tous les containers sont bien démarrés :
\`\`\`bash
docker ps --filter name=${s}
\`\`\`

Vérifie les logs backend pour détecter des erreurs de démarrage :
\`\`\`bash
docker logs ${s}-backend --tail 30
\`\`\`

Vérifie que les migrations Django ont bien tourné et que les tables existent :
\`\`\`bash
docker exec ${s}-backend python3 manage.py showmigrations
docker exec dev-postgres psql -U devuser -d devdb -c "\\dt ${s.replace(/-/g, '_')}.*"
\`\`\`

Si le schéma PostgreSQL n'existe pas (tables manquantes après scaffold sur une base déjà existante), consulte ~/dev/.debug/02_restauration_403.md pour la procédure de correction.

## Étape 3 — Vérification du fonctionnement

Teste l'API backend directement (sans token → doit retourner 403, pas 500) :
\`\`\`bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:$(grep "^${s}:" ~/dev/.ports | cut -d: -f2 || echo "8080")/api/
\`\`\`

Si le backend retourne 500 : regarder les logs Docker et corriger (migrations manquantes, import cassé, etc.).
Si le backend retourne 403 : c'est normal (auth requise), l'API est opérationnelle.

Pour vérifier l'auth complète, obtiens un token Keycloak et teste une route protégée :
\`\`\`bash
KC_PORT=$(grep PORT_KEYCLOAK ~/dev/sso-lab/.env | cut -d= -f2)
TOKEN=$(curl -s -X POST "http://localhost:\${KC_PORT}/realms/ssolab/protocol/openid-connect/token" \\
  -d "client_id=${s}&username=sacha&password=\$(grep 'uid=sacha' ~/dev/sso-lab/ldap/init.ldif -A3 | grep userPassword | head -1 | awk '{print \$2}')&grant_type=password" \\
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token','FAIL'))")
echo "Token: \${TOKEN:0:40}..."
curl -s -H "Authorization: Bearer \$TOKEN" http://localhost:$(grep "^${s}:" ~/dev/.ports | cut -d: -f2 || echo "8080")/api/ | head -c 200
\`\`\`

Si le token JWT retourne 403 (not 401) sur les routes protégées : vérifier que les groupes Keycloak requis par l'app existent et que l'utilisateur sacha y appartient. Voir ~/dev/.debug/02_restauration_403.md.

## Étape 4 — Mise à jour du journal

Si tu as rencontré et corrigé des problèmes :
- Ajoute un fichier dans ~/dev/.debug/ (numéroté après le dernier existant)
- Mets à jour ~/dev/.debug/README.md avec une ligne pointant vers ce fichier
- Structure : symptôme → cause racine → correction → leçon`;
  }

  copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(key);
      setTimeout(() => this.copied.set(''), 2000);
    });
  }
}
