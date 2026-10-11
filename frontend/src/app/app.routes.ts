import { Routes } from '@angular/router';
import { adminGuard, labGuard } from './core/auth.guard';

export const routes: Routes = [
  // ── Les trois pages de tout le monde (admins et developers) ─────────────────
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/accueil/accueil.component').then(m => m.AccueilComponent),
    canActivate: [labGuard],
  },
  {
    path: 'services',
    loadComponent: () =>
      import('./pages/services/services.component').then(m => m.ServicesComponent),
    canActivate: [labGuard],
  },
  {
    path: 'projets',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/projets/mes-projets.component').then(m => m.MesProjetsComponent),
    canActivate: [labGuard],
  },
  {
    // Page d'un projet : ouverte aux développeurs. C'est le MOTEUR qui vérifie
    // que le projet appartient à l'appelant — ce backend n'est pas sollicité.
    path: 'projets/:app',
    loadComponent: () =>
      import('./pages/projets/projet.component').then(m => m.ProjetComponent),
    canActivate: [labGuard],
  },
  // ── Administration : tout ce qui suit est réservé au groupe `admins` ────────
  {
    // L'ancien accueil d'administration (App Builder, applications conçues).
    path: 'conception',
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
    path: 'debug',
    loadComponent: () =>
      import('./pages/debug/debug.component').then(m => m.DebugComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'forbidden',
    loadComponent: () =>
      import('./pages/forbidden/forbidden.component').then(m => m.ForbiddenComponent),
  },
  { path: '**', redirectTo: '' },
];
