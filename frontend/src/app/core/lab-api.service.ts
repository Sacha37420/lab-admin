import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

interface EnvWindow {
  __env?: { apiUrl?: string };
}

export interface PublicSpec {
  id: number;
  name: string;
  description: string;
  owner_email: string;
  created_at: string;
  updated_at: string;
  data_models: DataModelSummary[];
  endpoint_groups: EndpointGroupSummary[];
  services: ServiceSummary[];
  pages: PageSummary[];
}

export interface DataModelSummary {
  name: string;
  description: string;
  fields: FieldSummary[];
  relationships: RelSummary[];
  order: number;
}

export interface FieldSummary {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  max_length?: number;
  default?: string;
}

export interface RelSummary {
  name: string;
  rel_type: string;
  to_model: string;
  related_name: string;
  on_delete?: string;
}

export interface EndpointGroupSummary {
  id?: number;
  name: string;
  description: string;
  order: number;
  endpoints: EndpointSummary[];
}

export interface EndpointStepSummary {
  label: string;
  type: string;
  description?: string;
}

export interface QueryParamSummary {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface EndpointSummary {
  method: string;
  path: string;
  description: string;
  operation: string;
  linked_model_name: string;
  auth_required: boolean;
  required_roles?: string[];
  query_params?: QueryParamSummary[];
  steps?: EndpointStepSummary[];
}

export interface ServiceSummary {
  id?: number;
  name: string;
  order: number;
  endpoint_group_ids: number[];
}

export interface PageSummary {
  id?: number;
  name: string;
  route: string;
  layout: string;
  order: number;
  service_ids: number[];
  components?: { type: string; label?: string; linked_model?: string; fields?: string[] }[];
  interactions: { name: string; type: string; description: string }[];
  pipelines: PipelineSummary[];
}

export interface PipelineSummary {
  name: string;
  description: string;
  steps: { label: string; type: string; service_method?: string; data_flow?: string; description?: string }[];
}

export interface HostedApp {
  name: string;
  backend_port: number | null;
  frontend_port: number | null;
  frontend_url: string | null;
  backend_url: string | null;
}

@Injectable({ providedIn: 'root' })
export class LabApiService {
  private http = inject(HttpClient);

  private get base(): string {
    return (window as unknown as EnvWindow).__env?.apiUrl ?? 'http://localhost:8083';
  }

  getAllSpecs(): Observable<PublicSpec[]> {
    return this.http.get<PublicSpec[]>(`${this.base}/api/apps/public/`);
  }

  getInfrastructure(): Observable<{ apps: HostedApp[] }> {
    return this.http.get<{ apps: HostedApp[] }>(`${this.base}/api/infrastructure/`);
  }
}
