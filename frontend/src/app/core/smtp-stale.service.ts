import { Injectable, signal } from '@angular/core';

/**
 * REPLI : projets dont le profil SMTP a été modifié depuis sa dernière
 * application, tels que cette session les a appris de `stale_projects`
 * (réponse de `PUT /me/smtp/<id>`).
 *
 * La source qui fait foi est `smtp.stale` dans le détail du projet (I10) ; ce
 * service n'est consulté que si le moteur ne rend pas ce champ
 * (`smtpIsStale`, core/engine.client.ts). En mémoire seulement, perdu au
 * rechargement. À supprimer quand plus aucun moteur sans `stale` n'est en service.
 */
@Injectable({ providedIn: 'root' })
export class SmtpStaleService {
  private readonly stale = signal<Record<string, string>>({});

  /** Marque ces projets comme tournant encore avec l'ancienne version du profil `label`. */
  mark(projects: string[] | undefined, label: string): void {
    if (!projects?.length) return;
    this.stale.update(s => ({ ...s, ...Object.fromEntries(projects.map(p => [p, label])) }));
  }

  clear(project: string): void {
    this.stale.update(s => { const { [project]: _, ...rest } = s; return rest; });
  }

  /** Libellé du profil modifié, ou null. */
  of(project: string): string | null {
    return this.stale()[project] ?? null;
  }
}
