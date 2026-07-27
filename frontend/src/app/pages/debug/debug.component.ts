import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DebugRunJob, DebugTest, LabApiService } from '../../core/lab-api.service';

interface AppGroup {
  app: string;
  tests: DebugTest[];
}

const POLL_MS = 2000;

@Component({
  selector: 'app-debug',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './debug.component.html',
  styleUrl: './debug.component.scss',
})
export class DebugComponent implements OnInit, OnDestroy {
  private api = inject(LabApiService);

  tests = signal<DebugTest[]>([]);
  loading = signal(true);
  error = signal('');

  // App ciblée par le run en cours ('' = toutes) — sert à savoir quel bouton
  // afficher comme actif pendant qu'un job tourne.
  runningScope = signal<string | null>(null);
  job = signal<DebugRunJob | null>(null);

  private poll: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadTests();
  }

  ngOnDestroy(): void {
    this.stopPoll();
  }

  loadTests(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.getDebugTests().subscribe({
      next: (t) => { this.tests.set(t); this.loading.set(false); },
      error: () => { this.error.set('Impossible de charger le catalogue de tests.'); this.loading.set(false); },
    });
  }

  get groups(): AppGroup[] {
    const byApp = new Map<string, DebugTest[]>();
    for (const t of this.tests()) {
      if (!byApp.has(t.app)) byApp.set(t.app, []);
      byApp.get(t.app)!.push(t);
    }
    return [...byApp.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([app, tests]) => ({ app, tests }));
  }

  isBusy(): boolean {
    return this.job() !== null && (this.job()!.status === 'PENDING' || this.job()!.status === 'RUNNING');
  }

  runAll(): void {
    this.launch(undefined);
  }

  runApp(app: string): void {
    this.launch(app);
  }

  private launch(app: string | undefined): void {
    if (this.isBusy()) return;
    this.error.set('');
    this.runningScope.set(app ?? '');
    this.api.runDebugTests(app).subscribe({
      next: (j) => { this.job.set(j); this.startPoll(j.id); },
      error: (e) => {
        this.error.set(e?.error?.detail ?? 'Échec du lancement.');
        this.runningScope.set(null);
      },
    });
  }

  private startPoll(id: number): void {
    this.stopPoll();
    this.poll = setInterval(() => {
      this.api.getDebugJob(id).subscribe((j) => {
        this.job.set(j);
        if (j.status === 'DONE' || j.status === 'ERROR') {
          this.stopPoll();
          this.runningScope.set(null);
          this.loadTests();
        }
      });
    }, POLL_MS);
  }

  private stopPoll(): void {
    if (this.poll) { clearInterval(this.poll); this.poll = null; }
  }

  statusLabel(s: DebugTest['last_status']): string {
    return { PENDING: 'Jamais exécuté', PASSED: 'Réussi', FAILED: 'Échoué', ERROR: 'Erreur' }[s];
  }
}
