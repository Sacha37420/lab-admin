import { Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EngineService } from '../../core/engine.service';
import {
  EngineError, Job, MODULES_MAX, MODULE_STATE_HINT, ModuleDetail, ModuleItem, ModuleList, ModulePlan, ModulePlanRequest,
  ModuleSettingMissing, moduleActionLabel, moduleCategoryLabel, moduleInstallBody, moduleResourcesLabel,
  moduleSettingsProblems, moduleSourceLabel, moduleStateLabel, modulesErrorText, toEngineError, toModuleDetail,
  toModuleList, toModulePlan,
} from '../../core/engine.client';
import { ModuleFilter, ModuleSortKey, NO_FILTER, canRequest, dependents, filterModules, sortModules } from '../../core/modules.view';
import { DATE_FORMAT, shortSha } from '../../core/format';
import { JobSuiviComponent } from '../../shared/job-suivi/job-suivi.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

/**
 * Page « Modules » (`/modules`, chantier « modules », contrat v1, I4) : les
 * modules du lab, leur état, leurs dépendances et réglages ; installer un
 * module ou relancer son installation, plan affiché avant toute confirmation.
 *
 * Tout vient du moteur (`core/engine.client.ts`) ; aucune vue backend de
 * lab-admin (D8). Route sous `adminGuard`, mais les quatre routes du moteur
 * sont réservées au SUPERUTILISATEUR : un autre admin reçoit `forbidden`, que
 * la page affiche tel quel.
 *
 * Réglages saisis (secrets compris) : ils ne vivent que dans `values`, objet
 * privé du composant, jamais dans un signal partagé, une URL ni le stockage du
 * navigateur. Ils partent une seule fois dans `POST /modules/install` et sont
 * effacés au moment de l'envoi — aussi quand le plan change ou la page se ferme.
 */
@Component({
  selector: 'app-modules',
  standalone: true,
  imports: [FormsModule, DatePipe, JobSuiviComponent, ConfirmDialogComponent],
  templateUrl: './modules.component.html',
  styleUrl: './modules.component.scss',
})
export class ModulesComponent implements OnInit, OnDestroy {
  private engine = inject(EngineService);
  @ViewChild(ConfirmDialogComponent) private confirmDialog?: ConfirmDialogComponent;

  readonly dateFormat = DATE_FORMAT;
  readonly shortSha = shortSha;
  readonly stateLabel = moduleStateLabel;
  readonly categoryLabel = moduleCategoryLabel;
  readonly sourceLabel = moduleSourceLabel;
  readonly actionLabel = moduleActionLabel;
  readonly resourcesLabel = moduleResourcesLabel;
  readonly max = MODULES_MAX;

  loading = signal(true);
  listError = signal<EngineError | null>(null);
  list = signal<ModuleList | null>(null);
  modules = computed(() => this.list()?.modules ?? []);

  // ── Tri et filtres ─────────────────────────────────────────────────────────
  sortKey = signal<ModuleSortKey>('category');
  sortDesc = signal(false);
  filter = signal<ModuleFilter>({ ...NO_FILTER });
  visible = computed(() => sortModules(filterModules(this.modules(), this.filter()), this.sortKey(), this.sortDesc()));
  categories = computed(() => [...new Set(this.modules().map(m => m.category))]);
  states = computed(() => [...new Set(this.modules().map(m => m.state))]);

  setFilter(patch: Partial<ModuleFilter>): void { this.filter.update(f => ({ ...f, ...patch })); }

  // ── Détail et vérification ─────────────────────────────────────────────────
  openName = signal('');
  checkName = signal('');
  checkBusy = signal(false);
  checkResult = signal<ModuleDetail | null>(null);
  checkError = signal<EngineError | null>(null);

  toggleDetail(name: string): void {
    this.openName.update(n => n === name ? '' : name);
  }

  check(name: string): void {
    if (this.checkBusy()) return;
    this.checkName.set(name);
    this.checkBusy.set(true);
    this.checkResult.set(null);
    this.checkError.set(null);
    this.engine.module(name, true).subscribe({
      next: raw => {
        this.checkBusy.set(false);
        const d = toModuleDetail(raw);
        if (d) this.checkResult.set(d);
        else this.checkError.set(toEngineError({ status: 200, error: {} }));
      },
      error: err => { this.checkBusy.set(false); this.checkError.set(toEngineError(err)); },
    });
  }

