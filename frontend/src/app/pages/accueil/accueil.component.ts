import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EngineService } from '../../core/engine.service';
import { KeycloakService } from '../../core/keycloak.service';
import {
  EngineError, InitStep, Me, Profile, Project, profileOf, projectCounts, toEngineError,
} from '../../core/engine.client';

type StepState = 'done' | 'todo' | 'now' | 'unknown';
interface Step { title: string; text: string; state: StepState; link?: string; href?: string; action?: string; }

/**
 * Accueil : présente le lab à quelqu'un qui arrive (contrat multi-dev I6 v8).
 * Aucun contenu réservé aux admins ici. C'est aussi là que se joue la
 * première connexion d'un développeur (`me/init`, lancé tout seul).
 */
@Component({
  selector: 'app-accueil',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './accueil.component.html',
})
export class AccueilComponent implements OnInit {
  private engine = inject(EngineService);
  protected kc = inject(KeycloakService);

  loading = signal(true);
  engineDown = signal<EngineError | null>(null);
  me = signal<Me | null>(null);
  profile = signal<Profile | null>(null);
  projects = signal<Project[] | null>(null);

  initRunning = signal(false);
  initSteps = signal<InitStep[]>([]);
  initError = signal<EngineError | null>(null);
  recheckingGithub = signal(false);

  isDev = computed(() => this.profile() === 'dev' || this.profile() === 'superuser');
  counts = computed(() => { const p = this.projects(); return p ? projectCounts(p) : null; });
  githubUrl = computed(() => {
    const me = this.me();
    return me?.remaining.find(s => s.step === 'link_github')?.url ?? me?.github?.connect_url ?? me?.oauth_hub_url ?? this.engine.oauthHubUrl;
  });

  /** Le parcours, avec où en est la personne. Ce qu'on ne peut pas savoir reste neutre. */
  steps = computed<Step[]>(() => {
    const me = this.me();
    const projects = this.projects();
    const ready = !!me?.initialized;
    const linked = me?.github_linked;
    const has = (test: (p: Project) => boolean): StepState => projects === null ? 'unknown' : projects.some(test) ? 'done' : 'todo';
    const created: StepState = projects === null ? 'unknown' : projects.length ? 'done' : 'todo';
    return [
      { title: 'Votre compte est prêt',
        text: ready ? 'Votre base de données et votre dossier de travail existent.' : 'Le lab prépare votre base de données et votre dossier de travail.',
        state: ready ? 'done' : 'now' },
      { title: 'Relier votre compte GitHub',
        text: 'Le code de chaque projet vit dans un dépôt GitHub à votre nom. Le lab a besoin de votre accord, une seule fois.',
        state: linked === true ? 'done' : linked === false ? 'todo' : 'unknown',
        href: linked === true ? undefined : this.githubUrl(), action: 'Relier mon compte GitHub' },
      { title: 'Créer un projet',
        text: 'Un nom, un type, les groupes qui auront le droit de l\'utiliser : le lab crée le dépôt, la base et l\'adresse.',
        state: created,
        // Pas d'invitation à créer tant que l'étape GitHub n'est pas faite : la création échouerait.
        ...(created === 'done' ? { link: '/projets', action: 'Voir mes projets' }
          : linked === true ? { link: '/projets', action: 'Créer mon premier projet' } : {}) },
      { title: 'L\'ouvrir dans VS Code',
        text: 'Un éditeur dans le navigateur, limité à votre projet, avec un terminal et vos assistants (Claude Code, Mistral Vibe).',
        state: me?.workspace?.open ? 'now' : 'unknown' },
      { title: 'Pousser votre code sur GitHub',
        text: 'Avec git push, depuis l\'éditeur. Seul ce qui est sur GitHub peut être mis en ligne.',
        state: has(p => !!p.github?.head || !!p.deployed) },
      { title: 'Mettre en ligne',
        text: 'Un bouton « Déployer » sur la page du projet. Le lab vérifie, teste, puis met en service.',
        state: has(p => !!p.deployed) },
    ];
  });

  ngOnInit(): void {
    this.engine.me().subscribe({
      next: me => this.onMe(me),
      error: err => { this.engineDown.set(toEngineError(err)); this.loading.set(false); },
    });
  }

  private onMe(me: Me): void {
    this.me.set(me);
    const profile = profileOf(me, this.kc.isAdmin);
    this.profile.set(profile);
    this.loading.set(false);
    if (profile !== 'dev' && profile !== 'superuser') return;
    if (!me.initialized) { this.init(); return; }
    this.loadProjects(me);
  }

  /** Première connexion : tout ce que le lab peut faire seul. Aucune commande à taper. */
  init(): void {
    if (this.initRunning()) return;
    this.initRunning.set(true);
    this.initError.set(null);
    this.engine.meInit().subscribe({
      next: me => {
        this.initRunning.set(false);
        this.initSteps.set(me.steps ?? []);
        this.me.set(me);
        if (me.initialized) this.loadProjects(me);
      },
      error: err => { this.initRunning.set(false); this.initError.set(toEngineError(err)); },
    });
  }

  /** SES projets : pour le superutilisateur, `?as=` lui-même (sans, il reçoit tout le lab). */
  private loadProjects(me: Me): void {
    this.engine.projects(me.is_superuser ? me.uid : null).subscribe({
      next: r => this.projects.set(r.projects ?? []),
      error: () => this.projects.set(null),
    });
  }

  recheckGithub(): void {
    this.recheckingGithub.set(true);
    this.engine.me().subscribe({
      next: me => { this.me.set(me); this.recheckingGithub.set(false); },
      error: () => this.recheckingGithub.set(false),
    });
  }

  stepMark(state: StepState): string {
    return state === 'done' ? '✓' : state === 'now' ? '●' : '○';
  }
  stepLabel(state: StepState): string {
    return state === 'done' ? 'fait' : state === 'now' ? 'en cours' : state === 'todo' ? 'à faire' : '';
  }
}
