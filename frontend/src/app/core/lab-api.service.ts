import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { apiUrl } from './env';

/** API de lab-admin : tests end-to-end de la page « Debug ». */
export interface DebugTest {
  id: number;
  app: string;
  file: string;
  title: string;
  last_status: 'PENDING' | 'PASSED' | 'FAILED' | 'ERROR';
  last_message: string;
  last_run_at: string | null;
  last_duration_ms: number | null;
}

export interface DebugRunJob {
  id: number;
  scope_app: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR';
  progress: number;
  message: string;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class LabApiService {
  private http = inject(HttpClient);

  private get base(): string { return apiUrl(); }

  getDebugTests(): Observable<DebugTest[]> {
    return this.http.get<DebugTest[]>(`${this.base}/api/debug/tests/`);
  }

  runDebugTests(app?: string): Observable<DebugRunJob> {
    return this.http.post<DebugRunJob>(`${this.base}/api/debug/run/`, app ? { app } : {});
  }

  getDebugJob(id: number): Observable<DebugRunJob> {
    return this.http.get<DebugRunJob>(`${this.base}/api/debug/jobs/${id}/`);
  }
}