  depNames(m: ModuleItem): string { return m.requires.modules.map(r => r.name).join(', '); }
  installOrder(): string { return this.toInstall().map(s => s.module).join(' → '); }
  dependentsOf(name: string): string[] { return dependents(this.modules(), name); }
  stateHint(state: string): string { return (MODULE_STATE_HINT as Record<string, string>)[state] ?? ''; }
  toneClass(tone: string): string { return tone ? `pj-${tone}` : ''; }
  checkTone(ok: boolean | null): string { return ok === true ? 'pj-ok' : ok === false ? 'pj-ko' : ''; }
  checkText(ok: boolean | null): string { return ok === true ? 'bon' : ok === false ? 'à corriger' : 'non vérifiable'; }
  settingsSummary(m: ModuleItem): string {
    if (!m.settings.length) return '';
    const unset = m.settings.filter(s => !s.set).length;
    return `${m.settings.length} réglage(s)${unset ? `, ${unset} non réglé(s)` : ', tous réglés'}`;
  }

  // ── Sélection et options ───────────────────────────────────────────────────
  selected = signal<string[]>([]);
  reinstall = signal(false);
  withDeps = signal(false);
  readonly canRequest = canRequest;

  isSelected(name: string): boolean { return this.selected().includes(name); }

  toggleSelect(m: ModuleItem, checked: boolean): void {
    if (!canRequest(m)) return;
    this.selected.update(list => checked
      ? (list.includes(m.name) || list.length >= MODULES_MAX ? list : [...list, m.name])
      : list.filter(n => n !== m.name));
    this.invalidatePlan();
  }

  clearSelection(): void { this.selected.set([]); this.invalidatePlan(); }
  setReinstall(v: boolean): void { this.reinstall.set(v); this.invalidatePlan(); }
  setWithDeps(v: boolean): void { this.withDeps.set(v); this.invalidatePlan(); }

  // ── Plan ───────────────────────────────────────────────────────────────────
  plan = signal<ModulePlan | null>(null);
  /** La demande dont `plan` est le résultat : c'est elle, et elle seule, qui part à l'installation. */
  private planRequest: ModulePlanRequest | null = null;
  planBusy = signal(false);
  planError = signal<EngineError | null>(null);
  /** Le plan affiché est celui que le moteur a retenu au lancement (réponse d'`install`). */
  planFromInstall = signal(false);

  toInstall = computed(() => (this.plan()?.steps ?? []).filter(s => s.action === 'install' || s.action === 'reinstall'));
  kept = computed(() => (this.plan()?.steps ?? []).filter(s => s.action !== 'install' && s.action !== 'reinstall'));

  askPlan(): void {
    if (this.planBusy() || !this.selected().length) return;
    const req: ModulePlanRequest = { modules: this.selected(), reinstall: this.reinstall(), with_deps: this.withDeps() };
    this.invalidatePlan();
    this.planBusy.set(true);
    this.engine.modulePlan(req).subscribe({
      next: raw => { this.planBusy.set(false); this.planRequest = req; this.plan.set(toModulePlan(raw)); this.clearValues(); },
      error: err => { this.planBusy.set(false); this.planError.set(toEngineError(err)); },
    });
  }

  private invalidatePlan(): void {
    this.plan.set(null);
    this.planRequest = null;
    this.planError.set(null);
    this.planFromInstall.set(false);
    this.installError.set(null);
    this.clearValues();
  }

  // ── Réglages manquants (écriture seule) ────────────────────────────────────
  /** Valeurs saisies. Jamais exposées hors du composant, effacées à l'envoi. */
  private values: Record<string, Record<string, string>> = {};
  /** Change à chaque effacement : les champs sont recréés vides (le navigateur ne garde rien). */
  formGeneration = signal(0);

