import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { KeycloakService } from './keycloak.service';

/**
 * Guard : redirige vers /forbidden si l'utilisateur n'a pas le groupe 'admins'.
 * L'utilisateur est forcément authentifié ici (Keycloak init avec login-required).
 * Reste posé sur TOUTES les routes sauf l'accueil.
 */
export const adminGuard: CanActivateFn = () => {
  const kc = inject(KeycloakService);
  const router = inject(Router);
  return kc.isAdmin ? true : router.createUrlTree(['/forbidden']);
};

/**
 * Guard de l'accueil et des pages de projet (`/projets/<app>`) : `admins` ou `developers` — les deux
 * groupes que Keycloak et l'API laissent entrer (contrat multi-dev, I6). Un
 * non-admin n'y voit que « Mes projets » (jamais l'accueil d'administration).
 */
export const labGuard: CanActivateFn = () => {
  const kc = inject(KeycloakService);
  const router = inject(Router);
  return kc.isAdmin || kc.groups.includes('developers')
    ? true
    : router.createUrlTree(['/forbidden']);
};
