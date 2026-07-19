import { Routes } from '@angular/router';
import { adminGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'code',
    loadComponent: () =>
      import('./pages/code-editor/code-editor.component').then(m => m.CodeEditorComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'apps-hebergees',
    loadComponent: () =>
      import('./pages/apps-hebergees/apps-hebergees.component').then(m => m.AppsHebergeesComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'outils',
    loadComponent: () =>
      import('./pages/outils/outils.component').then(m => m.OutilsComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'nouvel-utilisateur',
    loadComponent: () =>
      import('./pages/nouvel-utilisateur/nouvel-utilisateur.component').then(m => m.NouvelUtilisateurComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden/forbidden.component').then(m => m.ForbiddenComponent),
  },
  { path: '**', redirectTo: '' },
];
