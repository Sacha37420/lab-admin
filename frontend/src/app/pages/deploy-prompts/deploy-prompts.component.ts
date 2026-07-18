import { Component, inject, signal, OnInit } from '@angular/core';
import { LabApiService, PublicSpec } from '../../core/lab-api.service';
import { generatePrompt } from './prompt-generator';

@Component({
  selector: 'app-deploy-prompts',
  standalone: true,
  imports: [],
  templateUrl: './deploy-prompts.component.html',
  styleUrl: './deploy-prompts.component.scss',
})
export class DeployPromptsComponent implements OnInit {
  private api = inject(LabApiService);

  specs = signal<PublicSpec[]>([]);
  loading = signal(true);
  error = signal('');
  selectedId = signal<number | null>(null);
  copied = signal(false);

  ngOnInit(): void {
    this.api.getAllSpecs().subscribe({
      next: data => {
        this.specs.set(data);
        if (data.length) this.selectedId.set(data[0].id);
        this.loading.set(false);
      },
      error: () => { this.error.set('Impossible de charger les specs.'); this.loading.set(false); },
    });
  }

  get selectedSpec(): PublicSpec | undefined {
    return this.specs().find(s => s.id === this.selectedId());
  }

  get prompt(): string {
    return this.selectedSpec ? generatePrompt(this.selectedSpec) : '';
  }

  select(id: number): void {
    this.selectedId.set(id);
    this.copied.set(false);
  }

  copy(): void {
    navigator.clipboard.writeText(this.prompt).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    });
  }
}