  val(s: ModuleSettingMissing): string { return this.values[s.module]?.[s.key] ?? ''; }
  setVal(s: ModuleSettingMissing, v: string): void {
    (this.values[s.module] ??= {})[s.key] = v;
    this.problems.set(moduleSettingsProblems(this.plan()?.settings_missing ?? [], this.values));
  }
  problems = signal<string[]>([]);

  private clearValues(): void {
    this.values = {};
    this.problems.set(moduleSettingsProblems(this.plan()?.settings_missing ?? [], this.values));
    this.formGeneration.update(n => n + 1);
  }

  fieldId(s: ModuleSettingMissing): string { return `mod-set-${s.module}-${s.key}`; }

  // ── Installation ───────────────────────────────────────────────────────────
  installBusy = signal(false);
  installError = signal<EngineError | null>(null);
  jobId = signal('');
  /** Le job suivi a été trouvé en cours au chargement (lancé ailleurs). */
  jobFound = signal(false);

  canInstall = computed(() => {
    const p = this.plan();
    return !!p && p.ok && !this.planFromInstall() && this.toInstall().length > 0 && !this.problems().length
      && !this.installBusy() && !this.jobId() && !this.list()?.job;
  });

  confirmInstall(origin: HTMLElement): void {
    if (!this.canInstall()) return;
    const order = this.toInstall().map((s, i) => `${i + 1}. ${s.module} (${moduleActionLabel(s.action)})`).join(' ; ');
    const kept = this.kept().length ? ` Restent inchangés : ${this.kept().map(s => s.module).join(', ')}.` : '';
    this.confirmDialog?.ask({
      title: 'Lancer l\'installation ?',
      text: `Seront installés dans cet ordre : ${order}.${kept} Chaque module suit le chemin de déploiement du lab (dernier commit présent sur GitHub, contrôles, tests) ; un module en échec n'arrête que ceux qui en dépendent.`,
      confirmLabel: 'Installer',
    }, origin, () => this.install());
  }

  private install(): void {
    const plan = this.plan();
    const req = this.planRequest;
    if (!plan || !req || !this.canInstall()) return;
    const body = moduleInstallBody(req, plan.settings_missing, this.values);
    // Envoyées une fois : effacées avant même la réponse.
    this.clearValues();
    this.installBusy.set(true);
    this.installError.set(null);
    this.engine.moduleInstall(body).subscribe({
      next: ticket => {
        this.installBusy.set(false);
        this.plan.set(toModulePlan(ticket.plan));
        this.planFromInstall.set(true);
        this.jobFound.set(false);
        this.jobId.set(ticket.job_id);
      },
      error: err => {
        const e = toEngineError(err);
        this.installBusy.set(false);
        this.installError.set(e);
        if (e.code === 'job_exists' && e.jobId) { this.jobFound.set(true); this.jobId.set(e.jobId); }
      },
    });
  }

  /** Job terminé (ou perdu) : la liste est relue ; la sélection, consommée, est vidée. */
  onJobDone(_job: Job | null): void {
    this.selected.set([]);
    this.reload();
  }

  closeJob(): void {
    this.jobId.set('');
    this.jobFound.set(false);
    this.plan.set(null);
    this.planRequest = null;
    this.planFromInstall.set(false);
    this.installError.set(null);
  }

  errorText(e: EngineError): string { return modulesErrorText(e); }

  // ── Chargement ─────────────────────────────────────────────────────────────
  listErrorText = computed(() => { const e = this.listError(); return e ? modulesErrorText(e, 'list') : ''; });

  ngOnInit(): void { this.reload(); }

  reload(): void {
    this.listError.set(null);
    if (!this.list()) this.loading.set(true);
    this.engine.modules().subscribe({
      next: raw => {
        const l = toModuleList(raw);
        this.list.set(l);
        this.loading.set(false);
        // Un job `modules` déjà en file ou en cours (lancé d'ailleurs) : on le suit.
        if (l.job && !this.jobId()) { this.jobFound.set(true); this.jobId.set(l.job); }
        const known = new Set(l.modules.filter(canRequest).map(m => m.name));
        this.selected.update(list => list.filter(n => known.has(n)));
      },
      error: err => { this.loading.set(false); this.listError.set(toEngineError(err)); },
    });
  }

  ngOnDestroy(): void { this.values = {}; }
}
